// shared/metaConnections.js — stores/retrieves the Page/IG/Threads access
// token each of the facebook/instagram/threads modules needs to call the
// Graph API on a user's behalf. One table (`crm_connections`), one shape,
// reused by all three modules — same pattern as shared/googleAuth.js for
// the Google modules.
const axios = require('axios');
const { supabase } = require('./db');
const { encryptToken, decryptToken } = require('./crypto');

const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v25.0';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

// Each platform's OAuth app config. Facebook and Instagram-via-Facebook-Login
// share one Meta app; Threads requires its own app registration.
const OAUTH_CONFIGS = {
  facebook: {
    authUrl: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`,
    scope: 'pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_comments,instagram_manage_messages,email',
    clientId: process.env.FB_APP_ID,
    clientSecret: process.env.FB_SECRET,
  },
  instagram: {
    authUrl: 'https://www.instagram.com/oauth/authorize',
    scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights',
    clientId: process.env.IG_APP_ID,
    clientSecret: process.env.IG_SECRET,
  },
  threads: {
    authUrl: 'https://threads.net/oauth/authorize',
    scope: 'threads_basic,threads_content_publish,threads_manage_insights,threads_manage_replies,threads_read_replies',
    clientId: process.env.TH_APP_ID,
    clientSecret: process.env.TH_SECRET,
  },
  // Sign In with LinkedIn (OpenID Connect) + Share on LinkedIn — personal
  // profile posting only, no Company Page / Community Management access.
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    scope: 'openid profile w_member_social',
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
  },
};

function buildAuthUrl(platform, userId, returnTo) {
  const config = OAUTH_CONFIGS[platform];
  if (!config?.clientId) throw new Error(`${platform} OAuth is not configured (missing client id env var).`);
  const redirectUri = `${APP_BASE_URL}/api/${platform}/connect/callback`;
  const state = Buffer.from(JSON.stringify({ userId, returnTo: returnTo || '/' })).toString('base64url');
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scope,
    response_type: 'code',
    state,
  });
  return `${config.authUrl}?${params.toString()}`;
}

function parseState(state) {
  try {
    return JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid OAuth state');
  }
}

async function upsertConnection(userId, { platform, account_name, account_id, page_id, access_token, token_expires_at }) {
  const patch = {
    user_id: userId,
    platform,
    account_name: account_name || null,
    account_id,
    page_id: page_id || null,
    access_token_enc: encryptToken(access_token),
    is_connected: true,
    token_expires_at: token_expires_at || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('crm_connections')
    .upsert(patch, { onConflict: 'user_id,platform,account_id' })
    .select('id, platform, account_name, account_id, page_id, is_connected, token_expires_at')
    .single();
  if (error) throw error;
  return data;
}

// Returns the decrypted access token + account_id/page_id for a user's
// active connection on a platform. Every module route calls this before
// making a Graph API call.
async function getConnection(userId, platform) {
  const { data, error } = await supabase.from('crm_connections')
    .select('*').eq('user_id', userId).eq('platform', platform).eq('is_connected', true)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`${platform} is not connected — connect it first.`);
  return { ...data, access_token: decryptToken(data.access_token_enc) };
}

// Reverse lookup for webhook handlers: Meta calls these unauthenticated, so
// the only way to know which of our users' connections a comment/DM belongs
// to is the Page/account id the event arrived on. Checks account_id first,
// then page_id (Instagram events sometimes carry the linked Page's id).
async function resolveByAccountId(platform, accountId) {
  if (!accountId) return null;
  const { data, error } = await supabase.from('crm_connections')
    .select('*').eq('platform', platform).eq('is_connected', true)
    .or(`account_id.eq.${accountId},page_id.eq.${accountId}`)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, access_token: decryptToken(data.access_token_enc) };
}

// --- Platform-specific token exchange (authorization code -> long-lived token) ---

async function exchangeFacebookCode(code, redirectUri) {
  const config = OAUTH_CONFIGS.facebook;
  const shortRes = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`, {
    params: { client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, code },
  });
  const longRes = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`, {
    params: { grant_type: 'fb_exchange_token', client_id: config.clientId, client_secret: config.clientSecret, fb_exchange_token: shortRes.data.access_token },
  });
  const userToken = longRes.data.access_token;
  const expiresAt = longRes.data.expires_in ? new Date(Date.now() + longRes.data.expires_in * 1000) : null;

  // pages_show_list — every Page this user manages. Caller decides: connect
  // directly if there's exactly one, or run a picker if there's more than
  // one — silently picking pages[0] risks linking the wrong Page (and, for
  // Instagram-via-Facebook, the wrong linked IG account) for anyone who
  // manages multiple Pages.
  const pagesRes = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`, {
    params: { fields: 'id,name,instagram_business_account,access_token', access_token: userToken },
  });
  const pages = pagesRes.data.data || [];
  if (!pages.length) throw new Error('No Facebook Pages found for this account — is it a Page admin?');
  return { pages, expiresAt };
}

