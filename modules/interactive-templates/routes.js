// modules/interactive-templates/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/', async (req, res) => {
  try { res.json({ templates: await service.listTemplates(req.clientId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json({ success: true, template: await service.createTemplate(req.clientId, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try { res.json({ success: true, template: await service.updateTemplate(req.clientId, req.params.id, req.body || {}) }); }
  catch (err) { res.status(err.message === 'Template not found' ? 404 : 400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await service.deleteTemplate(req.clientId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
