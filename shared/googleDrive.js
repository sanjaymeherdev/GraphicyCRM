// shared/googleDrive.js — lists a user's Google Drive files by type
// (id/name only, via the full drive scope — see shared/googleAuth.js's
// GOOGLE_SCOPES) so the frontend can offer a dropdown of a user's actual
// Sheets/Docs instead of asking them to paste a spreadsheet/doc ID by hand.
// Used by:
//   - modules/sheets/service.js's listSpreadsheets() — Sheet→Leads watcher
//     picker (public/js/modules/sources.js)
//   - modules/docs/service.js's listDocs() — AI bot "knowledge doc" picker
//     (public/js/modules/automation.js)
//   - modules/media/routes.js's upload/stream — scheduled-post media saved
//     to the user's own Drive (see uploadFile/getFileStream/getFileMeta
//     below). Unlike the reference implementation this is ported from
//     (sanjayaidev/MetaWhatsappAPI's sm/lib/googleDrive.js), this file
//     doesn't do its own refresh-token exchange — GraphicyCRM already has
//     one shared "google" token per user (see shared/googleAuth.js) with
//     the full drive scope on it, so getValidGoogleAccessToken() below
//     covers Sheets, Docs, AND Drive uploads with the same token; no
//     separate google_drive connection/consent screen is needed here.
const fetch = require('node-fetch');
const { getValidGoogleAccessToken } = require('./googleAuth');

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const UPLOADS_FOLDER_NAME = 'GraphicyCRM Uploads';

const MIME_TYPES = {
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  document: 'application/vnd.google-apps.document',
};

/** Lists the user's Google Sheets or Docs, most-recently-modified first. Returns [{ id, name, modifiedTime }]. */
async function listDriveFiles(userId, kind) {
  const mimeType = MIME_TYPES[kind];
  if (!mimeType) throw new Error(`Unknown Drive file kind "${kind}" (expected "spreadsheet" or "document")`);

  const accessToken = await getValidGoogleAccessToken(userId);
  const params = new URLSearchParams({
    q: `mimeType='${mimeType}' and trashed=false`,
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '100',
  });
  const res = await fetch(`${DRIVE_FILES_API}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    // Most common cause: the user connected Google before the full drive scope
    // was added to GOOGLE_SCOPES and hasn't reconnected since.
    if (res.status === 403) {
      throw new Error('Google Drive access not granted for this account — reconnect Google (Sources tab) to allow listing your Sheets/Docs.');
    }
    throw new Error(data.error?.message || `Drive API error ${res.status}`);
  }
  return data.files || [];
}

// Finds (or lazily creates) the "GraphicyCRM Uploads" folder in the user's
// My Drive root, so scheduled-post media lands somewhere findable instead
// of scattered loose at the root. Ported from sm/lib/googleDrive.js's
// ensureUploadsFolder(), just renamed for this app.
async function ensureUploadsFolder(accessToken) {
  const q = encodeURIComponent(`name='${UPLOADS_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await fetch(`${DRIVE_FILES_API}?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Drive API error ${res.status}`);
  if (data.files && data.files.length > 0) return data.files[0].id;

  const create = await fetch(DRIVE_FILES_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: UPLOADS_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const created = await create.json();
  if (!create.ok) throw new Error(created.error?.message || `Drive API error ${create.status}`);
  return created.id;
}

/**
 * Uploads a buffer to the user's own Drive (into the "GraphicyCRM Uploads"
 * folder) via Drive's "simple multipart" upload — metadata + raw bytes in
 * one request. The file is NOT made public; modules/media's stream route
 * proxies the bytes server-side instead (see that file for why). Returns
 * { id, name, mimeType, size }.
 */
async function uploadFile(userId, { buffer, filename, mimeType }) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const folderId = await ensureUploadsFolder(accessToken);
  const boundary = `graphicycrm-${Date.now()}`;
  const metadata = { name: filename, mimeType, parents: [folderId] };

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,mimeType,size`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Drive upload error ${res.status}`);
  return data;
}

/** Fetches a Drive file's metadata (id, name, mimeType, size). Used by the stream route to set response headers before piping bytes. */
async function getFileMeta(userId, fileId) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const res = await fetch(`${DRIVE_FILES_API}/${fileId}?fields=id,name,mimeType,size`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Drive API error ${res.status}`);
  return data;
}

/**
 * Returns the raw fetch Response for a Drive file's bytes (alt=media),
 * still to be streamed/piped by the caller. Used by modules/media's public
 * stream route so Meta's/LinkedIn's servers can fetch a scheduled post's
 * media as a normal URL, without the file ever being made public on Drive
 * itself — the CRM's server is always the one holding the Google token.
 */
async function getFileStream(userId, fileId) {
  const accessToken = await getValidGoogleAccessToken(userId);
  const res = await fetch(`${DRIVE_FILES_API}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    let message = `Drive API error ${res.status}`;
    try { message = (await res.json()).error?.message || message; } catch { /* body wasn't JSON */ }
    throw new Error(message);
  }
  return res;
}

module.exports = { listDriveFiles, uploadFile, getFileMeta, getFileStream };
