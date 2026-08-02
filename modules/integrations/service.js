// modules/integrations/service.js — GET /api/integrations,
// POST /api/integrations/:id/connect (crm_integrations — non-channel
// integrations: Calendly, Manychat, Resend, Webhook Builder, Shopify, Slack)
//
// connectIntegration() used to just write { status: 'connected' } straight
// to the DB with whatever config the frontend posted — no verification, no
// actual API usage. Calendly, Resend, and ManyChat now do real work:
//   - Calendly: token is verified against /users/me before saving, and
//     pollCalendlyBookings() (same polling pattern as modules/insights)
//     pulls recent bookings and matches them to existing leads by
//     email/phone.
//   - Resend: API key is verified against /domains before saving, and
//     sendResendEmail() is a real send usable by automations/routes.
//   - ManyChat: API key is verified against /fb/page/getInfo before saving,
//     and a per-client webhook token is generated so ManyChat can push
//     subscriber events straight into crm_leads (see routes.js).
// Shopify/Slack/Webhook Builder are untouched — still passthrough stubs.
const crypto = require('crypto');
const fetch = require('node-fetch');
const { supabase } = require('../../shared/db');
const { encryptToken, decryptToken } = require('../../shared/crypto');
const { findOrCreateLead, recordMessage } = require('../../shared/crmMessages');

const KNOWN = ['calendly', 'manychat', 'resend', 'webhook_builder', 'shopify', 'slack'];
// The frontend's "connect calendar" quick-action (js/modules/sources.js)
// sends 'calendar' rather than the schema's 'calendly' — alias it here
// instead of changing the already-applied DB check constraint.
const ALIASES = { calendar: 'calendly' };

const CALENDLY_BASE = 'https://api.calendly.com';
const RESEND_BASE = 'https://api.resend.com';
const MANYCHAT_BASE = 'https://api.manychat.com';

function normalizePhone(phone) {
  return phone ? String(phone).replace(/\D/g, '') : phone;
}

async function listIntegrations(clientId) {
  const { data, error } = await supabase.from('crm_integrations').select('*').eq('client_id', clientId);
  if (error) throw new Error(error.message);
  const byId = Object.fromEntries((data || []).map((i) => [i.integration_id, i]));
  // Always return all known integrations, connected or not, so the frontend
  // can render a consistent list without needing seed rows. Sensitive
  // config fields are stripped before this ever reaches the frontend.
  return KNOWN.map((id) => {
    const row = byId[id] || { integration_id: id, status: 'disconnected', config: {} };
    return { ...row, config: publicConfig(id, row.config || {}) };
  });
}

// Strips *_enc fields (encrypted secrets) from a config object before it's
// sent to the frontend — the UI only needs to know *that* something is
// connected (e.g. from_email, page name), never the raw/decrypted key back.
function publicConfig(integrationId, config) {
  const { token_enc, api_key_enc, ...rest } = config;
  return rest;
}

