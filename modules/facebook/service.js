// modules/facebook/service.js — Facebook Page API: publish posts, reply to
// comments, send/receive Messenger DMs, list posts/comments/conversations.
// Ported from the original repo's sm/platforms/facebook.js (Graph API calls
// are unchanged) + sm/routes/connections.js's Facebook OAuth flow +
// sm/routes/webhooks.js's Facebook signature/event handling (minus the
// keyword/AI automation-matching engine, which is cross-platform and lives
// in modules/automations, not per-channel).
const axios = require('axios');
const crypto = require('crypto');
const {
  buildAuthUrl, parseState, upsertConnection, getConnection, resolveByAccountId,
  exchangeFacebookCode, signSelectionToken, parseSelectionToken, APP_BASE_URL, disconnectConnection,
} = require('../../shared/metaConnections');
const { resolveClientId, findOrCreateLead, recordMessage } = require('../../shared/crmMessages');

function disconnect(userId) { return disconnectConnection(userId, 'facebook'); }

/** Re-runs the webhook subscription for an already-connected Page, without a
 * full OAuth reconnect — for Pages connected before subscribeToPageWebhooks()
 * existed (see finishPage()), or if a subscription silently lapsed. */
async function resubscribeWebhooks(userId) {
  const conn = await getConnection(userId, 'facebook');
  if (!conn) throw new Error('No Facebook Page connected.');
  await subscribeToPageWebhooks(conn.account_id, conn.access_token);
  return { pageId: conn.account_id };
}

/** Diagnostic: asks Meta directly which fields THIS Page is currently
 * subscribed to (GET /{page-id}/subscribed_apps), as opposed to the
 * App Dashboard's webhook config, which only shows what the app is allowed
 * to receive across every Page — not what any one Page actually has turned
 * on. This is the per-Page state subscribeToPageWebhooks()/resubscribe
 * writes to. */
async function getWebhookStatus(userId) {
  const conn = await getConnection(userId, 'facebook');
  if (!conn) throw new Error('No Facebook Page connected.');
  // `fields=subscribed_fields` is NOT optional here — without it Graph
  // returns this edge's default field set (just `id`/`name`), so
  // subscribed_fields comes back undefined and every field looks "missing"
  // even right after a successful (re)subscribe.
  const res = await get(`${BASE}/${conn.account_id}/subscribed_apps`, { fields: 'subscribed_fields' }, conn.access_token);
  const app = (res.data || [])[0];
  const subscribedFields = app?.subscribed_fields || [];
  const expected = ['feed', 'comments', 'messages', 'messaging_postbacks'];
  return {
    pageId: conn.account_id,
    pageName: conn.account_name,
    subscribedFields,
    missingFields: expected.filter((f) => !subscribedFields.includes(f)),
  };
}

const VERSION = process.env.GRAPH_VERSION || 'v25.0';
const BASE = `https://graph.facebook.com/${VERSION}`;

async function get(url, params, token) {
  const res = await axios.get(url, { params: { ...params, access_token: token } });
  return res.data;
}
async function post(url, bodyParams, token) {
  const query = new URLSearchParams({ ...bodyParams, access_token: token }).toString();
  const res = await axios.post(`${url}?${query}`);
  return res.data;
}

// --- OAuth connect flow ---
function getAuthUrl(userId, returnTo) {
  return buildAuthUrl('facebook', userId, returnTo);
}

// Completes the connection for one already-chosen Page — shared by the
// single-Page fast path below and the picker's follow-up selection.
async function finishPage(userId, page, expiresAt) {
  const connection = await upsertConnection(userId, {
    platform: 'facebook', account_name: page.name, account_id: page.id,
    page_id: page.id, access_token: page.access_token, token_expires_at: expiresAt,
  });

  // Subscribe this app to the Page's webhooks so inbound feed comments and
  // Messenger DMs start arriving at POST /api/facebook/webhook. Without
  // this call, Meta simply never invokes the webhook for this Page — no
  // signature failure, no error, nothing in the webhook log, the request
  // just never happens. (Compare modules/whatsapp/service.js#connectAccount,
  // which does the WABA equivalent of this — Facebook Pages need their own
  // call.) `feed` covers Page post comments; `messages`/`messaging_postbacks`
  // cover Messenger DMs; `comments` is included too since Instagram business
  // accounts linked through this same Page (see below) are also subscribed
  // via this Page's subscribed_apps, not a separate call.
  await subscribeToPageWebhooks(page.id, page.access_token);

  // Auto-link the Page's connected Instagram business account, if any —
  // this is what lets modules/instagram reuse the same Page token.
  if (page.instagram_business_account) {
    const igId = page.instagram_business_account.id;
    const igRes = await axios.get(`${BASE}/${igId}`, { params: { fields: 'id,username', access_token: page.access_token } });
    await upsertConnection(userId, {
      platform: 'instagram', account_name: `@${igRes.data.username}`, account_id: igId,
      page_id: page.id, access_token: page.access_token, token_expires_at: expiresAt,
    });
  }
  return connection;
}

