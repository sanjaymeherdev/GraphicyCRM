// modules/mail-capture/routes.js — Sources tab's "Capture Mail" panel.
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const service = require('./service');
const { buildScript } = require('./appsScript');

const router = express.Router();
router.use(requireAuth);

// Returns a fresh secret + the ready-to-paste Apps Script source with that
// secret already embedded — the frontend shows this in a "Step 2: paste
// this code" code block. The secret isn't saved yet; it's only persisted
// once the user comes back with the deployed URL via POST / below.
router.get('/script', (req, res) => {
  const secret = service.generateSecret();
  res.json({ success: true, secret, script: buildScript(secret) });
});

router.get('/', async (req, res) => {
  try { res.json({ success: true, config: await service.getConfig(req.user.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { scriptUrl, secret, fromFilter, keywordFilter, pollIntervalMinutes, active } = req.body || {};
  try {
    const config = await service.saveConfig(req.user.id, {
      scriptUrl, secretToken: secret, fromFilter, keywordFilter, pollIntervalMinutes, active,
    });
    res.json({ success: true, config });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/', async (req, res) => {
  try { await service.deleteConfig(req.user.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual "check now" — triggers one poll immediately instead of waiting
// for the next interval tick, so the Sources UI can offer a "Test" button
// right after the user saves their deployment URL.
router.post('/poll-now', async (req, res) => {
  try {
    await service.pollForUser(req.user.id, service.captureMatch);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;