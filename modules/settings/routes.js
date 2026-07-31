// modules/settings/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/', async (req, res) => {
  try { res.json(await service.getSettings(req.clientId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json({ success: true, settings: await service.saveSettings(req.clientId, req.body || {}) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