// See finishPage() above — logs a clear warning rather than throwing, so a
// subscription hiccup doesn't block the user from finishing "Connect", but
// still surfaces loudly in server logs instead of failing silently forever.
async function subscribeToPageWebhooks(pageId, pageAccessToken) {
  try {
    const res = await post(`${BASE}/${pageId}/subscribed_apps`, {
      subscribed_fields: 'feed,comments,messages,messaging_postbacks',
    }, pageAccessToken);
    if (!res.success) {
      console.error(`[facebook] subscribed_apps for Page ${pageId} returned success:false — webhooks will NOT arrive for this Page:`, res);
    }
  } catch (err) {
    console.error(`[facebook] failed to subscribe Page ${pageId} to webhooks — feed comments/DMs will NOT arrive until this succeeds:`, err.response?.data?.error?.message || err.message);
  }
}

async function handleOAuthCallback(code, state) {
  const { userId, returnTo } = parseState(state);
  const redirectUri = `${APP_BASE_URL}/api/facebook/connect/callback`;
  const { pages, expiresAt } = await exchangeFacebookCode(code, redirectUri);

  if (pages.length === 1) {
    const connection = await finishPage(userId, pages[0], expiresAt);
    return { connection, returnTo };
  }

  // More than one Page — don't guess. Hand back a short-lived token the
  // picker submits to POST /connect/select-page to finish connecting.
  const selectionToken = signSelectionToken({ userId, returnTo, pages, expiresAt });
  return {
    needsPageSelection: true,
    selectionToken,
    pages: pages.map((p) => ({ id: p.id, name: p.name, hasInstagram: !!p.instagram_business_account })),
  };
}

/** Finishes a connection after the user picked a Page from the multi-Page selector. */
async function selectPage(selectionToken, pageId) {
  const { userId, returnTo, pages, expiresAt } = parseSelectionToken(selectionToken);
  const page = pages.find((p) => p.id === pageId);
  if (!page) throw new Error('That Page was not in the original list — please reconnect.');
  const connection = await finishPage(userId, page, expiresAt ? new Date(expiresAt) : null);
  return { connection, returnTo };
}

// --- Graph API actions ---
async function publishPost(userId, { caption, mediaUrl }) {
  const conn = await getConnection(userId, 'facebook');
  if (mediaUrl) {
    const res = await post(`${BASE}/${conn.account_id}/photos`, { url: mediaUrl, caption: caption || '' }, conn.access_token);
    return res.post_id || res.id;
  }
  const res = await post(`${BASE}/${conn.account_id}/feed`, { message: caption || '' }, conn.access_token);
  return res.id;
}

async function listRecentPosts(userId, limit = 25) {
  const conn = await getConnection(userId, 'facebook');
  const res = await get(`${BASE}/${conn.account_id}/posts`, {
    fields: 'id,message,created_time,permalink_url,attachments{media{image,source},type,url}', limit,
  }, conn.access_token);
  return (res.data || []).map((p) => ({ ...p, thumbnail: p.attachments?.data?.[0]?.media?.image?.src || p.attachments?.data?.[0]?.url || null }));
}

async function replyToComment(userId, objectId, message) {
  const conn = await getConnection(userId, 'facebook');
  const res = await post(`${BASE}/${objectId}/comments`, { message }, conn.access_token);
  return res.id;
}

