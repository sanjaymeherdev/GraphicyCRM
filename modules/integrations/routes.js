// modules/integrations/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/', async (req, res) => {
  try { res.json({ integrations: await service.listIntegrations(req.clientId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/connect', async (req, res) => {
  try { res.json({ success: true, integration: await service.connectIntegration(req.clientId, req.params.id, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
