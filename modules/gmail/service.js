// modules/gmail/service.js — sends Gmail messages via the Gmail REST API,
// using the shared Google OAuth token (refreshed automatically by
// shared/googleAuth.js). Ported from the original repo's
// src/channel-send.js sendEmail() function.
//
// Send-only: this app's approved OAuth scopes include gmail.send but NOT
// gmail.readonly, so listMessages()/getMessage()/searchMessages() (inbox
// read/list/search) have been removed — see the TODO below.
//
// TODO(lead-capture-from-mail, unapproved-scope): the CRM previously had
// room to grow a "new lead when an email comes in" feature (list/search the
// inbox, parse a matching message into a lead) using the functions removed
// from this file. That needs the gmail.readonly (or gmail.modify) scope,
// which isn't approved for this OAuth client. Leaving this as a TODO —
// re-add listMessages/getMessage/searchMessages here (see git history) once
// that scope is requested and approved, then wire it into
// modules/leads/service.js the same way modules/sheets' sendForMatch()
// creates leads from matched sheet rows.
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

module.exports = { sendEmail };
