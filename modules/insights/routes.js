// modules/insights/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/account', async (req, res) => {
  try { res.json(await service.getAccountInsights(req.clientId, req.query.platform || 'instagram', { fresh: req.query.fresh === '1' })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/posts', async (req, res) => {
  try { res.json(await service.getPostInsights(req.clientId, req.query.platform || 'instagram')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/snapshots', async (req, res) => {
  try { res.json(await service.getSnapshots(req.clientId, req.query.platform)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
