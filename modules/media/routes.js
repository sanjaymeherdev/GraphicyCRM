// modules/media/routes.js — used to implement "posts are saved to the
// user's own Drive for scheduling" (see modules/schedule). That relied on
// shared/googleDrive.js's uploadFile/getFileMeta/getFileStream, all of
// which need the `drive` scope — not in this app's approved OAuth scopes
// (see shared/googleAuth.js's GOOGLE_SCOPES), so shared/googleDrive.js has
// been removed and both routes below are disabled.
//
// TODO(unapproved-scope): modules/schedule's createPost/updatePost only
// need a plain `media_url` string (see modules/schedule/service.js) — they
// don't care where it's hosted. Until Drive storage comes back (would need
// drive.file scope + re-verification), scheduled posts with media should
// be created with a `media_url` pointing at media hosted elsewhere (e.g. a
// public URL, or another storage bucket) instead of using this upload
// endpoint. If Drive-backed uploads are needed again, request drive.file
// (not the full drive scope this used before) and restore
// shared/googleDrive.js + the two handlers below from git history.
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../../shared/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// ===========================================================
// PROTECTED — disabled, see TODO above.
// ===========================================================
const router = express.Router();
router.use(requireAuth);

router.post('/upload', upload.single('file'), async (_req, res) => {
  res.status(501).json({
    error: 'Media upload to Google Drive is temporarily unavailable (the `drive` OAuth scope isn\'t approved for this app). '
      + 'Host the file elsewhere and pass its public URL as media_url when creating/updating a scheduled post instead.',
  });
});

// ===========================================================
// PUBLIC — disabled, see TODO above.
// ===========================================================
const streamRouter = express.Router();

streamRouter.get('/stream/:userId/:fileId', async (_req, res) => {
  res.status(501).send('Media streaming from Google Drive is temporarily unavailable (the `drive` OAuth scope isn\'t approved for this app).');
});

module.exports = { router, streamRouter };
