// modules/instagram/service.js — Instagram Business API: publish media,
// reply to comments, send/receive DMs, list media/comments/conversations.
// Ported from the original repo's sm/platforms/instagram.js. Instagram can
// be connected two ways — via Facebook Login for Business (Page-linked, uses
// graph.facebook.com) or Direct Instagram Login (uses graph.instagram.com) —
// so every call tries the connection's primary host first and falls back to
// the other on an auth/capability error, exactly as the source did.
const axios = require('axios');
const crypto = require('crypto');
const { supabase } = require('../../shared/db');
const { decryptToken } = require('../../shared/crypto');
const {
  buildAuthUrl, parseState, upsertConnection, getConnection, resolveByAccountId,
  exchangeInstagramCode, APP_BASE_URL, disconnectConnection,
} = require('../../shared/metaConnections');
const { resolveClientId, findOrCreateLead, recordMessage } = require('../../shared/crmMessages');

function disconnect(userId) { return disconnectConnection(userId, 'instagram'); }

const FB_VERSION = process.env.GRAPH_VERSION || 'v25.0';
const FB_BASE = `https://graph.facebook.com/${FB_VERSION}`;
const IG_BASE = 'https://graph.instagram.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildGraphRequestCandidates(conn, arg = {}) {
  const options = typeof arg === 'string' ? { path: arg } : (arg || {});
  const path = options.path || '';
  // Only conn.account_id is ever a valid node for these IG edges (/media,
  // /media_publish, /messages, /conversations, ...) on EITHER host.
  // conn.page_id is the linked Facebook Page's id — it's a different graph
  // node entirely and is never a valid id to call these IG edges on, on
  // graph.facebook.com or graph.instagram.com. Passing it in used to work
  // by accident (the bogus /{page_id}/... call usually — but not always —
  // fails with a code that happens to be in the fallback's retry list), but
  // it wastes a request every time and breaks outright the moment Meta
  // returns a different error code for that call. See buildGraphRequestCandidates
  // test for the (deliberately id-agnostic) shape callers can rely on.
  const entityIds = options.entityIds || (conn ? [conn.account_id] : []);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  // Try the host that matches how this connection was made first: Page-linked
  // (Facebook Login for Business, page_id set, Page-token) goes to
  // graph.facebook.com first; Direct Instagram Login (no page_id, an
  // Instagram-issued user token) goes to graph.instagram.com first. The
  // other host is still tried as a fallback, since some edges (e.g. comment
  // replies) work on both regardless of connection type.
  const hosts = conn?.page_id ? [FB_BASE, IG_BASE] : [IG_BASE, FB_BASE];
  const ids = [...new Set((entityIds || []).filter(Boolean))];
  const candidates = [];
  if (!ids.length) {
    for (const host of hosts) candidates.push(`${host}${normalizedPath}`);
    return candidates;
  }
  for (const host of hosts) {
    for (const id of ids) candidates.push(`${host}/${id}${normalizedPath}`);
  }
  return [...new Set(candidates)];
}

async function get(url, params, token) { return (await axios.get(url, { params: { ...params, access_token: token } })).data; }
async function post(url, bodyParams, token) {
  const query = new URLSearchParams({ ...bodyParams, access_token: token }).toString();
  return (await axios.post(`${url}?${query}`)).data;
}

async function withFallback(conn, path, params, token, method, entityIds = []) {
  const urls = buildGraphRequestCandidates(conn, { path, entityIds });
  let lastError = null;
  for (const url of urls) {
    try {
      const data = method === 'post' ? await post(url, params, token) : await get(url, params, token);
      return { success: true, data };
    } catch (err) {
      lastError = err;
      const code = err.response?.data?.error?.code;
      const status = err.response?.status;
      const message = err.response?.data?.error?.message || err.message;
      console.log(`[instagram] ${method.toUpperCase()} ${url} failed — code=${code ?? 'n/a'} status=${status ?? 'n/a'}: ${message}`);
      if (![3, 100, 190].includes(code) && ![401, 403].includes(status)) break;
      console.log(`[instagram] retrying on fallback host...`);
    }
  }
  return { success: false, error: lastError };
}

