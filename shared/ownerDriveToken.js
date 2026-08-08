// shared/ownerDriveToken.js — DB-backed credential for the single shared
// "owner" Google Drive account that backs media storage for every client's
// scheduled posts (see modules/media/routes.js). Ported from
// sanjayaidev/MetaWhatsappAPI's sm/lib/ownerDriveToken.js.
//
// One row in crm_shared_tokens (migrations/010_shared_drive_token.sql),
// set/rotated manually from /admin/drive (see modules/admin-drive/routes.js)
// — no auto-cron, whoever holds ADMIN_SECRET pastes in (or OAuths) a fresh
// refresh token there whenever needed.
const { supabase } = require('./db');
const { encryptToken, decryptToken } = require('./crypto');
const drive = require('./googleDrive');

const SERVICE = 'google_drive_owner';
// Refresh a bit before actual expiry to avoid a race against in-flight requests.
const EXPIRY_SAFETY_MARGIN_MS = 2 * 60 * 1000;

async function getRow() {
  const { data, error } = await supabase
    .from('crm_shared_tokens')
    .select('*')
    .eq('service', SERVICE)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Called from the admin page after pasting in a refresh token, or after the
// admin OAuth callback completes. Validates it against Google before saving
// so a typo/expired token never silently gets stored as "connected".
async function setRefreshToken(refreshToken) {
  const accessToken = await drive.getFreshAccessToken(refreshToken);

  const patch = {
    service: SERVICE,
    refresh_token_enc: encryptToken(refreshToken),
    access_token_enc: encryptToken(accessToken),
    // Google access tokens are ~1hr; getFreshAccessToken's return shape
    // doesn't give us expires_in here, so re-check/refresh on next use
    // rather than trusting a stale expiry.
    expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('crm_shared_tokens')
    .upsert(patch, { onConflict: 'service' });
  if (error) throw new Error(error.message);

  return { connected: true, updatedAt: patch.updated_at };
}

// Returns a valid, decrypted access token for the shared owner Drive,
// transparently refreshing it first if it's missing/expired/about to expire.
async function getValidAccessToken() {
  const row = await getRow();

  if (!row) {
    const e = new Error('Shared Google Drive is not connected yet — set it up at /admin/drive.');
    e.notConfigured = true;
    throw e;
  }

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const isExpiringSoon = !expiresAt || (expiresAt - Date.now()) < EXPIRY_SAFETY_MARGIN_MS;

  if (!isExpiringSoon && row.access_token_enc) {
    return decryptToken(row.access_token_enc);
  }

  const refreshToken = decryptToken(row.refresh_token_enc);
  let accessToken;
  try {
    accessToken = await drive.getFreshAccessToken(refreshToken);
  } catch (err) {
    const e = new Error('The shared Google Drive connection expired or was revoked — reconnect it at /admin/drive.');
    e.needsReconnect = true;
    throw e;
  }

  await supabase
    .from('crm_shared_tokens')
    .update({
      access_token_enc: encryptToken(accessToken),
      expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('service', SERVICE);

  return accessToken;
}

async function getStatus() {
  const row = await getRow();
  if (!row) return { connected: false };
  return {
    connected: true,
    updatedAt: row.updated_at,
    accessTokenExpiresAt: row.expires_at,
  };
}

module.exports = { getValidAccessToken, setRefreshToken, getStatus };
