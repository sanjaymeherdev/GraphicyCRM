// modules/docs/routes.js — Google connect flow lives at /api/google.
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const service = require('./service');

const router = express.Router();
router.use(requireAuth);

// Registered before '/:documentId' below — otherwise a request to
// GET /api/docs/list would match documentId="list" instead.
router.get('/list', async (req, res) => {
  try { res.json({ success: true, docs: await service.listDocs(req.user.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json({ success: true, doc: await service.createDoc(req.user.id, req.body || {}) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:documentId', async (req, res) => {
  try { res.json({ success: true, doc: await service.getDoc(req.user.id, req.params.documentId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:documentId/append', async (req, res) => {
  try { res.json(await service.appendText(req.user.id, req.params.documentId, req.body?.text || '')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:documentId/replace', async (req, res) => {
  const { replacements } = req.body || {};
  if (!replacements || typeof replacements !== 'object') return res.status(400).json({ error: 'replacements object required, e.g. {"{{name}}": "Alice"}' });
  try { res.json(await service.replaceText(req.user.id, req.params.documentId, replacements)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:documentId/copy', async (req, res) => {
  try { res.json({ success: true, doc: await service.copyDoc(req.user.id, req.params.documentId, req.body?.title || 'Untitled document') }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