// --- OAuth connect flow (Direct Instagram Login) ---
function getAuthUrl(userId, returnTo) {
  return buildAuthUrl('instagram', userId, returnTo);
}
async function handleOAuthCallback(code, state) {
  const { userId, returnTo } = parseState(state);
  const redirectUri = `${APP_BASE_URL}/api/instagram/connect/callback`;
  const { accountId, accountName, accessToken, expiresAt } = await exchangeInstagramCode(code, redirectUri);
  const connection = await upsertConnection(userId, { platform: 'instagram', account_name: accountName, account_id: accountId, access_token: accessToken, token_expires_at: expiresAt });
  // Direct Instagram Login (graph.instagram.com, no linked Facebook Page)
  // does NOT auto-deliver webhooks the way Page-subscribed Facebook events
  // do — Meta requires an explicit per-account subscribe call, or comment/DM
  // webhooks for this account will simply never arrive.
  try {
    await axios.post(`https://graph.instagram.com/${FB_VERSION}/${accountId}/subscribed_apps`, null, {
      params: { subscribed_fields: 'comments,messages', access_token: accessToken },
    });
  } catch (err) {
    console.error(`[instagram] subscribed_apps failed for account ${accountId} — webhooks will NOT arrive:`, err.response?.data?.error?.message || err.message);
  }
  return { connection, returnTo };
}

// --- Graph API actions ---
async function publishPost(userId, { caption, mediaUrl }) {
  if (!mediaUrl) throw new Error('Instagram requires an image_url.');
  const conn = await getConnection(userId, 'instagram');
  console.log(`[instagram] publishPost: account_id=${conn.account_id} page_id=${conn.page_id || 'none'} mediaUrl=${mediaUrl}`);

  const create = await withFallback(conn, '/media', { image_url: mediaUrl, caption: caption || '' }, conn.access_token, 'post', [conn.account_id]);
  if (!create.success) {
    console.log(`[instagram] media container creation failed:`, create.error.response?.data?.error || create.error.message);
    throw create.error;
  }
  const creationId = create.data.id;
  console.log(`[instagram] media container created: ${creationId}`);

  // Poll the container's processing status before publishing — mirrors the
  // reference implementation (sanjayaidev/MetaWhatsappAPI's
  // sm/platforms/instagram.js) exactly: 5 tries, 2s apart, then proceed to
  // media_publish regardless of the final status_code. status_code doesn't
  // reliably reach FINISHED before Meta is willing to publish, and gating
  // hard on it isn't confirmed against Meta's actual behavior across IG API
  // versions/account types — it's a plausible-sounding "improvement" that
  // rejects containers Meta would have published, and polling for up to 2
  // minutes in a single request risks timing the request out before
  // media_publish is ever called. If media_publish itself fails, that error
  // is surfaced below and is more trustworthy than second-guessing
  // status_code here.
  let statusCode = 'IN_PROGRESS';
  for (let i = 0; i < 5 && statusCode === 'IN_PROGRESS'; i++) {
    await sleep(2000);
    const statusRes = await withFallback(conn, `/${creationId}`, { fields: 'status_code' }, conn.access_token, 'get');
    if (!statusRes.success) {
      console.log(`[instagram] status check failed:`, statusRes.error.response?.data?.error || statusRes.error.message);
      throw statusRes.error;
    }
    statusCode = statusRes.data.status_code;
    console.log(`[instagram] container ${creationId} status: ${statusCode} (attempt ${i + 1}/5)`);
  }
  const publish = await withFallback(conn, '/media_publish', { creation_id: creationId }, conn.access_token, 'post', [conn.account_id]);
  if (!publish.success) {
    console.log(`[instagram] media_publish failed:`, publish.error.response?.data?.error || publish.error.message);
    throw publish.error;
  }
  console.log(`[instagram] published: ${publish.data.id}`);
  return publish.data.id;
}

async function replyToComment(userId, commentId, message) {
  const conn = await getConnection(userId, 'instagram');
  const result = await withFallback(conn, `/${commentId}/replies`, { message }, conn.access_token, 'post');
  if (!result.success) throw result.error;
  return result.data.id;
}

