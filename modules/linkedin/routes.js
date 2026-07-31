// modules/linkedin/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const service = require('./service');

const router = express.Router();

router.get('/connect', requireAuth, (req, res) => {
  try { res.json({ url: service.getAuthUrl(req.user.id, req.query.return_to) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.get('/connect/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`LinkedIn connect failed: ${error}`);
  try {
    const { returnTo } = await service.handleOAuthCallback(code, state);
    res.redirect(returnTo || '/');
  } catch (err) { res.status(500).send(`LinkedIn connect failed: ${err.message}`); }
});

router.use(requireAuth);

router.post('/posts', async (req, res) => {
  try { res.json({ success: true, id: await service.publishPost(req.user.id, req.body || {}) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
