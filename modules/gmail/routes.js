// modules/gmail/routes.js — Google connect flow lives at /api/google
// (shared/googleConnectRoutes.js); this module only needs the auth check.
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const service = require('./service');

const router = express.Router();
router.use(requireAuth);

router.post('/send', async (req, res) => {
  const { to, subject, text, html } = req.body || {};
  if (!to || !subject || (!text && !html)) return res.status(400).json({ error: 'to, subject, and text or html are required' });
  try { res.json({ success: true, messageId: await service.sendEmail(req.user.id, { to, subject, text, html }) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/messages', async (req, res) => {
  try { res.json({ success: true, messages: await service.listMessages(req.user.id, { query: req.query.q, maxResults: Number(req.query.max) || 20 }) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/messages/:id', async (req, res) => {
  try { res.json({ success: true, message: await service.getMessage(req.user.id, req.params.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/search', async (req, res) => {
  try { res.json({ success: true, messages: await service.searchMessages(req.user.id, { query: req.query.q, maxResults: Number(req.query.max) || 10 }) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