async function sendDM(userId, recipientId, text, replyToMid) {
  const conn = await getConnection(userId, 'instagram');
  const bodyParams = { recipient: JSON.stringify({ id: recipientId }), messaging_type: 'RESPONSE', message: JSON.stringify({ text }) };
  if (replyToMid) bodyParams.reply_to = JSON.stringify({ mid: replyToMid });
  const result = await withFallback(conn, '/messages', bodyParams, conn.access_token, 'post', [conn.account_id]);
  if (!result.success) throw result.error;
  return result.data.message_id;
}

async function sendPrivateReply(userId, commentId, message) {
  const conn = await getConnection(userId, 'instagram');
  const result = await withFallback(conn, '/messages', { recipient: JSON.stringify({ comment_id: commentId }), message: JSON.stringify({ text: message }) }, conn.access_token, 'post', [conn.account_id]);
  if (!result.success) throw result.error;
  return result.data.message_id;
}

/** Sends a raw Send API `message` object — used for 'json'-format templates,
 * where the template body IS the payload rather than plain text. */
async function sendDMRaw(userId, recipientId, payload, replyToMid) {
  const conn = await getConnection(userId, 'instagram');
  const bodyParams = { recipient: JSON.stringify({ id: recipientId }), messaging_type: 'RESPONSE', message: JSON.stringify(payload) };
  if (replyToMid) bodyParams.reply_to = JSON.stringify({ mid: replyToMid });
  const result = await withFallback(conn, '/messages', bodyParams, conn.access_token, 'post', [conn.account_id]);
  if (!result.success) throw result.error;
  return result.data.message_id;
}

// ---------------------------------------------------------------------
// Webhook signature verification. IG_SECRET is tried first, then FB_SECRET
// as a fallback — Meta sometimes delivers Instagram events through an app
// configured under the Facebook secret when both share one Meta app.
// ---------------------------------------------------------------------
function verifySignature(rawBody, sigHeader) {
  const secrets = [process.env.IG_SECRET, process.env.FB_SECRET].filter(Boolean);
  if (!secrets.length) return true; // not configured — allow through (dev only)
  if (!sigHeader) return false;
  return secrets.some((secret) => {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try { return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected)); }
    catch { return false; }
  });
}

// ---------------------------------------------------------------------
// CRM persistence for inbound comments/DMs — same loop as WhatsApp/Facebook
// (see modules/whatsapp/service.js). Auto-reply/keyword-matching is a
// separate concern handled by modules/automations, not here.
// ---------------------------------------------------------------------

// Meta bug workaround (see migrations/012_instagram_webhook_account_id.sql):
// graph.instagram.com/me and Instagram's own webhooks disagree on this
// account's ID for the same account. If a normal lookup misses and there's
// exactly ONE connected Instagram account still missing its
// webhook_account_id, we assume the mismatch is that account, record the ID
// so future events resolve directly, and continue processing this one
// instead of dropping it. Ambiguous (0 or 2+ candidates) still just warns —
// silently guessing which of multiple accounts an event belongs to would be
// worse than dropping it.
async function resolveOrHealAccount(accountId) {
  const conn = await resolveByAccountId('instagram', accountId);
  if (conn) return conn;
  // Meta's own "Test" button in the App Dashboard sends entry.id: "0" —
  // a canned placeholder, not a real account. Never let that (or any other
  // falsy id) get self-healed onto a real connection.
  if (!accountId || accountId === '0') return null;
  const { data: candidates } = await supabase.from('crm_connections')
    .select('*').eq('platform', 'instagram').eq('is_connected', true).is('webhook_account_id', null);
  if ((candidates || []).length !== 1) return null;
  const candidate = candidates[0];
  console.warn(`[instagram] self-healing: binding webhook_account_id=${accountId} to connection ${candidate.id} (${candidate.account_name}, account_id=${candidate.account_id}) — this is Meta's known me-vs-webhook ID mismatch, not a new account.`);
  const { error } = await supabase.from('crm_connections').update({ webhook_account_id: accountId }).eq('id', candidate.id);
  if (error) { console.error('[instagram] failed to persist webhook_account_id:', error.message); return null; }
  return { ...candidate, webhook_account_id: accountId, access_token: decryptToken(candidate.access_token_enc) };
}

