// modules/help-bot/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const service = require('./service');

const router = express.Router();
router.use(requireAuth);

// GET /api/help-bot/modules — list of module names that can be tagged in a
// chat request, so the frontend can populate a picker.
router.get('/modules', (req, res) => {
  res.json({ modules: service.listModules() });
});

// POST /api/help-bot/chat  { history: [{role, content}, ...], model?, module? }
// `module` is an optional module folder name (see GET /modules). When set,
// that module's routes.js/service.js are sent to the AI as extra context so
// it can explain the code and, if relevant, suggest a fix as a diff.
router.post('/chat', async (req, res) => {
  const { history, model, module } = req.body || {};
  if (!Array.isArray(history) || !history.length) return res.status(400).json({ error: 'history array is required' });
  try {
    res.json(await service.chat(history, { model, module }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;