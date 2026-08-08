// modules/docs/service.js — create, read, and edit Google Docs using the
// Google Docs REST API v1, via the same shared Google OAuth token as
// gmail/sheets (shared/googleAuth.js). The original repo only referenced
// Google Docs/Drive in passing (flow-builder file pickers); this is a
// clean implementation of the standard Docs API against that same token,
// covering the operations a CRM's document-generation flows need (contract/
// proposal docs, meeting notes, generated reports).
//
// ID-based linking only: the "documents" OAuth scope is enough to create,
// read, and edit a doc once you already have its documentId, but listing
// *which* docs the user has (for a "pick a doc" dropdown) or copying an
// existing doc both require the Drive API, which needs the `drive` scope.
// That scope isn't in this app's approved OAuth verification (see
// shared/googleAuth.js's GOOGLE_SCOPES), so those two operations are gone —
// callers now paste in a Google Doc's ID/URL directly instead of picking
// one from a list.
const fetch = require('node-fetch');
const { getValidGoogleAccessToken } = require('../../shared/googleAuth');

const DOCS_API = 'https://docs.googleapis.com/v1/documents';

async function apiFetch(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Docs API error ${res.status}`);
  return data;
}

/** Creates a new Google Doc, optionally seeded with initial text. Returns { documentId, url }. */
async function createDoc(userId, { title, initialText }) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const doc = await apiFetch(DOCS_API, accessToken, { method: 'POST', body: JSON.stringify({ title: title || 'Untitled document' }) });

  if (initialText) {
    await apiFetch(`${DOCS_API}/${doc.documentId}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: initialText } }] }),
    });
  }
  return { documentId: doc.documentId, url: `https://docs.google.com/document/d/${doc.documentId}/edit` };
}

/** Fetches the doc's full structure + a flattened plain-text version. */
async function getDoc(userId, documentId) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const doc = await apiFetch(`${DOCS_API}/${documentId}`, accessToken);
  const text = (doc.body?.content || [])
    .flatMap((el) => el.paragraph?.elements || [])
    .map((el) => el.textRun?.content || '')
    .join('');
  return { documentId, title: doc.title, text, raw: doc };
}

/** Appends text to the end of the document. */
async function appendText(userId, documentId, text) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const doc = await apiFetch(`${DOCS_API}/${documentId}`, accessToken);
  const endIndex = doc.body?.content?.slice(-1)[0]?.endIndex || 1;
  await apiFetch(`${DOCS_API}/${documentId}:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ insertText: { location: { index: Math.max(1, endIndex - 1) }, text } }] }),
  });
  return { success: true };
}

/** Find-and-replace across the whole document (e.g. filling {{merge_tags}} in a template doc). */
async function replaceText(userId, documentId, replacements) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const requests = Object.entries(replacements).map(([find, replaceText]) => ({
    replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: String(replaceText) },
  }));
  await apiFetch(`${DOCS_API}/${documentId}:batchUpdate`, accessToken, { method: 'POST', body: JSON.stringify({ requests }) });
  return { success: true };
}

// TODO(unapproved-scope): copyDoc() used to duplicate an existing doc (e.g.
// a saved template) via the Drive API's files.copy — that needs the `drive`
// (or at minimum `drive.file`) scope, which isn't approved. If we need
// "copy a template doc" again, either request drive.file verification, or
// reimplement as create-blank-doc + getDoc(source) + insert the same text/
// structure via the Docs API alone (documents scope only — no Drive call).
// Removed for now.

module.exports = { createDoc, getDoc, appendText, replaceText };