async function listRecentComments(userId, postLimit = 10) {
  const conn = await getConnection(userId, 'facebook');
  const posts = await get(`${BASE}/${conn.account_id}/posts`, { fields: 'id', limit: postLimit }, conn.access_token);
  const postIds = (posts.data || []).map((p) => p.id);
  const results = await Promise.all(postIds.map(async (postId) => {
    try {
      const res = await get(`${BASE}/${postId}/comments`, { fields: 'id,message,from,created_time', order: 'reverse_chronological', limit: 1 }, conn.access_token);
      const comment = (res.data || [])[0];
      if (!comment) return null;
      return { external_id: comment.id, media_id: postId, sender_id: comment.from?.id || null, sender_name: comment.from?.name || null, trigger_text: comment.message || '', created_at: comment.created_time };
    } catch { return null; }
  }));
  return results.filter(Boolean);
}

async function listConversations(userId, limit = 25) {
  const conn = await getConnection(userId, 'facebook');
  const res = await get(`${BASE}/${conn.account_id}/conversations`, { fields: 'participants,updated_time,messages.limit(1){message,from,created_time,id}', limit }, conn.access_token);
  return (res.data || []).map((convo) => {
    const latest = convo.messages?.data?.[0];
    if (!latest) return null;
    const other = (convo.participants?.data || []).find((p) => p.id !== conn.account_id) || convo.participants?.data?.[0];
    return { external_id: latest.id, sender_id: other?.id || latest.from?.id || null, sender_name: other?.name || latest.from?.name || null, trigger_text: latest.message || '', created_at: latest.created_time || convo.updated_time };
  }).filter(Boolean);
}

async function sendDM(userId, recipientId, text, replyToMid) {
  const conn = await getConnection(userId, 'facebook');
  const bodyParams = {
    recipient: JSON.stringify({ id: recipientId }), messaging_type: 'RESPONSE', message: JSON.stringify({ text }),
  };
  if (replyToMid) bodyParams.reply_to = JSON.stringify({ mid: replyToMid });
  const res = await post(`${BASE}/${conn.account_id}/messages`, bodyParams, conn.access_token);
  return res.message_id;
}

async function sendPrivateReply(userId, commentId, message) {
  const conn = await getConnection(userId, 'facebook');
  const res = await post(`${BASE}/${conn.account_id}/messages`, { recipient: JSON.stringify({ comment_id: commentId }), message: JSON.stringify({ text: message }) }, conn.access_token);
  return res.message_id;
}

/** Sends a raw Send API `message` object (e.g. an attachment/generic
 * template) — used for 'json'-format templates, where the template body IS
 * the `message` payload rather than plain text. `payload` should already be
 * shaped like the Send API's `message` field, e.g. { attachment: {...} }. */
async function sendDMRaw(userId, recipientId, payload, replyToMid) {
  const conn = await getConnection(userId, 'facebook');
  const bodyParams = {
    recipient: JSON.stringify({ id: recipientId }), messaging_type: 'RESPONSE', message: JSON.stringify(payload),
  };
  if (replyToMid) bodyParams.reply_to = JSON.stringify({ mid: replyToMid });
  const res = await post(`${BASE}/${conn.account_id}/messages`, bodyParams, conn.access_token);
  return res.message_id;
}

// ---------------------------------------------------------------------
// Webhook signature verification. Meta signs the raw body with the app
// secret; without this check, POST /webhook accepted any unsigned request,
// letting anyone forge inbound Facebook events. FB_SECRET is tried first,
// then IG_SECRET — Meta sometimes delivers Facebook Page events through an
// app configured under the Instagram secret when both share one Meta app.
// ---------------------------------------------------------------------
function verifySignature(rawBody, sigHeader) {
  const secrets = [process.env.FB_SECRET, process.env.IG_SECRET].filter(Boolean);
  if (!secrets.length) return true; // not configured — allow through (dev only)
  if (!sigHeader) return false;
  return secrets.some((secret) => {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try { return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected)); }
    catch { return false; }
  });
}

