// modules/ai-bot/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const service = require('./service');

const router = express.Router();
router.use(requireAuth);

router.get('/models', (req, res) => res.json({ success: true, ...service.getAvailableModels() }));

router.post('/chat', async (req, res) => {
  const { messages, model, temperature, max_tokens } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages array required' });
  try { res.json(await service.generateReply(messages, { model, temperature, max_tokens })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// Runs the rule-matching engine directly — useful for testing an automation
// before wiring it into a live channel's webhook handler.
router.post('/match', async (req, res) => {
  const { text, contactId, replyOptionId } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const match = await service.matchRule(req.user.id, { contactId, text, replyOptionId });
    res.json({ success: true, match });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/rules', async (req, res) => {
  try { res.json({ success: true, rules: await service.listRules(req.user.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/rules', async (req, res) => {
  try { res.json({ success: true, rule: await service.createRule(req.user.id, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.put('/rules/:id', async (req, res) => {
  try { res.json({ success: true, rule: await service.updateRule(req.user.id, req.params.id, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete('/rules/:id', async (req, res) => {
  try { await service.deleteRule(req.user.id, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