async function upsertRow(clientId, integrationId, config) {
  const { data, error } = await supabase.from('crm_integrations').upsert({
    client_id: clientId, integration_id: integrationId, status: 'connected',
    config, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id,integration_id' }).select().single();
  if (error) throw new Error(error.message);
  return { ...data, config: publicConfig(integrationId, data.config || {}) };
}

async function getRow(clientId, integrationId) {
  const { data, error } = await supabase.from('crm_integrations').select('*')
    .eq('client_id', clientId).eq('integration_id', integrationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== 'connected') throw new Error(`${integrationId} is not connected for this client.`);
  return data;
}

async function connectIntegration(clientId, integrationId, config = {}) {
  integrationId = ALIASES[integrationId] || integrationId;
  if (!KNOWN.includes(integrationId)) throw new Error(`Unknown integration "${integrationId}"`);

  if (integrationId === 'calendly') return connectCalendly(clientId, config);
  if (integrationId === 'resend') return connectResend(clientId, config);
  if (integrationId === 'manychat') return connectManychat(clientId, config);

  // webhook_builder / shopify / slack — unchanged passthrough behavior.
  return upsertRow(clientId, integrationId, config);
}

async function disconnectIntegration(clientId, integrationId) {
  integrationId = ALIASES[integrationId] || integrationId;
  const { error } = await supabase.from('crm_integrations')
    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('client_id', clientId).eq('integration_id', integrationId);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ======================================================================
// CALENDLY — Personal Access Token, verified against /users/me. No OAuth
// app needed (that requires Calendly's Developer approval); a PAT is what
// solo/small-business Calendly accounts actually have available.
// ======================================================================

async function connectCalendly(clientId, { token }) {
  if (!token) throw new Error('Calendly requires a Personal Access Token (Calendly -> Integrations -> API & Webhooks).');
  const res = await fetch(`${CALENDLY_BASE}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.title || 'Calendly rejected that token — check it was copied correctly.');

  return upsertRow(clientId, 'calendly', {
    token_enc: encryptToken(token),
    user_uri: data.resource?.uri || null,
    email: data.resource?.email || null,
    name: data.resource?.name || null,
  });
}

/** Pulls Calendly events created since `sinceDays` ago, and for each
 * invitee, matches an existing lead by email or phone (Calendly captures
 * phone only if the event type asks a custom question for it) and marks
 * that lead 'converted' with a note — mirroring the "click Calendly link ->
 * becomes a booked lead" flow CRMs use this integration for. Does not
 * create new leads; a booking with no matching lead is left alone, since a
 * booking alone (no prior contact) isn't necessarily part of this CRM's
 * pipeline. */
async function pollCalendlyBookings(clientId, sinceDays = 7) {
  const row = await getRow(clientId, 'calendly');
  const token = decryptToken(row.config.token_enc);
  const userUri = row.config.user_uri;
  if (!userUri) throw new Error('Calendly connection is missing user_uri — reconnect.');

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const eventsRes = await fetch(
    `${CALENDLY_BASE}/scheduled_events?user=${encodeURIComponent(userUri)}&count=50&created_at_after=${since}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const eventsData = await eventsRes.json();
  if (!eventsRes.ok) throw new Error(eventsData.message || 'Calendly events fetch failed');

  let matched = 0;
  for (const event of eventsData.collection || []) {
    const inviteesRes = await fetch(`${event.uri}/invitees`, { headers: { Authorization: `Bearer ${token}` } });
    const inviteesData = await inviteesRes.json();
    if (!inviteesRes.ok) continue;

    for (const invitee of inviteesData.collection || []) {
      const email = invitee.email;
      const phoneAnswer = (invitee.questions_and_answers || []).find((q) =>
        /phone|whatsapp|mobile/i.test(q.question || '')
      );
      const phone = phoneAnswer ? normalizePhone(phoneAnswer.answer) : null;

      let query = supabase.from('crm_leads').select('id, notes').eq('client_id', clientId);
      query = email ? query.eq('email', email) : phone ? query.eq('phone', phone) : null;
      if (!query) continue;
      const { data: leads } = await query.limit(1);
      const lead = leads?.[0];
      if (!lead) continue;

      const note = `Booked via Calendly: ${event.name || 'event'} at ${event.start_time}`;
      await supabase.from('crm_leads').update({
        status: 'converted',
        notes: lead.notes ? `${lead.notes}\n${note}` : note,
        updated_at: new Date().toISOString(),
      }).eq('id', lead.id);
      matched++;
    }
  }
  return { events_checked: (eventsData.collection || []).length, leads_matched: matched };
}

// ======================================================================
// RESEND — transactional email. API key verified against /domains
// (lightweight authed call that doesn't send anything) before saving.
// ======================================================================

async function connectResend(clientId, { api_key, from_email, from_name }) {
  if (!api_key) throw new Error('Resend requires an API key (Resend dashboard -> API Keys).');
  if (!from_email) throw new Error('A from_email is required — must be on a domain verified in Resend.');

  const res = await fetch(`${RESEND_BASE}/domains`, { headers: { Authorization: `Bearer ${api_key}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Resend rejected that API key.');
  }

  return upsertRow(clientId, 'resend', {
    api_key_enc: encryptToken(api_key),
    from_email, from_name: from_name || null,
  });
}

/** Sends a real email via Resend. Returns the Resend message id. Usable
 * from automations/schedule the same way modules/gmail.sendEmail is. */
async function sendResendEmail(clientId, { to, subject, html, text }) {
  if (!to) throw new Error('to is required');
  const row = await getRow(clientId, 'resend');
  const apiKey = decryptToken(row.config.api_key_enc);
  const from = row.config.from_name ? `${row.config.from_name} <${row.config.from_email}>` : row.config.from_email;

  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: subject || '(no subject)', html: html || undefined, text: html ? undefined : (text || '') }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Resend API ${res.status}`);
  return data.id;
}

// ======================================================================
// MANYCHAT — API key verified against /fb/page/getInfo. Inbound flow:
// ManyChat calls our per-client webhook URL (token generated here) when a
// subscriber triggers a flow, and we upsert a lead from it. Outbound:
// tagSubscriber/triggerFlow let automations act back on ManyChat.
// ======================================================================

async function connectManychat(clientId, { api_key }) {
  if (!api_key) throw new Error('ManyChat requires an API key (Settings -> API in ManyChat).');
  const res = await fetch(`${MANYCHAT_BASE}/fb/page/getInfo`, { headers: { Authorization: `Bearer ${api_key}` } });
  const data = await res.json();
  if (!res.ok || data.status !== 'success') throw new Error(data.message || 'ManyChat rejected that API key.');

  // Keep an existing webhook_token across reconnects so an already-wired-up
  // ManyChat flow doesn't need its webhook URL re-pasted every time.
  const { data: existing } = await supabase.from('crm_integrations').select('config')
    .eq('client_id', clientId).eq('integration_id', 'manychat').maybeSingle();
  const webhookToken = existing?.config?.webhook_token || crypto.randomBytes(24).toString('base64url');

  return upsertRow(clientId, 'manychat', {
    api_key_enc: encryptToken(api_key),
    page_id: data.data?.page_id || null,
    page_name: data.data?.name || null,
    webhook_token: webhookToken,
  });
}

async function getClientIdForManychatToken(webhookToken) {
  const { data, error } = await supabase.from('crm_integrations').select('client_id')
    .eq('integration_id', 'manychat').eq('status', 'connected')
    .filter('config->>webhook_token', 'eq', webhookToken).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.client_id || null;
}

/** Handles an inbound ManyChat subscriber-trigger webhook — upserts a lead
 * (source is 'instagram' or 'facebook' depending which platform ManyChat
 * says the subscriber came in on, since those are the enum values
 * crm_leads already supports) and logs the trigger as an inbound message
 * so it shows up in the unified inbox like every other channel. */
async function handleManychatWebhook(webhookToken, body) {
  const clientId = await getClientIdForManychatToken(webhookToken);
  if (!clientId) throw new Error('Unknown or disconnected ManyChat webhook token');

  const { first_name, last_name, ig_username, fb_id, manychat_id, email, phone: rawPhone, keyword, platform = 'instagram' } = body;
  const name = [first_name, last_name].filter(Boolean).join(' ').trim() || ig_username || fb_id || null;
  const phone = normalizePhone(rawPhone);
  const source = platform === 'facebook' ? 'facebook' : 'instagram';
  const externalId = manychat_id || fb_id || ig_username;

  const leadId = await findOrCreateLead(clientId, source, { phone: phone || null, externalId: externalId || null, email: email || null, name });
  if (keyword) {
    await recordMessage(clientId, leadId, { channel: source, direction: 'in', messageType: 'text', body: `[ManyChat trigger: ${keyword}]`, externalId: manychat_id });
  }
  return { lead_id: leadId };
}

/** Adds a ManyChat tag to a subscriber — for automations to call after a
 * CRM-side action (e.g. lead converted -> tag them in ManyChat too). */
async function manychatTagSubscriber(clientId, subscriberId, tagId) {
  const row = await getRow(clientId, 'manychat');
  const apiKey = decryptToken(row.config.api_key_enc);
  const res = await fetch(`${MANYCHAT_BASE}/fb/subscriber/addTag`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_id: subscriberId, tag_id: tagId }),
  });
  const data = await res.json();
  if (data.status !== 'success') throw new Error(data.message || 'ManyChat tag failed');
  return data;
}

async function manychatTriggerFlow(clientId, subscriberId, flowNs) {
  const row = await getRow(clientId, 'manychat');
  const apiKey = decryptToken(row.config.api_key_enc);
  const res = await fetch(`${MANYCHAT_BASE}/fb/sending/sendFlow`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriber_id: subscriberId, flow_ns: flowNs }),
  });
  const data = await res.json();
  if (data.status !== 'success') throw new Error(data.message || 'ManyChat flow trigger failed');
  return data;
}

module.exports = {
  listIntegrations, connectIntegration, disconnectIntegration,
  pollCalendlyBookings, sendResendEmail,
  handleManychatWebhook, manychatTagSubscriber, manychatTriggerFlow,
};