// ---------------------------------------------------------------------
// CRM persistence for inbound comments/DMs — closes the same loop built for
// WhatsApp (see modules/whatsapp/service.js): without this, webhook events
// never reached crm_messages, so modules/inbox stayed empty for Facebook.
// Auto-reply/keyword-matching on these events is a separate concern, handled
// by modules/automations, not here.
// ---------------------------------------------------------------------
async function handleCommentEvent({ pageId, commentId, text, senderId, senderName }) {
  const conn = await resolveByAccountId('facebook', pageId);
  if (!conn) return console.warn(`[facebook] comment on unknown Page ${pageId} — is that Page connected here?`);
  const clientId = await resolveClientId(conn.user_id);
  const leadId = await findOrCreateLead(clientId, 'facebook', { externalId: senderId, name: senderName, accountName: senderName });
  await recordMessage(clientId, leadId, { channel: 'facebook', direction: 'in', messageType: 'comment', body: text, externalId: commentId });
  // A reply the Page itself posts (whether from tryAutoReply below, or a
  // human agent replying manually) is itself a new comment on the post, so
  // it fires its own feed webhook event right back at this same handler.
  // Without this check, that self-authored comment would be treated as a
  // fresh inbound message and re-matched against automations — the AI
  // replying to its own reply, forever.
  if (senderId && senderId === pageId) return;
  await tryAutoReply({ userId: conn.user_id, clientId, leadId, text, send: (replyText) => replyToComment(conn.user_id, commentId, replyText), replyMessageType: 'comment' });
}

async function handleDmEvent({ pageId, mid, text, senderId, senderName }) {
  const conn = await resolveByAccountId('facebook', pageId);
  if (!conn) return console.warn(`[facebook] DM on unknown Page ${pageId} — is that Page connected here?`);
  const clientId = await resolveClientId(conn.user_id);
  const leadId = await findOrCreateLead(clientId, 'facebook', { externalId: senderId, name: senderName, accountName: senderName });
  await recordMessage(clientId, leadId, { channel: 'facebook', direction: 'in', messageType: 'text', body: text, externalId: mid });
  // Same self-authored guard as handleCommentEvent above. routes.js already
  // drops Messenger's own `is_echo` events before this is even called, but
  // that flag isn't guaranteed on every delivery path, so check the sender
  // id directly too as a second line of defense against an auto-reply loop.
  if (senderId && senderId === pageId) return;
  await tryAutoReply({
    userId: conn.user_id, clientId, leadId, text,
    send: (replyText) => sendDM(conn.user_id, senderId, replyText, mid),
    sendJson: (payload) => sendDMRaw(conn.user_id, senderId, payload, mid),
    replyMessageType: 'text',
  });
}

// Matches an active automation against inbound text and, if one fires,
// sends the reply through whichever function the caller passed (a comment
// reply or a DM, per the event type) and logs it + schedules a follow-up.
// Errors here are logged, not thrown — an automation misfiring should never
// take down the webhook handler that's persisting the inbound message.
async function tryAutoReply({ userId, clientId, leadId, text, send, sendJson, replyMessageType }) {
  if (!text) return;
  const automations = require('../automations/service');
  try {
    const match = await automations.matchRule(clientId, { text });
    if (match?.replyType === 'text' && match.text) {
      const externalId = await send(match.text);
      await recordMessage(clientId, leadId, { channel: 'facebook', direction: 'out', messageType: replyMessageType, body: match.text, externalId });
      if (match.rule.follow_up?.enabled) await automations.scheduleFollowUp(clientId, leadId, match.rule);
    } else if (match?.replyType === 'json' && match.payload && sendJson) {
      // JSON-format templates only apply to DMs (a raw payload can't be sent
      // as a comment reply, which is text-only) — replyMessageType stays
      // 'comment' for that path, so sendJson is simply not wired there.
      const externalId = await sendJson(match.payload);
      await recordMessage(clientId, leadId, { channel: 'facebook', direction: 'out', messageType: 'json', body: JSON.stringify(match.payload), externalId });
      if (match.rule.follow_up?.enabled) await automations.scheduleFollowUp(clientId, leadId, match.rule);
    }
  } catch (err) {
    console.error('[facebook] auto-reply failed:', err.message);
  }
}

module.exports = {
  getAuthUrl, handleOAuthCallback, selectPage, disconnect, resubscribeWebhooks, getWebhookStatus,
  publishPost, listRecentPosts, replyToComment, listRecentComments, listConversations, sendDM, sendDMRaw, sendPrivateReply,
  verifySignature, handleCommentEvent, handleDmEvent,
};
