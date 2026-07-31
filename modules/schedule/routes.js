// modules/schedule/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/posts', async (req, res) => {
  try { res.json({ posts: await service.listPosts(req.clientId, { status: req.query.status }) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/posts', async (req, res) => {
  try { res.json({ success: true, post: await service.createPost(req.clientId, req.user.id, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/posts/:id', async (req, res) => {
  try { res.json({ success: true, post: await service.updatePost(req.clientId, req.params.id, req.body || {}) }); }
  catch (err) { res.status(err.message === 'Post not found' ? 404 : 500).json({ error: err.message }); }
});

router.delete('/posts/:id', async (req, res) => {
  try { await service.deletePost(req.clientId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/posts/:id/publish', async (req, res) => {
  try { res.json({ success: true, post: await service.publishPostById(req.clientId, req.user.id, req.params.id) }); }
  catch (err) { res.status(err.message === 'Post not found' ? 404 : 500).json({ error: err.message }); }
});

module.exports = router;
