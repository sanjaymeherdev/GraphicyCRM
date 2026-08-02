// shared/googleConnectRoutes.js — ONE "Connect Google" flow for gmail,
// sheets, and docs. Mount once at /api/google; all three modules then use
// shared/googleAuth.js's getValidGoogleAccessToken with no connect flow of
// their own.
const express = require('express');
const { requireAuth } = require('./auth');
const { buildGoogleAuthUrl, handleGoogleOAuthCallback, googleRedirectUri, disconnectGoogle } = require('./googleAuth');

const router = express.Router();

// Printed once at boot so it's easy to diff against Google Cloud Console →
// Credentials → your OAuth client → Authorized redirect URIs. Gmail,
// Sheets, Docs, and Drive all share this ONE URI — there should be exactly
// one Google redirect URI registered, not one per module.
console.log(`[google-auth] OAuth redirect_uri (register this exact URL in Google Cloud Console): ${googleRedirectUri()}`);

router.get('/connect', requireAuth, (req, res) => {
  res.json({ url: buildGoogleAuthUrl(req.user.id, req.query.return_to) });
});

router.delete('/connect', requireAuth, async (req, res) => {
  try { await disconnectGoogle(req.user.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/connect/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Google connect failed: ${error}`);
  try {
    const { returnTo } = await handleGoogleOAuthCallback(code, state);
    res.redirect(returnTo || '/');
  } catch (err) {
    // redirect_uri_mismatch is by far the most common failure at this exact
    // step — surface the URL we used so it can be compared directly against
    // Google Cloud Console instead of guessing.
    const hint = /redirect_uri_mismatch/i.test(err.message)
      ? `<p>The redirect URI this app sent was:<br><code>${googleRedirectUri()}</code></p>
         <p>Add this <strong>exact</strong> URL under Google Cloud Console → APIs &amp; Services →
         Credentials → your OAuth client → Authorized redirect URIs, then try again.
         Gmail, Sheets, Docs and Drive all share this one URI — no separate callback is needed per module.</p>`
      : '';
    res.status(500).send(`<h3>Google connect failed</h3><p>${err.message}</p>${hint}`);
  }
});

module.exports = router;
