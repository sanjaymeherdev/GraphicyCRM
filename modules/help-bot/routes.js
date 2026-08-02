// modules/help-bot/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const service = require('./service');

const router = express.Router();
router.use(requireAuth);

// POST /api/help-bot/chat  { history: [{role, content}, ...], model? }
router.post('/chat', async (req, res) => {
  const { history, model } = req.body || {};
  if (!Array.isArray(history) || !history.length) return res.status(400).json({ error: 'history array is required' });
  try {
    res.json(await service.chat(history, { model }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;