// shared/googleDrive.js — raw Google Drive API calls, used by
// shared/ownerDriveToken.js + modules/media/routes.js to back scheduled-post
// media storage. Ported from sanjayaidev/MetaWhatsappAPI's sm/lib/googleDrive.js.
//
// Every call here operates on ONE pre-connected "owner" Google account (see
// shared/ownerDriveToken.js) — not something individual CRM users OAuth
// into. That account's Drive access token is passed in by the caller.
const axios = require('axios');

const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const API_URL = 'https://www.googleapis.com/drive/v3/files';

// Google access tokens expire in ~1hr, so every Drive call must first mint
// a fresh one from the owner account's refresh token.
async function getFreshAccessToken(refreshToken) {
  const res = await axios.post(
    'https://oauth2.googleapis.com/token',
    new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
  );
  return res.data.access_token;
}

// Files land in a "GraphicyCRM Scheduled Media" folder (created lazily)
// rather than scattered loose in the owner's Drive root. Nothing here makes
// the file public — access is only via this app's own signed streaming
// proxy (see modules/media/routes.js).
async function ensureUploadsFolder(token) {
  const q = encodeURIComponent("name='GraphicyCRM Scheduled Media' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const search = await axios.get(`${API_URL}?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (search.data.files && search.data.files.length > 0) {
    return search.data.files[0].id;
  }
  const create = await axios.post(
    API_URL,
    { name: 'GraphicyCRM Scheduled Media', mimeType: 'application/vnd.google-apps.folder' },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return create.data.id;
}

// Uploads a buffer to the shared owner Drive via a multipart/related request
// (metadata + raw bytes in one request — Drive's "simple multipart" upload).
async function uploadFile(token, { buffer, filename, mimeType }) {
  const folderId = await ensureUploadsFolder(token);
  const boundary = 'graphicycrm-' + Date.now();
  const metadata = { name: filename, mimeType, parents: [folderId] };

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await axios.post(
    `${UPLOAD_URL}?uploadType=multipart&fields=id,name,mimeType,size`,
    body,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );
  return res.data; // { id, name, mimeType, size }
}

// Streams file bytes straight from the owner's Drive — used by the public
// proxy route so Meta's/LinkedIn's servers can fetch the media as a normal
// URL without the file ever being made public/link-shared on Drive itself.
async function getFileStream(token, fileId) {
  const res = await axios.get(`${API_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'stream',
  });
  return res;
}

async function getFileMeta(token, fileId) {
  const res = await axios.get(`${API_URL}/${fileId}?fields=id,name,mimeType,size`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

// Deletes a file from the owner's Drive once it's no longer needed (e.g.
// after a post has published to every requested platform). Swallows 404 —
// already-gone is a success from the caller's point of view.
async function deleteFile(token, fileId) {
  try {
    await axios.delete(`${API_URL}/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (err.response?.status === 404) return;
    throw err;
  }
}

module.exports = { uploadFile, getFileStream, getFileMeta, getFreshAccessToken, deleteFile };
