// modules/whatsapp/service.js — everything needed to talk to the WhatsApp
// Cloud API: build/validate message payloads (text, buttons, list, cta_url,
// templates), send them, verify inbound webhooks, and manage connected
// numbers. Ported from the original repo's src/whatsapp-interactive.js +
// src/channel-send.js's WhatsApp branch + server.js's /api/wa/* routes.
const fetch = require('node-fetch');
const crypto = require('crypto');
const { supabase } = require('../../shared/db');
const { encryptToken, decryptToken } = require('../../shared/crypto');

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
// Free-form messages (text/button/list/cta_url — anything that isn't an
// approved template) are only deliverable within WhatsApp's 24-hour customer
// service window, counted from the contact's most recent inbound message.
// 22h here (not 24h) is a safety margin under Meta's real limit, to absorb
// clock drift/latency between Meta's timestamp and this check. Enforced
// server-side, not just a disabled button in the UI — a stale button state
// or a direct API call shouldn't be able to bypass it.
const REPLY_WINDOW_HOURS = 22;

class WhatsAppValidationError extends Error {}

// ---------------------------------------------------------------------
// Message payload building & validation (mirrors Meta's Cloud API limits
// so bad input fails fast locally instead of a vague 400 from Meta).
// ---------------------------------------------------------------------
function renderTemplate(input, vars = {}) {
  if (typeof input !== 'string') return input;
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

function validateRecipient(to) {
  if (!/^\d{10,15}$/.test(to)) {
    throw new WhatsAppValidationError(`Recipient "${to}" should be digits only, no '+' or spaces (e.g. "91XXXXXXXXXX").`);
  }
}

function validateButtonConfig(cfg) {
  const buttons = cfg.buttons || [];
  if (buttons.length === 0) throw new WhatsAppValidationError('Button message needs at least 1 button.');
  if (buttons.length > 3) throw new WhatsAppValidationError(`Button message supports max 3 buttons, got ${buttons.length}.`);
  const seenIds = new Set();
  for (const btn of buttons) {
    if (!btn.id || !btn.title) throw new WhatsAppValidationError('Each button needs an id and a title.');
    if (btn.title.length > 20) throw new WhatsAppValidationError(`Button title "${btn.title}" exceeds 20 characters.`);
    if (EMOJI_REGEX.test(btn.title)) throw new WhatsAppValidationError(`Button title "${btn.title}" contains an emoji (not supported).`);
    if (seenIds.has(btn.id)) throw new WhatsAppValidationError(`Duplicate button id "${btn.id}".`);
    seenIds.add(btn.id);
  }
}

function validateListConfig(cfg) {
  const sections = cfg.sections || [];
  const totalRows = sections.reduce((sum, s) => sum + (s.rows || []).length, 0);
  if (totalRows === 0) throw new WhatsAppValidationError('List message needs at least 1 row.');
  if (totalRows > 10) throw new WhatsAppValidationError(`List message supports max 10 rows total, got ${totalRows}.`);
  if (!cfg.buttonLabel || cfg.buttonLabel.length > 20) throw new WhatsAppValidationError('List buttonLabel is required and must be <= 20 characters.');
  for (const section of sections) {
    if (!section.title || section.title.length > 24) throw new WhatsAppValidationError(`Section title "${section.title}" is required and must be <= 24 characters.`);
    for (const row of section.rows || []) {
      if (!row.id || !row.title) throw new WhatsAppValidationError('Each row needs an id and a title.');
      if (row.title.length > 24) throw new WhatsAppValidationError(`Row title "${row.title}" exceeds 24 characters.`);
      if (row.description && row.description.length > 72) throw new WhatsAppValidationError(`Row description for "${row.title}" exceeds 72 characters.`);
    }
  }
}

function validateCtaUrlConfig(cfg) {
  if (!cfg.displayText || cfg.displayText.length > 20) throw new WhatsAppValidationError('cta_url displayText is required and must be <= 20 characters.');
  if (!cfg.url || !cfg.url.trim()) throw new WhatsAppValidationError('cta_url url is required.');
}

function validateTemplateConfig(kind, cfg) {
  if (kind === 'text') {
    if (!cfg.body || !cfg.body.trim()) throw new WhatsAppValidationError('Text message body is required.');
    return;
  }
  if (kind === 'button') return validateButtonConfig(cfg);
  if (kind === 'list') return validateListConfig(cfg);
  if (kind === 'cta_url') return validateCtaUrlConfig(cfg);
  throw new WhatsAppValidationError(`Unknown message kind "${kind}".`);
}

function buildButtonInteractive(cfg, vars) {
  const interactive = {
    type: 'button',
    body: { text: renderTemplate(cfg.body, vars) },
    action: { buttons: cfg.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: renderTemplate(b.title, vars) } })) },
  };
  if (cfg.header) interactive.header = { type: 'text', text: renderTemplate(cfg.header, vars) };
  if (cfg.footer) interactive.footer = { text: renderTemplate(cfg.footer, vars) };
  return interactive;
}

