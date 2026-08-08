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

// GET /messages, /messages/:id, and /search were removed — they needed the
// gmail.readonly scope, which isn't approved. See the TODO in
// modules/gmail/service.js (lead-capture-from-mail).

module.exports = router;
