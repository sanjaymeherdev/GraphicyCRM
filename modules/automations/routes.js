// modules/automations/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/', async (req, res) => {
  try { res.json({ automations: await service.listAutomations(req.clientId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json({ success: true, automation: await service.createAutomation(req.clientId, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try { res.json({ success: true, automation: await service.updateAutomation(req.clientId, req.params.id, req.body || {}) }); }
  catch (err) { res.status(err.message === 'Automation not found' ? 404 : 500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await service.deleteAutomation(req.clientId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
