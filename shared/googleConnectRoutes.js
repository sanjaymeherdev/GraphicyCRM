// shared/googleConnectRoutes.js — ONE "Connect Google" flow for gmail,
// sheets, and docs. Mount once at /api/google; all three modules then use
// shared/googleAuth.js's getValidGoogleAccessToken with no connect flow of
// their own.
const express = require('express');
const { requireAuth } = require('./auth');
const { buildGoogleAuthUrl, handleGoogleOAuthCallback } = require('./googleAuth');

const router = express.Router();

router.get('/connect', requireAuth, (req, res) => {
  res.json({ url: buildGoogleAuthUrl(req.user.id, req.query.return_to) });
});

router.get('/connect/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Google connect failed: ${error}`);
  try {
    const { returnTo } = await handleGoogleOAuthCallback(code, state);
    res.redirect(returnTo || '/');
  } catch (err) {
    res.status(500).send(`Google connect failed: ${err.message}`);
  }
});

module.exports = router;
