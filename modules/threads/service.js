// modules/threads/service.js — Threads API: publish text/media posts, reply
// to threads, list recent threads/replies. Ported from the original repo's
// sm/platforms/threads.js. Threads has no DM/messaging API as of this
// writing — sendDM below intentionally throws, matching the source.
const axios = require('axios');
const crypto = require('crypto');
const {
  buildAuthUrl, parseState, upsertConnection, getConnection, resolveByAccountId,
  exchangeThreadsCode, APP_BASE_URL, disconnectConnection,
} = require('../../shared/metaConnections');
const { resolveClientId, findOrCreateLead, recordMessage, messageExists, isOwnOutboundReply } = require('../../shared/crmMessages');

function disconnect(userId) { return disconnectConnection(userId, 'threads'); }

const VERSION = process.env.THREADS_VERSION || 'v1.0';
const BASE = `https://graph.threads.net/${VERSION}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, bodyParams, token) {
  const query = new URLSearchParams({ ...bodyParams, access_token: token }).toString();
  return (await axios.post(`${url}?${query}`)).data;
}

function getAuthUrl(userId, returnTo) {
  return buildAuthUrl('threads', userId, returnTo);
}
async function handleOAuthCallback(code, state) {
  const { userId, returnTo } = parseState(state);
  const redirectUri = `${APP_BASE_URL}/api/threads/connect/callback`;
  const { accountId, accountName, accessToken, expiresAt } = await exchangeThreadsCode(code, redirectUri);
  const connection = await upsertConnection(userId, { platform: 'threads', account_name: accountName, account_id: accountId, access_token: accessToken, token_expires_at: expiresAt });
  return { connection, returnTo };
}

async function publishPost(userId, { caption, mediaUrl }) {
  const conn = await getConnection(userId, 'threads');
  let create;
  if (mediaUrl) {
    const urlLower = mediaUrl.toLowerCase();
    const isVideo = /\.(mp4|mov|avi)$/.test(urlLower);
    const bodyParams = { media_type: isVideo ? 'VIDEO' : 'IMAGE', text: caption || '' };
    bodyParams[isVideo ? 'video_url' : 'image_url'] = mediaUrl;
    create = await post(`${BASE}/${conn.account_id}/threads`, bodyParams, conn.access_token);
    await sleep(isVideo ? 60000 : 30000);
  } else {
    create = await post(`${BASE}/${conn.account_id}/threads`, { media_type: 'TEXT', text: caption || '' }, conn.access_token);
    await sleep(30000);
  }
  const publish = await post(`${BASE}/${conn.account_id}/threads_publish`, { creation_id: create.id }, conn.access_token);
  return publish.id;
}

async function replyToThread(userId, replyToId, text) {
  const conn = await getConnection(userId, 'threads');
  const create = await post(`${BASE}/${conn.account_id}/threads`, { media_type: 'TEXT', text, reply_to_id: replyToId }, conn.access_token);
  await sleep(30000);
  const publish = await post(`${BASE}/${conn.account_id}/threads_publish`, { creation_id: create.id }, conn.access_token);
  return publish.id;
}

async function listRecentThreads(userId, limit = 25) {
  const conn = await getConnection(userId, 'threads');
  const res = await axios.get(`${BASE}/${conn.account_id}/threads`, {
    params: { fields: 'id,text,timestamp,permalink,media_type,threads_media{media_type,image_url,video_url}', limit, access_token: conn.access_token },
  });
  return res.data.data || [];
}

async function listRecentComments(userId, limit = 10) {
  const conn = await getConnection(userId, 'threads');
  const threadsRes = await axios.get(`${BASE}/${conn.account_id}/threads`, { params: { fields: 'id', limit, access_token: conn.access_token } });
  const threadIds = (threadsRes.data.data || []).map((t) => t.id);
  const results = await Promise.all(threadIds.map(async (threadId) => {
    try {
      const res = await axios.get(`${BASE}/${threadId}/replies`, { params: { fields: 'id,text,username,timestamp', access_token: conn.access_token } });
      const reply = (res.data.data || [])[0];
      if (!reply) return null;
      return { external_id: reply.id, media_id: threadId, sender_id: null, sender_name: reply.username || null, trigger_text: reply.text || '', created_at: reply.timestamp };
    } catch { return null; }
  }));
  return results.filter(Boolean);
}

// Threads' webhook payload carries no sender id (see handleReplyEvent's
// identity comment) — only the reply's own id. Fetching the reply object
// on read (fields=username) is the one place that id becomes a person: the
// same GET Meta's own docs point to for attributing a reply, same shape as
// the username field already used above in listRecentComments. Returns
// null (rather than throwing) on any failure so a lookup hiccup degrades
// to "treat as a new person" instead of dropping the message entirely.
async function getReplyAuthorUsername(accessToken, replyId) {
  try {
    const res = await axios.get(`${BASE}/${replyId}`, { params: { fields: 'username', access_token: accessToken } });
    return res.data?.username || null;
  } catch (err) {
    console.warn('[threads] failed to look up reply author:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

async function sendDM() {
  throw new Error('Threads has no DM/messaging API — this is a platform limitation, not a bug.');
}

// ---------------------------------------------------------------------
// Webhook signature verification. TH_SECRET tried first, then IG_SECRET,
// then FB_SECRET — Meta sometimes delivers Threads events through an app
// configured under a sibling platform's secret when they share one Meta app.
// ---------------------------------------------------------------------
function verifySignature(rawBody, sigHeader) {
  const secrets = [process.env.TH_SECRET, process.env.IG_SECRET, process.env.FB_SECRET].filter(Boolean);
  if (!secrets.length) return true; // not configured — allow through (dev only)
  if (!sigHeader) return false;
  return secrets.some((secret) => {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try { return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected)); }
    catch { return false; }
  });
}

// Threads' webhook payload arrives in two shapes depending on topic:
//  - modern: { topic: 'moderate'|'interaction', values: [{ uid, value: { text, id, root_post, replied_to } }] }
//  - legacy: { entry: [{ id, changes: [{ field: 'replies'|'comments', value }] }] }
// Normalizes both into a flat { text, replyId, mediaId, accountId }[] list.
// 'interaction' topic events (new posts, no comment text) are skipped.
function parseInboundEvents(payload) {
  const items = [];
  if (Array.isArray(payload.values)) {
    for (const item of payload.values) {
      const value = item.value || {};
      if (payload.topic === 'interaction' && !value.text) continue;
      if (payload.topic === 'moderate' || value.text) {
        items.push({
          text: value.text, replyId: value.id,
          mediaId: value.root_post?.id || value.replied_to?.id || payload.target_id,
          accountId: item.uid || value.root_post?.owner_id || null,
        });
      }
    }
  } else {
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'replies' && change.field !== 'comments') continue;
        const value = change.value || {};
        items.push({ text: value.text, replyId: value.id, mediaId: value.media?.id || entry.id, accountId: entry.id });
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------
// CRM persistence for inbound replies — same loop as WhatsApp/Facebook/
// Instagram. Auto-reply/keyword-matching is handled by modules/automations,
// not here.
// ---------------------------------------------------------------------
async function handleReplyEvent({ accountId, replyId, text }) {
  const conn = await resolveByAccountId('threads', accountId);
  if (!conn) return console.warn(`[threads] reply on unknown account ${accountId} — is that account connected here?`);
  const clientId = await resolveClientId(conn.user_id);

  // Self-authored guard, same purpose as Instagram/Facebook's
  // `senderId === accountId` check in their handleCommentEvent/handleDmEvent
  // — a reply the connected account itself posts (manual send or
  // auto-reply) fires its own webhook event right back at this handler.
  // Without this, the connected account ends up replying to its own reply,
  // forever. See isOwnOutboundReply's doc comment for why Threads needs a
  // different signal than sender-id comparison.
  if (await isOwnOutboundReply(clientId, 'threads', replyId)) return;

  // Idempotency guard for plain redelivery — Meta/Threads can redeliver the
  // exact same inbound event more than once. Bail out if we've already
  // recorded THIS inbound reply, so a redelivered event doesn't create a
  // second lead/message or re-fire an automation.
  if (await messageExists(clientId, 'threads', replyId)) return;

  // Lead identity. The webhook event itself gives us only the reply's own
  // id (replyId) — not who posted it — so on its own that id is a stand-in
  // for "this specific message", not "this specific person"; using it
  // directly as the lead's identity, like the old code did, meant every
  // reply from the same person landed as a brand new lead. A username
  // lookup (see getReplyAuthorUsername) is Threads' equivalent of the
  // sender id Instagram/Facebook get for free on the webhook payload — it's
  // stable per person, so it's what dedupes repeat replies from the same
  // person onto one lead the way every other channel already does. Falls
  // back to replyId (old behavior) only if the lookup itself fails, so a
  // flaky API call degrades to "new lead" instead of losing the message.
  const username = await getReplyAuthorUsername(conn.access_token, replyId);
  const leadId = await findOrCreateLead(clientId, 'threads', { externalId: username || replyId, name: username || null });
  await recordMessage(clientId, leadId, { channel: 'threads', direction: 'in', messageType: 'comment', body: text, externalId: replyId });

  // Auto-reply matching. No DM fallback here — Threads has no messaging API
  // (see sendDM above), so a matched rule only ever posts a public reply.
  if (text) {
    const automations = require('../automations/service');
    try {
      const match = await automations.matchRule(clientId, { text });
      if (match?.replyType === 'text' && match.text) {
        const externalId = await replyToThread(conn.user_id, replyId, match.text);
        await recordMessage(clientId, leadId, { channel: 'threads', direction: 'out', messageType: 'comment', body: match.text, externalId });
        if (match.rule.follow_up?.enabled) await automations.scheduleFollowUp(clientId, leadId, match.rule);
      }
    } catch (err) {
      console.error('[threads] auto-reply failed:', err.message);
    }
  }
}

module.exports = {
  getAuthUrl, handleOAuthCallback, disconnect, publishPost, replyToThread, listRecentThreads, listRecentComments, sendDM,
  verifySignature, parseInboundEvents, handleReplyEvent,
};