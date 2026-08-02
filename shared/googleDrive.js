// shared/googleDrive.js — lists a user's Google Drive files by type
// (id/name only, via drive.metadata.readonly — see shared/googleAuth.js's
// GOOGLE_SCOPES) so the frontend can offer a dropdown of a user's actual
// Sheets/Docs instead of asking them to paste a spreadsheet/doc ID by hand.
// Used by:
//   - modules/sheets/service.js's listSpreadsheets() — Sheet→Leads watcher
//     picker (public/js/modules/sources.js)
//   - modules/docs/service.js's listDocs() — AI bot "knowledge doc" picker
//     (public/js/modules/automation.js)
const fetch = require('node-fetch');
const { getValidGoogleAccessToken } = require('./googleAuth');

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';

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
    // Most common cause: the user connected Google before drive.metadata.readonly
    // was added to GOOGLE_SCOPES and hasn't reconnected since.
    if (res.status === 403) {
      throw new Error('Google Drive access not granted for this account — reconnect Google (Sources tab) to allow listing your Sheets/Docs.');
    }
    throw new Error(data.error?.message || `Drive API error ${res.status}`);
  }
  return data.files || [];
}

module.exports = { listDriveFiles };
