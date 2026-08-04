// modules/api-keys/service.js — lets external scripts/tools call this
// CRM's API with a key instead of a user login, ported from src/api-keys.js.
// The full key is only ever shown once, at creation time — only its
// SHA-256 hash is stored, checked by shared/apiKeyAuth.js on every
// request. Losing the key means generating a new one, same as any other
// bearer-token API key scheme.
const crypto = require('crypto');
const { supabase } = require('../../shared/db');

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function listKeys(clientId) {
  // key_hash is intentionally excluded from the select — nothing past this
  // module should ever see it, even in a list-my-keys response.
  const { data, error } = await supabase.from('crm_api_keys')
    .select('id, name, key_prefix, last_used_at, revoked_at, created_at')
    .eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

/** Creates a key and returns the ONE-TIME full plaintext value alongside
 * the stored row — the caller must show `apiKey` to the user immediately
 * and never persist it client-side beyond that. */
async function createKey(clientId, userId, { name }) {
  if (!name) throw new Error('name is required');
  const apiKey = `gcrm_${crypto.randomBytes(24).toString('base64url')}`;
  const { data, error } = await supabase.from('crm_api_keys').insert({
    client_id: clientId, created_by: userId, name,
    key_prefix: apiKey.slice(0, 12), key_hash: hashKey(apiKey),
  }).select('id, name, key_prefix, created_at').single();
  if (error) throw new Error(error.message);
  return { ...data, apiKey };
}

async function revokeKey(clientId, id) {
  const { error } = await supabase.from('crm_api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

/** Looks up an active (non-revoked) key by its plaintext value — used by
 * shared/apiKeyAuth.js on every API-key-authenticated request. Also bumps
 * last_used_at (fire-and-forget; a failed update here shouldn't fail auth). */
async function resolveKey(plaintextKey) {
  const { data, error } = await supabase.from('crm_api_keys').select('id, client_id, created_by, revoked_at')
    .eq('key_hash', hashKey(plaintextKey)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.revoked_at) return null;
  supabase.from('crm_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {});
  return data;
}

module.exports = { listKeys, createKey, revokeKey, resolveKey };
