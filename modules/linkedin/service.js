// modules/linkedin/service.js — Sign In with LinkedIn (OIDC) + Share on
// LinkedIn. Personal-profile posting only (no Company Page / Community
// Management access — that needs LinkedIn Marketing Developer Platform
// approval, out of scope here). Ported from the original repo's
// sm/platforms/linkedin.js + sm/routes/connections.js's finishLinkedIn.
//
// LinkedIn has no public API for reading a member's own feed, comments, or
// insights on personal posts — publishPost is the only operation this
// module supports, matching the source. Scheduling/automations that target
// linkedin fall back to caption-only (see crm_scheduled_posts.media_url
// comment in migrations/schema_full.sql); this module ignores mediaUrl.
const axios = require('axios');
const {
  buildAuthUrl, parseState, upsertConnection, getConnection,
  exchangeLinkedInCode, APP_BASE_URL, disconnectConnection,
} = require('../../shared/metaConnections');

function disconnect(userId) { return disconnectConnection(userId, 'linkedin'); }

const BASE = 'https://api.linkedin.com/v2';

function getAuthUrl(userId, returnTo) {
  return buildAuthUrl('linkedin', userId, returnTo);
}

async function handleOAuthCallback(code, state) {
  const { userId, returnTo } = parseState(state);
  const redirectUri = `${APP_BASE_URL}/api/linkedin/connect/callback`;
  const { accountId, accountName, accessToken, expiresAt } = await exchangeLinkedInCode(code, redirectUri);
  const connection = await upsertConnection(userId, {
    platform: 'linkedin', account_name: accountName, account_id: accountId,
    access_token: accessToken, token_expires_at: expiresAt,
  });
  return { connection, returnTo };
}

async function publishPost(userId, { caption }) {
  if (!caption) throw new Error('LinkedIn requires text content — set caption on the post.');
  const conn = await getConnection(userId, 'linkedin');
  const personUrn = `urn:li:person:${conn.account_id}`;

  // Unique idempotency key — LinkedIn's duplicate-post detection is based on
  // content + author + visibility, so retries of an identical caption would
  // otherwise get silently rejected.
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const res = await axios.post(
    `${BASE}/ugcPosts`,
    {
      author: personUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: caption },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    },
    {
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'X-Restli-Request-Id': requestId,
      },
    }
  );
  return res.data.id;
}

async function sendDM() {
  throw new Error('LinkedIn messaging requires Marketing Developer Platform access — not supported by this backend.');
}

module.exports = { getAuthUrl, handleOAuthCallback, publishPost, sendDM, disconnect };
