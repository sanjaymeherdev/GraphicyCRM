// modules/linkedin/service.js — Sign In with LinkedIn (OIDC) + Share on
// LinkedIn. Personal-profile posting only (no Company Page / Community
// Management access — that needs LinkedIn Marketing Developer Platform
// approval, out of scope here). Ported from the original repo's
// sm/platforms/linkedin.js + sm/routes/connections.js's finishLinkedIn.
//
// LinkedIn has no public API for reading a member's own feed, comments, or
// insights on personal posts — publishPost is the only operation this
// module supports, matching the source.
//
// Media support: unlike Meta's Graph API (which fetches image_url/video_url
// itself server-side), LinkedIn's Assets API requires the bytes to be
// pushed to an upload URL it hands back from a registerUpload call — it
// never fetches a public URL on its own. So publishPost downloads mediaUrl
// itself and re-uploads it to LinkedIn before creating the UGC post.
const axios = require('axios');
const {
  buildAuthUrl, parseState, upsertConnection, getConnection,
  exchangeLinkedInCode, APP_BASE_URL, disconnectConnection,
} = require('../../shared/metaConnections');

function disconnect(userId) { return disconnectConnection(userId, 'linkedin'); }

const BASE = 'https://api.linkedin.com/v2';
const VIDEO_EXTENSIONS = /\.(mp4|mov|avi|wmv|flv|mkv|webm)(\?.*)?$/i;

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

// Registers a pending media upload for `ownerUrn` and returns the URL to PUT
// the file's bytes to, plus the asset URN to reference in the UGC post.
async function registerUpload(ownerUrn, token, recipe) {
  const res = await axios.post(
    `${BASE}/assets?action=registerUpload`,
    {
      registerUploadRequest: {
        recipes: [recipe],
        owner: ownerUrn,
        serviceRelationships: [
          { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
        ],
      },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  const value = res.data.value;
  const uploadUrl = value.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  if (!uploadUrl) throw new Error('LinkedIn registerUpload did not return an upload URL — unexpected response shape.');
  return { uploadUrl, asset: value.asset };
}

// Downloads the file from our mediaUrl and pushes its bytes to the upload
// URL LinkedIn just handed back. LinkedIn's upload endpoint takes the raw
// binary body directly (no multipart/form-data wrapper).
async function uploadAssetBytes(uploadUrl, token, mediaUrl) {
  const fileRes = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
  await axios.put(uploadUrl, fileRes.data, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': fileRes.headers['content-type'] || 'application/octet-stream',
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
}

async function publishPost(userId, { caption, mediaUrl }) {
  if (!caption && !mediaUrl) throw new Error('LinkedIn requires text content or media — set a caption or mediaUrl on the post.');
  const conn = await getConnection(userId, 'linkedin');
  const personUrn = `urn:li:person:${conn.account_id}`;

  const shareContent = {
    shareCommentary: { text: caption || '' },
    shareMediaCategory: 'NONE',
  };

  if (mediaUrl) {
    const isVideo = VIDEO_EXTENSIONS.test(mediaUrl);
    const recipe = isVideo ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image';
    const { uploadUrl, asset } = await registerUpload(personUrn, conn.access_token, recipe);
    await uploadAssetBytes(uploadUrl, conn.access_token, mediaUrl);
    shareContent.shareMediaCategory = isVideo ? 'VIDEO' : 'IMAGE';
    shareContent.media = [{ status: 'READY', media: asset }];
  }

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
        'com.linkedin.ugc.ShareContent': shareContent,
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
