// modules/instagram/service.js — Instagram Business API: publish media,
// reply to comments, send/receive DMs, list media/comments/conversations.
// Ported from the original repo's sm/platforms/instagram.js. Instagram can
// be connected two ways — via Facebook Login for Business (Page-linked, uses
// graph.facebook.com) or Direct Instagram Login (uses graph.instagram.com) —
// so every call tries the connection's primary host first and falls back to
// the other on an auth/capability error, exactly as the source did.
const axios = require('axios');
const crypto = require('crypto');
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
      if (![3, 100, 190].includes(code) && ![401, 403].includes(status)) break;
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
  return { connection, returnTo };
}

// --- Graph API actions ---
async function publishPost(userId, { caption, mediaUrl }) {
  if (!mediaUrl) throw new Error('Instagram requires an image_url.');
  const conn = await getConnection(userId, 'instagram');
  const create = await withFallback(conn, '/media', { image_url: mediaUrl, caption: caption || '' }, conn.access_token, 'post', [conn.account_id]);
  if (!create.success) throw create.error;
  const creationId = create.data.id;

  // Poll the container's processing status before publishing. Meta processes
  // media asynchronously — publishing while it's still IN_PROGRESS fails
  // with "Media ID is not available" (and publishing an ERRORed container
  // fails too), so both cases need to be caught here with a clear message
  // instead of blindly calling media_publish and surfacing Meta's opaque
  // error. Videos in particular can take well over 10s to process, so this
  // polls up to ~2 minutes rather than giving up after 5 tries.
  let statusCode = 'IN_PROGRESS';
  for (let i = 0; i < 60 && statusCode === 'IN_PROGRESS'; i++) {
    await sleep(2000);
    const statusRes = await withFallback(conn, `/${creationId}`, { fields: 'status_code' }, conn.access_token, 'get');
    if (!statusRes.success) throw statusRes.error;
    statusCode = statusRes.data.status_code;
  }
  if (statusCode === 'ERROR') {
    throw new Error(`Instagram media container ${creationId} failed processing (status_code=ERROR) — check that the image/video URL is publicly reachable and in a supported format.`);
  }
  if (statusCode !== 'FINISHED') {
    throw new Error(`Instagram media container ${creationId} did not finish processing in time (status_code=${statusCode}) — try again.`);
  }
  const publish = await withFallback(conn, '/media_publish', { creation_id: creationId }, conn.access_token, 'post', [conn.account_id]);
  if (!publish.success) throw publish.error;
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

async function listRecentMedia(userId, limit = 25) {
  const conn = await getConnection(userId, 'instagram');
  const result = await withFallback(conn, '/media', { fields: 'id,caption,timestamp,permalink,media_type,media_url,thumbnail_url', limit }, conn.access_token, 'get', [conn.account_id]);
  if (!result.success) throw result.error;
  return result.data.data || [];
}

async function listRecentComments(userId, postLimit = 10) {
  const conn = await getConnection(userId, 'instagram');
  const mediaResult = await withFallback(conn, '/media', { fields: 'id', limit: postLimit }, conn.access_token, 'get', [conn.account_id]);
  if (!mediaResult.success) throw mediaResult.error;
  const mediaIds = (mediaResult.data.data || []).map((m) => m.id);
  const results = await Promise.all(mediaIds.map(async (mediaId) => {
    const res = await withFallback(conn, `/${mediaId}/comments`, { fields: 'id,text,username,timestamp,from', order: 'reverse_chronological', limit: 1 }, conn.access_token, 'get');
    if (!res.success) return null;
    const comment = (res.data.data || [])[0];
    if (!comment) return null;
    return { external_id: comment.id, media_id: mediaId, sender_id: comment.from?.id || null, sender_name: comment.username || comment.from?.username || null, trigger_text: comment.text || '', created_at: comment.timestamp };
  }));
  return results.filter(Boolean);
}

async function listConversations(userId, limit = 25) {
  const conn = await getConnection(userId, 'instagram');
  const res = await withFallback(conn, '/conversations', { platform: 'instagram', fields: 'participants,updated_time,messages.limit(1){message,from,created_time,id}', limit }, conn.access_token, 'get', [conn.account_id]);
  if (!res.success) throw res.error;
  return (res.data.data || []).map((convo) => {
    const latest = convo.messages?.data?.[0];
    if (!latest) return null;
    const other = (convo.participants?.data || []).find((p) => p.id !== conn.account_id) || convo.participants?.data?.[0];
    return { external_id: latest.id, sender_id: other?.id || latest.from?.id || null, sender_name: other?.username || latest.from?.username || null, trigger_text: latest.message || '', created_at: latest.created_time || convo.updated_time };
  }).filter(Boolean);
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
async function handleCommentEvent({ accountId, commentId, text, senderId, senderName }) {
  const conn = await resolveByAccountId('instagram', accountId);
  if (!conn) return console.warn(`[instagram] comment on unknown account ${accountId} — is that account connected here?`);
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
  const conn = await resolveByAccountId('instagram', accountId);
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
  publishPost, replyToComment, sendDM, sendDMRaw, sendPrivateReply, listRecentMedia, listRecentComments, listConversations,
  verifySignature, handleCommentEvent, handleDmEvent,
  buildGraphRequestCandidates,
};
