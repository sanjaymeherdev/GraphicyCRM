// modules/threads/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const service = require('./service');

const router = express.Router();

router.get('/connect', requireAuth, (req, res) => {
  res.json({ url: service.getAuthUrl(req.user.id, req.query.return_to) });
});
router.get('/connect/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Threads connect failed: ${error}`);
  try {
    const { returnTo } = await service.handleOAuthCallback(code, state);
    res.redirect(returnTo || '/');
  } catch (err) { res.status(500).send(`Threads connect failed: ${err.message}`); }
});

router.use(requireAuth);

router.post('/posts', async (req, res) => {
  try { res.json({ success: true, id: await service.publishPost(req.user.id, req.body || {}) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/posts', async (req, res) => {
  try { res.json({ success: true, threads: await service.listRecentThreads(req.user.id, Number(req.query.limit) || 25) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/posts/:threadId/reply', async (req, res) => {
  try { res.json({ success: true, id: await service.replyToThread(req.user.id, req.params.threadId, req.body?.text) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/comments', async (req, res) => {
  try { res.json({ success: true, comments: await service.listRecentComments(req.user.id, Number(req.query.limit) || 10) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
