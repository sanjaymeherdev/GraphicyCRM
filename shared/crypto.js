// shared/crypto.js — AES-256-GCM encrypt/decrypt for OAuth tokens & secrets
// at rest (wb_oauth_tokens.access_token_enc / refresh_token_enc, wa_accounts
// .access_token, etc). Every module that stores a token uses this so keys
// live in exactly one place.
//
// Generate a key with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const keyBase64 = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyBase64) throw new Error('TOKEN_ENCRYPTION_KEY env var is not set');
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

function encryptToken(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(String(plaintext), 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([encrypted, authTag]);

  return `${iv.toString('base64')}:${combined.toString('base64')}`;
}

function decryptToken(stored) {
  const [ivB64, combinedB64] = String(stored).split(':');
  if (!ivB64 || !combinedB64) throw new Error('Malformed encrypted token');

  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const combined = Buffer.from(combinedB64, 'base64');

  const authTag = combined.subarray(-16);
  const encrypted = combined.subarray(0, -16);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

// ===========================================================
// Signed media-proxy tokens — lets modules/media's public stream route
// let Meta's/LinkedIn's servers fetch a user's privately-stored Drive file
// without that file ever being made public/link-shared on Drive itself.
// The signature binds userId+fileId+expiry together so a leaked URL can't
// be edited to point at a different file, and it expires instead of
// working forever. Ported from sanjayaidev/MetaWhatsappAPI's
// sm/lib/crypto.js signMediaToken/verifyMediaToken, but reuses this file's
// existing TOKEN_ENCRYPTION_KEY rather than introducing a second key.
// ===========================================================
function signMediaToken(userId, fileId, expiresAt) {
  const key = getKey();
  const payload = `${userId}:${fileId}:${expiresAt}`;
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}

function verifyMediaToken(userId, fileId, expiresAt, signature) {
  if (!signature || Date.now() > Number(expiresAt)) return false;
  const expected = signMediaToken(userId, fileId, expiresAt);
  const expectedBuf = Buffer.from(expected);
  const givenBuf = Buffer.from(String(signature));
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}

module.exports = { encryptToken, decryptToken, signMediaToken, verifyMediaToken };
