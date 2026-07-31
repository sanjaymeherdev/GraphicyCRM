// modules/facebook/service.js — Facebook Page API: publish posts, reply to
// comments, send/receive Messenger DMs, list posts/comments/conversations.
// Ported from the original repo's sm/platforms/facebook.js (Graph API calls
// are unchanged) + sm/routes/connections.js's Facebook OAuth flow.
const axios = require('axios');
const {
  buildAuthUrl, parseState, upsertConnection, getConnection,
  exchangeFacebookCode, APP_BASE_URL,
} = require('../../shared/metaConnections');

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

async function handleOAuthCallback(code, state) {
  const { userId, returnTo } = parseState(state);
  const redirectUri = `${APP_BASE_URL}/api/facebook/connect/callback`;
  const { pages, expiresAt } = await exchangeFacebookCode(code, redirectUri);
  // Connect the first Page (extend with a picker UI if the user manages several).
  const page = pages[0];
  const connection = await upsertConnection(userId, {
    platform: 'facebook', account_name: page.name, account_id: page.id,
    page_id: page.id, access_token: page.access_token, token_expires_at: expiresAt,
  });

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

module.exports = {
  getAuthUrl, handleOAuthCallback,
  publishPost, listRecentPosts, replyToComment, listRecentComments, listConversations, sendDM, sendPrivateReply,
};
