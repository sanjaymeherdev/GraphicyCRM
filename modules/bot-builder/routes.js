// modules/bot-builder/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/', async (req, res) => {
  try { res.json({ rules: await service.listRules(req.clientId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json({ success: true, rule: await service.createRule(req.clientId, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try { res.json({ success: true, rule: await service.updateRule(req.clientId, req.params.id, req.body || {}) }); }
  catch (err) { res.status(err.message === 'Rule not found' ? 404 : 500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await service.deleteRule(req.clientId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
