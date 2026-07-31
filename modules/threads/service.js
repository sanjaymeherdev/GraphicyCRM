// modules/threads/service.js — Threads API: publish text/media posts, reply
// to threads, list recent threads/replies. Ported from the original repo's
// sm/platforms/threads.js. Threads has no DM/messaging API as of this
// writing — sendDM below intentionally throws, matching the source.
const axios = require('axios');
const {
  buildAuthUrl, parseState, upsertConnection, getConnection,
  exchangeThreadsCode, APP_BASE_URL,
} = require('../../shared/metaConnections');

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

async function sendDM() {
  throw new Error('Threads has no DM/messaging API — this is a platform limitation, not a bug.');
}

module.exports = { getAuthUrl, handleOAuthCallback, publishPost, replyToThread, listRecentThreads, listRecentComments, sendDM };
