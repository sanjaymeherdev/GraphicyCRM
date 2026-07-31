// shared/googleAuth.js — keeps a user's Google OAuth access token valid, for
// EVERY Google module (gmail, sheets, docs). They all read/write the same
// `crm_oauth_tokens` row (service='google') so connecting Google once in the
// CRM lights up Gmail + Sheets + Docs together, instead of each module
// needing its own separate "Connect Google" flow.
//
// Access tokens expire in ~1hr; this refreshes on demand using the stored
// refresh_token and persists the result, so callers always get a working
// token without the user re-authenticating.
const fetch = require('node-fetch');
const { supabase } = require('./db');
const { encryptToken, decryptToken } = require('./crypto');

const EXPIRY_SAFETY_MARGIN_MS = 2 * 60 * 1000; // refresh a bit before actual expiry

async function refreshAccessToken(tokenRow) {
  if (!tokenRow.refresh_token_enc) {
    throw new Error('Google not connected (no refresh token on file) — reconnect Google from the CRM.');
  }
  const refreshToken = decryptToken(tokenRow.refresh_token_enc);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    if (tokenData.error === 'invalid_grant') {
      throw new Error('Google access was revoked — please reconnect Google from the CRM.');
    }
    throw new Error(tokenData.error_description || tokenData.error || 'Failed to refresh Google token');
  }

  const patch = {
    access_token_enc: encryptToken(tokenData.access_token),
    expires_at: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  if (tokenData.refresh_token) patch.refresh_token_enc = encryptToken(tokenData.refresh_token);

  await supabase.from('crm_oauth_tokens').update(patch).eq('id', tokenRow.id);
  return tokenData.access_token;
}

// Returns a valid, decrypted Google access token for this user, transparently
// refreshing it first if it's missing/expired/about to expire.
async function getValidGoogleAccessToken(userId) {
  const { data: tokenRow, error } = await supabase.from('crm_oauth_tokens')
    .select('*').eq('user_id', userId).eq('service', 'google').single();
  if (error || !tokenRow || !tokenRow.access_token_enc) {
    throw new Error('Google not connected — connect Gmail/Sheets/Docs from the CRM first.');
  }

  const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : 0;
  const isExpiringSoon = !expiresAt || (expiresAt - Date.now()) < EXPIRY_SAFETY_MARGIN_MS;

  if (!isExpiringSoon) return decryptToken(tokenRow.access_token_enc);
  return refreshAccessToken(tokenRow);
}

// Persists tokens from the initial OAuth consent screen redirect (see
// modules/gmail|sheets|docs routes.js `/connect/callback`). All three
// Google modules share one `service: 'google'` row per user — scopes
// requested determine what that token can actually do, so if a user only
// ever connects via the Sheets flow, Gmail calls will fail with a scope
// error until they also grant the gmail scope (re-running connect adds
// scopes incrementally since Google merges consent per client+user).
async function saveGoogleTokens(userId, { access_token, refresh_token, expires_in }) {
  const patch = {
    user_id: userId,
    service: 'google',
    access_token_enc: encryptToken(access_token),
    expires_at: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  if (refresh_token) patch.refresh_token_enc = encryptToken(refresh_token);

  const { data: existing } = await supabase.from('crm_oauth_tokens')
    .select('id').eq('user_id', userId).eq('service', 'google').maybeSingle();

  if (existing) {
    await supabase.from('crm_oauth_tokens').update(patch).eq('id', existing.id);
  } else {
    await supabase.from('crm_oauth_tokens').insert(patch);
  }
}

const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

// One shared Google OAuth app (Cloud Console project) covers gmail/sheets/docs
// scopes together — requesting all three up front means connecting once in
// the CRM lights up every Google module, no separate "connect" per module.
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

function buildGoogleAuthUrl(userId, returnTo) {
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error('Google OAuth is not configured (missing GOOGLE_CLIENT_ID).');
  const redirectUri = `${APP_BASE_URL}/api/google/connect/callback`;
  const state = Buffer.from(JSON.stringify({ userId, returnTo: returnTo || '/' })).toString('base64url');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline', // required to get a refresh_token
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function parseState(state) {
  try { return JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid OAuth state'); }
}

async function handleGoogleOAuthCallback(code, state) {
  const { userId, returnTo } = parseState(state);
  const redirectUri = `${APP_BASE_URL}/api/google/connect/callback`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokenData.error_description || tokenData.error || 'Google token exchange failed');

  await saveGoogleTokens(userId, tokenData);
  return { returnTo };
}

module.exports = {
  getValidGoogleAccessToken, saveGoogleTokens,
  buildGoogleAuthUrl, handleGoogleOAuthCallback,
};