function buildListInteractive(cfg, vars) {
  const interactive = {
    type: 'list',
    body: { text: renderTemplate(cfg.body, vars) },
    action: {
      button: renderTemplate(cfg.buttonLabel, vars),
      sections: cfg.sections.map((s) => ({
        title: renderTemplate(s.title, vars),
        rows: s.rows.map((r) => ({ id: r.id, title: renderTemplate(r.title, vars), ...(r.description ? { description: renderTemplate(r.description, vars) } : {}) })),
      })),
    },
  };
  if (cfg.header) interactive.header = { type: 'text', text: renderTemplate(cfg.header, vars) };
  if (cfg.footer) interactive.footer = { text: renderTemplate(cfg.footer, vars) };
  return interactive;
}

function buildCtaInteractive(cfg, vars) {
  const interactive = {
    type: 'cta_url',
    body: { text: renderTemplate(cfg.body, vars) },
    action: { name: 'cta_url', parameters: { display_text: renderTemplate(cfg.displayText, vars), url: renderTemplate(cfg.url, vars) } },
  };
  if (cfg.header) interactive.header = { type: 'text', text: renderTemplate(cfg.header, vars) };
  if (cfg.footer) interactive.footer = { text: renderTemplate(cfg.footer, vars) };
  return interactive;
}

/** Builds a validated, Meta-ready message body for a given `to` (digits-only phone). */
function buildMessagePayload(kind, cfg, to, vars = {}) {
  validateRecipient(to);
  validateTemplateConfig(kind, cfg);

  if (kind === 'text') {
    return { messaging_product: 'whatsapp', to, type: 'text', text: { body: renderTemplate(cfg.body, vars) } };
  }
  let interactive;
  if (kind === 'button') interactive = buildButtonInteractive(cfg, vars);
  else if (kind === 'list') interactive = buildListInteractive(cfg, vars);
  else if (kind === 'cta_url') interactive = buildCtaInteractive(cfg, vars);
  return { messaging_product: 'whatsapp', to, type: 'interactive', interactive };
}

/** Builds a Meta template-message body (approved template, business-initiated). */
function buildTemplatePayload(to, { name, language = 'en_US', components }) {
  validateRecipient(to);
  if (!name) throw new WhatsAppValidationError('Template name is required.');
  const template = { name, language: { code: language } };
  if (components) template.components = components;
  return { messaging_product: 'whatsapp', to, type: 'template', template };
}