async function handleCommentEvent({ accountId, commentId, text, senderId, senderName }) {
  const conn = await resolveOrHealAccount(accountId);
  if (!conn) {
    const { data: connected } = await supabase.from('crm_connections')
      .select('account_id, webhook_account_id, account_name').eq('platform', 'instagram').eq('is_connected', true);
    const known = (connected || []).map((c) => `${c.account_name}=${c.account_id}${c.webhook_account_id ? `/${c.webhook_account_id}` : ''}`).join(', ') || 'none';
    return console.warn(`[instagram] comment on unknown account ${accountId} — is that account connected here? (currently connected: ${known})`);
  }
  const clientId = await resolveClientId(conn.user_id);
  const leadId = await findOrCreateLead(clientId, 'instagram', { externalId: senderId, name: senderName });
  await recordMessage(clientId, leadId, { channel: 'instagram', direction: 'in', messageType: 'comment', body: text, externalId: commentId });
  // A reply the connected account itself posts (via tryAutoReply below, or
  // a human agent replying manually) is itself a new comment on the media,
  // so it fires its own webhook event right back at this same handler.
  // Without this check, that self-authored comment would be treated as a
  // fresh inbound message and re-matched against automations — the AI
  // replying to its own reply, forever.
  if (senderId && senderId === accountId) return;
  await tryAutoReply({ clientId, leadId, text, send: (replyText) => replyToComment(conn.user_id, commentId, replyText), replyMessageType: 'comment' });
}

async function handleDmEvent({ accountId, mid, text, senderId, senderName }) {
  const conn = await resolveOrHealAccount(accountId);
  if (!conn) return console.warn(`[instagram] DM on unknown account ${accountId} — is that account connected here?`);
  const clientId = await resolveClientId(conn.user_id);
  const leadId = await findOrCreateLead(clientId, 'instagram', { externalId: senderId, name: senderName });
  await recordMessage(clientId, leadId, { channel: 'instagram', direction: 'in', messageType: 'text', body: text, externalId: mid });
  // Same self-authored guard as handleCommentEvent above — an outbound DM
  // the account sends can otherwise loop back through the webhook as if it
  // were a new inbound message from itself.
  if (senderId && senderId === accountId) return;
  await tryAutoReply({
    clientId, leadId, text,
    send: (replyText) => sendDM(conn.user_id, senderId, replyText, mid),
    sendJson: (payload) => sendDMRaw(conn.user_id, senderId, payload, mid),
    replyMessageType: 'text',
  });
}

// Matches an active automation against inbound text and, if one fires,
// sends the reply through whichever function the caller passed (a comment
// reply or a DM) and logs it + schedules a follow-up. Errors are logged,
// not thrown — an automation misfiring shouldn't take down the webhook
// handler that's persisting the inbound message.
async function tryAutoReply({ clientId, leadId, text, send, sendJson, replyMessageType }) {
  if (!text) return;
  const automations = require('../automations/service');
  try {
    const match = await automations.matchRule(clientId, { text });
    if (match?.replyType === 'text' && match.text) {
      const externalId = await send(match.text);
      await recordMessage(clientId, leadId, { channel: 'instagram', direction: 'out', messageType: replyMessageType, body: match.text, externalId });
      if (match.rule.follow_up?.enabled) await automations.scheduleFollowUp(clientId, leadId, match.rule);
    } else if (match?.replyType === 'json' && match.payload && sendJson) {
      const externalId = await sendJson(match.payload);
      await recordMessage(clientId, leadId, { channel: 'instagram', direction: 'out', messageType: 'json', body: JSON.stringify(match.payload), externalId });
      if (match.rule.follow_up?.enabled) await automations.scheduleFollowUp(clientId, leadId, match.rule);
    }
  } catch (err) {
    console.error('[instagram] auto-reply failed:', err.message);
  }
}

module.exports = {
  getAuthUrl, handleOAuthCallback, disconnect,
  publishPost, replyToComment, sendDM, sendDMRaw, sendPrivateReply,
  verifySignature, handleCommentEvent, handleDmEvent,
  buildGraphRequestCandidates,
};