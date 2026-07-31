// modules/webhook/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();

router.post('/generate', requireAuth, requireClient, async (req, res) => {
  try {
    const row = await service.generateToken(req.clientId);
    const base = (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    res.json({ success: true, url: `${base}/api/webhook/in/${row.token}`, token: row.token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Public — whatever webform/Zapier/etc the person wired the generated URL into.
router.post('/in/:token', express.json(), async (req, res) => {
  try {
    const clientId = await service.getClientIdForToken(req.params.token);
    if (!clientId) return res.status(404).json({ error: 'Unknown webhook token' });
    const lead = await service.ingest(clientId, req.body || {});
    res.json({ success: true, lead_id: lead.id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