// ---------------------------------------------------------------------
// Account management (a "wa_accounts"-style row: waba_id, phone_number_id,
// encrypted access_token — obtained via Meta's embedded signup or a manual
// System User token).
// ---------------------------------------------------------------------
async function listAccounts(userId) {
  const { data, error } = await supabase.from('crm_wa_accounts')
    .select('id, waba_id, phone_number_id, phone_number, display_name, quality_rating, is_active, created_at')
    .eq('user_id', userId).eq('is_active', true).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function verifyWaba(wabaId, accessToken) {
  const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return (data.data || []).map((p) => ({
    phone_number_id: p.id, phone_number: p.display_phone_number, display_name: p.verified_name,
    quality_rating: p.quality_rating || 'UNKNOWN', verified: p.code_verification_status === 'VERIFIED',
  }));
}

async function connectAccount(userId, { waba_id, phone_number_id, access_token }) {
  const phoneRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}?fields=display_phone_number,verified_name,quality_rating`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const phoneData = await phoneRes.json();
  if (phoneData.error) throw new Error(phoneData.error.message);

  // Subscribe this app to the WABA's webhooks so inbound messages/status
  // updates start arriving at POST /api/whatsapp/webhook.
  await fetch(`https://graph.facebook.com/${META_API_VERSION}/${waba_id}/subscribed_apps`, {
    method: 'POST', headers: { Authorization: `Bearer ${access_token}` },
  });

  const { data, error } = await supabase.from('crm_wa_accounts').insert({
    user_id: userId, waba_id, phone_number_id,
    phone_number: phoneData.display_phone_number, display_name: phoneData.verified_name,
    access_token_enc: encryptToken(access_token), quality_rating: phoneData.quality_rating || 'UNKNOWN',
    is_active: true, created_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function disconnectAccount(userId, accountId) {
  const { error } = await supabase.from('crm_wa_accounts')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', accountId).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

// Pulls the current quality_rating (and display name) for every one of the
// user's connected numbers straight from Meta rather than trusting whatever
// was last saved locally — quality drifts up/down over time based on recent
// sending behavior, independent of any action taken here.
async function refreshQuality(userId) {
  const { data: accounts, error } = await supabase.from('crm_wa_accounts')
    .select('id, phone_number_id, access_token_enc').eq('user_id', userId).eq('is_active', true);
  if (error) throw new Error(error.message);
  if (!accounts?.length) return { updated: 0, failed: [], accounts: [] };

  const results = await Promise.all(accounts.map(async (acc) => {
    try {
      const accessToken = decryptToken(acc.access_token_enc);
      const metaRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${acc.phone_number_id}?fields=quality_rating,verified_name,display_phone_number`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const metaData = await metaRes.json();
      if (!metaRes.ok) return { id: acc.id, ok: false, error: metaData.error?.message || `Meta API ${metaRes.status}` };
      const { error: updateErr } = await supabase.from('crm_wa_accounts').update({
        quality_rating: metaData.quality_rating || 'UNKNOWN',
        display_name: metaData.verified_name || undefined,
        updated_at: new Date().toISOString(),
      }).eq('id', acc.id);
      if (updateErr) return { id: acc.id, ok: false, error: updateErr.message };
      return { id: acc.id, ok: true, quality_rating: metaData.quality_rating || 'UNKNOWN' };
    } catch (err) {
      return { id: acc.id, ok: false, error: err.message };
    }
  }));

  const refreshed = await listAccounts(userId);
  return { updated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), accounts: refreshed };
}

async function getActiveAccount(userId) {
  const { data, error } = await supabase.from('crm_wa_accounts')
    .select('*').eq('user_id', userId).eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('No active WhatsApp account connected.');
  return data[0];
}

// ---------------------------------------------------------------------
// CRM persistence — every inbound webhook event and outbound send gets
// written to crm_leads/crm_messages so modules/inbox (which only reads
// crm_messages) actually has something to show. Without this, the webhook
// handler was a dead end: events arrived, got logged to stdout, and
// nothing else ever knew about them. Shared with facebook/instagram/threads
// via shared/crmMessages.js — only the "which client owns this event"
// lookup below is WhatsApp-specific (keyed by phone_number_id).
// ---------------------------------------------------------------------
const { resolveClientId, findOrCreateLead, recordMessage: recordCrmMessage } = require('../../shared/crmMessages');

async function findOrCreateLeadByPhone(clientId, phone) {
  return findOrCreateLead(clientId, 'whatsapp', { phone });
}
async function recordMessage(clientId, leadId, opts) {
  return recordCrmMessage(clientId, leadId, { ...opts, channel: 'whatsapp' });
}

// Webhooks are unauthenticated (Meta calls them, not a logged-in user) — the
// only thing tying an inbound message back to a client is which of *our*
// numbers it arrived on.
async function resolveClientByPhoneNumberId(phoneNumberId) {
  const { data: account, error } = await supabase.from('crm_wa_accounts')
    .select('user_id').eq('phone_number_id', phoneNumberId).eq('is_active', true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!account) return null;
  return { userId: account.user_id, clientId: await resolveClientId(account.user_id) };
}

/** Called by routes.js for each 'message' webhook event — persists it as an inbound crm_messages row. */
async function handleInboundEvent(event) {
  const ctx = await resolveClientByPhoneNumberId(event.phoneNumberId);
  if (!ctx) { console.warn(`[whatsapp] inbound message on unknown phone_number_id ${event.phoneNumberId} — is that account connected here?`); return; }
  const leadId = await findOrCreateLeadByPhone(ctx.clientId, event.from);
  const buttonReply = event.interactiveReply?.button_reply?.title;
  const listReply = event.interactiveReply?.list_reply?.title;
  const body = event.text || buttonReply || listReply || '[unsupported message type]';
  const messageType = event.interactiveReply ? 'interactive' : (event.text ? 'text' : 'unknown');
  await recordMessage(ctx.clientId, leadId, { direction: 'in', messageType, body, externalId: event.messageId });
}

/** Called by routes.js for each 'status' webhook event — updates the matching outbound row's delivery status. */
async function handleStatusEvent(event) {
  const { error } = await supabase.from('crm_messages')
    .update({ status: event.status }).eq('external_id', event.messageId).eq('direction', 'out');
  if (error) console.error('[whatsapp] failed to update message status:', error.message);
}

// ---------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------
async function sendRaw(phoneNumberId, accessToken, payload) {
  const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.messages?.[0]?.id) throw new Error(data.error?.message || `Meta API ${res.status}`);
  return data.messages[0].id;
}

// Best-effort CRM logging wrapper — a message that sent successfully via
// Meta should never come back as an error just because our own bookkeeping
// failed, so failures here are logged, not thrown.
async function logOutbound(userId, to, { messageType, body, externalId }) {
  try {
    const clientId = await resolveClientId(userId);
    const leadId = await findOrCreateLeadByPhone(clientId, to);
    await recordMessage(clientId, leadId, { direction: 'out', messageType, body, externalId, status: 'sent', sentBy: userId });
  } catch (err) {
    console.error('[whatsapp] sent to Meta but failed to log to CRM:', err.message);
  }
}

async function markAllRead(userId) {
  const clientId = await resolveClientId(userId);
  const { error } = await supabase.from('crm_messages')
    .update({ is_read: true }).eq('client_id', clientId).eq('channel', 'whatsapp').eq('direction', 'in').eq('is_read', false);
  if (error) throw new Error(error.message);
}

async function assertWithinReplyWindow(clientId, to) {
  const leadId = await findOrCreateLeadByPhone(clientId, to);
  const { data: lastInbound, error } = await supabase.from('crm_messages')
    .select('created_at').eq('lead_id', leadId).eq('channel', 'whatsapp').eq('direction', 'in')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!lastInbound) throw new Error('No inbound message found for this contact — use an approved template to start the conversation.');
  const hoursSince = (Date.now() - new Date(lastInbound.created_at).getTime()) / 3600000;
  if (hoursSince > REPLY_WINDOW_HOURS) {
    throw new Error(`Reply window has closed (${hoursSince.toFixed(1)}h since their last message, limit is ${REPLY_WINDOW_HOURS}h). Use an approved template instead.`);
  }
}

/** High-level send: looks up the user's active account and sends a text/button/list/cta message. */
async function sendMessage(userId, { to, kind = 'text', cfg, vars }) {
  const account = await getActiveAccount(userId);
  const clientId = await resolveClientId(userId);
  await assertWithinReplyWindow(clientId, to);
  const payload = buildMessagePayload(kind, cfg, to, vars);
  const messageId = await sendRaw(account.phone_number_id, decryptToken(account.access_token_enc), payload);
  const bodyPreview = kind === 'text' ? renderTemplate(cfg.body, vars) : renderTemplate(cfg.body || cfg.displayText || `[${kind}]`, vars);
  try {
    await recordMessage(clientId, await findOrCreateLeadByPhone(clientId, to), { direction: 'out', messageType: kind, body: bodyPreview, externalId: messageId, status: 'sent', sentBy: userId });
  } catch (err) {
    console.error('[whatsapp] sent to Meta but failed to log to CRM:', err.message);
  }
  return { messageId, phoneNumberId: account.phone_number_id };
}

/** High-level send of an approved template (business-initiated / outside 24h window). */
async function sendTemplate(userId, { to, name, language, components }) {
  const account = await getActiveAccount(userId);
  const payload = buildTemplatePayload(to, { name, language, components });
  const messageId = await sendRaw(account.phone_number_id, decryptToken(account.access_token_enc), payload);
  await logOutbound(userId, to, { messageType: 'template', body: `[template: ${name}]`, externalId: messageId });
  return { messageId, phoneNumberId: account.phone_number_id };
}

// ---------------------------------------------------------------------
// Webhook verification (GET challenge + POST signature check)
// ---------------------------------------------------------------------
function verifySubscription(mode, token, challenge) {
  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) return challenge;
  return null;
}

function verifySignature(rawBody, sigHeader) {
  if (!process.env.META_APP_SECRET) return true; // not configured — allow through (dev only)
  if (!sigHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex');
  try {
    const sigBuf = Buffer.from(sigHeader);
    const expBuf = Buffer.from(expected);
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/** Flattens a WhatsApp webhook POST body into a simple list of inbound events. */
function parseInboundEvents(body) {
  const events = [];
  if (body?.object !== 'whatsapp_business_account') return events;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const msg of value.messages || []) {
        events.push({
          type: 'message', wabaId: entry.id, phoneNumberId: value.metadata?.phone_number_id,
          from: msg.from, messageId: msg.id, timestamp: msg.timestamp,
          text: msg.text?.body || null, interactiveReply: msg.interactive || null, raw: msg,
        });
      }
      for (const status of value.statuses || []) {
        events.push({ type: 'status', wabaId: entry.id, messageId: status.id, status: status.status, recipient: status.recipient_id, raw: status });
      }
    }
  }
  return events;
}

module.exports = {
  WhatsAppValidationError,
  buildMessagePayload,
  buildTemplatePayload,
  validateRecipient,
  listAccounts,
  verifyWaba,
  connectAccount,
  disconnectAccount,
  getActiveAccount,
  refreshQuality,
  markAllRead,
  sendMessage,
  sendTemplate,
  sendRaw,
  verifySubscription,
  verifySignature,
  parseInboundEvents,
  handleInboundEvent,
  handleStatusEvent,
};
