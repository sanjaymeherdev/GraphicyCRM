// modules/media/routes.js — implements the "posts are saved to the user's
// own Drive for scheduling" rule (see modules/schedule). Ported from the
// sm/routes/media.js pattern in sanjayaidev/MetaWhatsappAPI, adapted to
// GraphicyCRM's existing shared Google token (shared/googleAuth.js already
// covers the full drive scope — no separate google_drive connection here,
// unlike the reference repo which connects Sheets/Drive as two independent
// OAuth grants).
//
// Two routers, mounted differently in server.js:
//   - router()       — PROTECTED. POST /api/media/upload: takes a file,
//                       saves it to the user's own Drive, returns a
//                       { google_drive_file_id, media_url } pair that
//                       modules/schedule's createPost/updatePost already
//                       accept as-is.
//   - streamRouter()  — PUBLIC (no auth). GET /api/media/stream/:userId/:fileId:
//                       streams the file's bytes straight from Drive so
//                       Meta's/LinkedIn's servers can fetch it as a normal
//                       public media URL when a scheduled post publishes.
//                       Nothing here makes the Drive file itself public —
//                       a signed, expiring token (shared/crypto.js) is what
//                       gates this route instead.
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../../shared/auth');
const { signMediaToken, verifyMediaToken } = require('../../shared/crypto');
const drive = require('../../shared/googleDrive');

// 200MB cap — plenty for IG/FB images and short-form video, keeps memory
// use bounded since the buffer is held in memory before forwarding to Drive.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
// A scheduled post can sit in "scheduled" status for a long time before it
// publishes, so the proxy URL needs to outlive that — a year is long enough
// that no realistically-scheduled post will ever find it expired.
const PROXY_URL_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function buildMediaUrl(userId, fileId) {
  const expiresAt = Date.now() + PROXY_URL_TTL_MS;
  const sig = signMediaToken(userId, fileId, expiresAt);
  return `${APP_BASE_URL}/api/media/stream/${userId}/${fileId}?exp=${expiresAt}&sig=${sig}`;
}

// ===========================================================
// PROTECTED: upload a file to the user's own connected Drive.
// ===========================================================
const router = express.Router();
router.use(requireAuth);

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded — attach it under the "file" field' });
    const userId = req.user.id;

    const uploaded = await drive.uploadFile(userId, {
      buffer: req.file.buffer,
      filename: req.file.originalname || `upload-${Date.now()}`,
      mimeType: req.file.mimetype || 'application/octet-stream',
    });

    res.json({
      success: true,
      google_drive_file_id: uploaded.id,
      filename: uploaded.name,
      media_url: buildMediaUrl(userId, uploaded.id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================
// PUBLIC: streams the file from the owner's Drive so Meta/LinkedIn can
// fetch it as a normal public image/video URL. Mounted WITHOUT requireAuth
// — the signature + expiry check below is what stops this being an open
// proxy to arbitrary files.
// ===========================================================
const streamRouter = express.Router();

streamRouter.get('/stream/:userId/:fileId', async (req, res) => {
  const { userId, fileId } = req.params;
  const { exp, sig } = req.query;

  if (!exp || !sig || !verifyMediaToken(userId, fileId, exp, sig)) {
    return res.status(403).send('Invalid or expired media link');
  }

  try {
    const meta = await drive.getFileMeta(userId, fileId);
    const upstream = await drive.getFileStream(userId, fileId);

    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    if (meta.size) res.setHeader('Content-Length', meta.size);
    upstream.body.pipe(res);
  } catch (err) {
    res.status(500).send(`Failed to stream media: ${err.message}`);
  }
});

module.exports = { router, streamRouter };
