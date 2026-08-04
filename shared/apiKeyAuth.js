// shared/apiKeyAuth.js — alternative to shared/auth.js's requireAuth, for
// external scripts/tools calling the CRM API with a key from
// modules/api-keys instead of a user login. Ported from
// src/middleware/api-auth.js.
//
// Sets req.user AND req.clientId directly (a key's row already has
// client_id — no need to go through shared/clientContext.js's
// profile-lookup/auto-provision dance, which assumes a logged-in user).
//
// Usage — mount on routes that should accept EITHER a login OR an API key,
// falling back to the normal auth if no key header is present:
//   router.use(require('../../shared/apiKeyAuth').optional, requireAuth, requireClient)
// or, for routes that should ONLY accept API keys:
//   router.use(require('../../shared/apiKeyAuth').required)
const { resolveKey } = require('../modules/api-keys/service');

function extractKey(req) {
  return req.headers['x-api-key'] || (req.headers['authorization'] || '').replace(/^ApiKey\s+/i, '').trim() || null;
}

/** Requires a valid API key; 401s otherwise. */
async function required(req, res, next) {
  const key = extractKey(req);
  if (!key) return res.status(401).json({ error: 'Missing API key (X-API-Key header)' });
  try {
    const row = await resolveKey(key);
    if (!row) return res.status(401).json({ error: 'Invalid or revoked API key' });
    req.user = { id: row.created_by };
    req.clientId = row.client_id;
    req.apiKeyAuth = true;
    next();
  } catch (err) {
    res.status(500).json({ error: `API key verification failed: ${err.message}` });
  }
}

/** Populates req.user/req.clientId from an API key if one is present, but
 * doesn't reject the request if not — lets a route chain fall through to
 * requireAuth/requireClient for browser-session callers. */
async function optional(req, res, next) {
  const key = extractKey(req);
  if (!key) return next();
  try {
    const row = await resolveKey(key);
    if (row) { req.user = { id: row.created_by }; req.clientId = row.client_id; req.apiKeyAuth = true; }
  } catch (err) {
    console.error('[apiKeyAuth] optional key check failed:', err.message);
  }
  next();
}

module.exports = { required, optional };
