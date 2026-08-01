// modules/templates/routes.js
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });
router.use(requireAuth, requireClient);

router.get('/', async (req, res) => {
  try { res.json({ templates: await service.listTemplates(req.clientId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json({ success: true, template: await service.createTemplate(req.clientId, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// Submits a template to Meta for review (distinct from the plaintext CRUD
// above — POST / above stores a local-only template with no Meta call).
router.post('/meta/submit', async (req, res) => {
  try { res.json({ success: true, template: await service.submitMetaTemplate(req.clientId, req.user.id, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/meta/media/upload', upload.single('file'), async (req, res) => {
  try { res.json({ success: true, ...(await service.uploadTemplateMedia(req.user.id, req.file)) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/meta/sync', async (req, res) => {
  try { res.json({ success: true, ...(await service.syncMetaTemplates(req.clientId, req.user.id)) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/meta/approved', async (req, res) => {
  try { res.json({ success: true, templates: await service.listMetaApproved(req.clientId, req.user.id) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try { res.json({ success: true, template: await service.updateTemplate(req.clientId, req.params.id, req.body || {}) }); }
  catch (err) { res.status(err.message === 'Template not found' ? 404 : 500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await service.deleteTemplate(req.clientId, req.user.id, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(err.message === 'Template not found' ? 404 : 500).json({ error: err.message }); }
});

module.exports = router;