// A short-lived, tamper-proof (AES-GCM) token carrying the Page list from an
// in-progress Facebook OAuth callback, so the picker round-trip (show pages
// -> user picks one -> finish connecting) doesn't need server-side session
// state. Reuses the same encrypt/decrypt used for stored tokens — it's
// already authenticated encryption, no separate JWT dependency needed.
const SELECTION_TOKEN_TTL_MS = 10 * 60 * 1000;

function signSelectionToken(payload) {
  return encryptToken(JSON.stringify({ ...payload, exp: Date.now() + SELECTION_TOKEN_TTL_MS }));
}

function parseSelectionToken(token) {
  let payload;
  try { payload = JSON.parse(decryptToken(token)); }
  catch { throw new Error('Invalid or corrupted selection token.'); }
  if (!payload.exp || Date.now() > payload.exp) throw new Error('Page selection expired — please reconnect.');
  return payload;
}

async function exchangeInstagramCode(code, redirectUri) {
  const config = OAUTH_CONFIGS.instagram;
  const tokenRes = await axios.post('https://api.instagram.com/oauth/access_token', new URLSearchParams({
    client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code,
  }));
  const longRes = await axios.get('https://graph.instagram.com/access_token', {
    params: { grant_type: 'ig_exchange_token', client_secret: config.clientSecret, access_token: tokenRes.data.access_token },
  });
  const longToken = longRes.data.access_token;
  const expiresAt = longRes.data.expires_in ? new Date(Date.now() + longRes.data.expires_in * 1000) : null;
  const meRes = await axios.get(`https://graph.instagram.com/${GRAPH_VERSION}/me`, {
    params: { fields: 'id,username', access_token: longToken },
  });
  return { accountId: meRes.data.id, accountName: `@${meRes.data.username}`, accessToken: longToken, expiresAt };
}

async function exchangeThreadsCode(code, redirectUri) {
  const config = OAUTH_CONFIGS.threads;
  const tokenRes = await axios.post('https://graph.threads.net/oauth/access_token', new URLSearchParams({
    client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code,
  }));
  const longRes = await axios.get('https://graph.threads.net/access_token', {
    params: { grant_type: 'th_exchange_token', client_secret: config.clientSecret, access_token: tokenRes.data.access_token },
  });
  const longToken = longRes.data.access_token;
  const expiresAt = longRes.data.expires_in ? new Date(Date.now() + longRes.data.expires_in * 1000) : null;
  const meRes = await axios.get(`https://graph.threads.net/v1.0/me`, {
    params: { fields: 'id,username', access_token: longToken },
  });
  return { accountId: meRes.data.id, accountName: `@${meRes.data.username}`, accessToken: longToken, expiresAt };
}

// LinkedIn's OAuth code exchange is a single hop (no short->long token
// exchange like the Meta platforms above) — the access_token it returns is
// already valid for up to 60 days. userinfo (OIDC) gives us `sub`, the
// LinkedIn member id, which modules/linkedin/service.js turns into the
// author URN (urn:li:person:<sub>) required by the Share API.
async function exchangeLinkedInCode(code, redirectUri) {
  const config = OAUTH_CONFIGS.linkedin;
  const tokenRes = await axios.post(
    'https://www.linkedin.com/oauth/v2/accessToken',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const accessToken = tokenRes.data.access_token;
  const expiresAt = tokenRes.data.expires_in ? new Date(Date.now() + tokenRes.data.expires_in * 1000) : null;

  const userinfoRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return {
    accountId: userinfoRes.data.sub,
    accountName: userinfoRes.data.name || userinfoRes.data.email || null,
    accessToken,
    expiresAt,
  };
}

// Disconnects every active connection a user has on a platform (there's
// normally exactly one, but nothing stops someone from having reconnected
// a different Page/account over time, leaving more than one active row).
async function disconnectConnection(userId, platform) {
  const { error } = await supabase.from('crm_connections')
    .update({ is_connected: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('platform', platform).eq('is_connected', true);
  if (error) throw error;
}

module.exports = {
  APP_BASE_URL,
  buildAuthUrl,
  parseState,
  upsertConnection,
  getConnection,
  disconnectConnection,
  resolveByAccountId,
  exchangeFacebookCode,
  exchangeInstagramCode,
  exchangeThreadsCode,
  exchangeLinkedInCode,
  signSelectionToken,
  parseSelectionToken,
};
