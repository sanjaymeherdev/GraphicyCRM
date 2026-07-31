// modules/gmail/service.js — send, list, read, and search Gmail messages
// via the Gmail REST API, using the shared Google OAuth token (refreshed
// automatically by shared/googleAuth.js). Ported from the original repo's
// src/channel-send.js sendEmail() function, extended to cover full Gmail
// read/list/search functionality the CRM's automations rely on.
const fetch = require('node-fetch');
const { getValidGoogleAccessToken } = require('../../shared/googleAuth');

function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Sends a plain-text email. Returns the Gmail message id. */
async function sendEmail(userId, { to, subject, text, html }) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const contentType = html ? 'text/html' : 'text/plain';
  const body = html || text;
  const raw = base64url(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: ${contentType}; charset="UTF-8"\r\n\r\n${body}`);

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ raw }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(data.error?.message || `Gmail API ${res.status}`);
  return data.id;
}

/** Lists message ids/snippets matching an optional Gmail search query (e.g. "is:unread from:x@y.com"). */
async function listMessages(userId, { query = '', maxResults = 20 } = {}) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (query) params.set('q', query);

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gmail API ${res.status}`);
  return data.messages || [];
}

function decodeBody(payload) {
  if (!payload) return '';
  const findPart = (part) => {
    if (part.mimeType === 'text/plain' && part.body?.data) return part.body.data;
    if (part.parts) {
      for (const p of part.parts) {
        const found = findPart(p);
        if (found) return found;
      }
    }
    return null;
  };
  const data = payload.body?.data || findPart(payload);
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** Fetches a single message's headers + decoded plain-text body. */
async function getMessage(userId, messageId) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gmail API ${res.status}`);

  const headers = Object.fromEntries((data.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
  return {
    id: data.id, threadId: data.threadId, snippet: data.snippet,
    from: headers.from, to: headers.to, subject: headers.subject, date: headers.date,
    body: decodeBody(data.payload),
  };
}

/** Convenience: list + fetch full bodies in one call (bounded by maxResults — Gmail rate-limits per-message reads). */
async function searchMessages(userId, { query, maxResults = 10 } = {}) {
  const list = await listMessages(userId, { query, maxResults });
  return Promise.all(list.map((m) => getMessage(userId, m.id)));
}

module.exports = { sendEmail, listMessages, getMessage, searchMessages };
