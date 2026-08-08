// modules/media/routes.js — used by modules/schedule (see
// modules/schedule/service.js's createPost/updatePost `media_url` field) to
// host media for scheduled posts.
//
// This used to rely on per-user Drive access (the `drive` scope), which was
// removed from shared/googleAuth.js's approved scope list — re-adding it
// would require re-verifying the whole OAuth consent screen. Restored here
// using the "shared owner Drive" pattern ported from
// sanjayaidev/MetaWhatsappAPI's sm/routes/media.js: ONE pre-connected Google
// account (the operator's own Drive, connected via /admin/drive — see
// modules/admin-drive/routes.js), requesting only the narrow `drive.file`
// scope through its own separate, admin-only OAuth flow. Every CRM client's
// upload lands in that one shared Drive; nothing here is scoped per-user on
// the Drive side (ownership/isolation is enforced by the signed proxy URL
// below, not by which Drive account owns the file).
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../../shared/auth');
const { signMediaToken, verifyMediaToken } = require('../../shared/crypto');
const drive = require('../../shared/googleDrive');
const ownerDriveToken = require('../../shared/ownerDriveToken');

// 200MB cap — plenty for FB/IG images and short-form video, keeps memory use
// bounded since we buffer in memory before forwarding to Drive.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PROXY_URL_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year — long enough that a scheduled post never finds it expired

// ===========================================================
// PROTECTED — upload a file to the shared owner Drive. Mounted behind
// requireAuth in server.js.
// ===========================================================
const router = express.Router();
router.use(requireAuth);

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded — attach it under the "file" field' });

    const token = await ownerDriveToken.getValidAccessToken();

    const uploaded = await drive.uploadFile(token, {
      buffer: req.file.buffer,
      filename: req.file.originalname || `upload-${Date.now()}`,
      mimeType: req.file.mimetype || 'application/octet-stream',
    });

    const expiresAt = Date.now() + PROXY_URL_TTL_MS;
    const sig = signMediaToken(req.user.id, uploaded.id, expiresAt);
    const media_url = `${APP_BASE_URL}/api/media/stream/${req.user.id}/${uploaded.id}?exp=${expiresAt}&sig=${sig}`;

    res.json({
      google_drive_file_id: uploaded.id,
      filename: uploaded.name,
      media_url,
    });
  } catch (err) {
    if (err.notConfigured || err.needsReconnect) return res.status(503).json({ error: err.message });
    const message = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    res.status(500).json({ error: message });
  }
});

// ===========================================================
// PUBLIC — streams the file from the owner's Drive so Meta's/LinkedIn's
// servers can fetch it as a normal public image/video URL. Mounted WITHOUT
// requireAuth — signature + expiry (see shared/crypto.js) is what stops
// this being an open proxy to arbitrary files. userId in the path is still
// verified against the signature so one signed link can't be replayed to
// fetch a different user's fileId.
// ===========================================================
const streamRouter = express.Router();

streamRouter.get('/stream/:userId/:fileId', async (req, res) => {
  const { userId, fileId } = req.params;
  const { exp, sig } = req.query;

  if (!exp || !sig || !verifyMediaToken(userId, fileId, exp, sig)) {
    return res.status(403).send('Invalid or expired media link');
  }

  try {
    const token = await ownerDriveToken.getValidAccessToken();

    const meta = await drive.getFileMeta(token, fileId);
    const upstream = await drive.getFileStream(token, fileId);

    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    if (meta.size) res.setHeader('Content-Length', meta.size);
    upstream.data.pipe(res);
  } catch (err) {
    if (err.notConfigured || err.needsReconnect) return res.status(503).send(err.message);
    res.status(500).send('Failed to stream media');
  }
});

module.exports = { router, streamRouter };
