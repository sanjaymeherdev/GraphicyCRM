// modules/facebook/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const service = require('./service');

const router = express.Router();

// --- OAuth connect (needs the logged-in user to kick off, callback is public) ---
router.get('/connect', requireAuth, (req, res) => {
  res.json({ url: service.getAuthUrl(req.user.id, req.query.return_to) });
});

router.get('/connect/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Facebook connect failed: ${error}`);
  try {
    const { returnTo } = await service.handleOAuthCallback(code, state);
    res.redirect(returnTo || '/');
  } catch (err) {
    res.status(500).send(`Facebook connect failed: ${err.message}`);
  }
});

// --- Webhook (Page comments/messages — public, Meta calls this) ---
router.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.FB_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});
router.post('/webhook', express.json(), (req, res) => {
  res.sendStatus(200);
  for (const entry of req.body?.entry || []) {
    for (const event of entry.messaging || []) console.log('[facebook webhook] message event', event);
    for (const change of entry.changes || []) console.log('[facebook webhook] change event', change);
  }
});

// --- Authenticated actions ---
router.use(requireAuth);

router.post('/posts', async (req, res) => {
  try { res.json({ success: true, postId: await service.publishPost(req.user.id, req.body || {}) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/posts', async (req, res) => {
  try { res.json({ success: true, posts: await service.listRecentPosts(req.user.id, Number(req.query.limit) || 25) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/comments/:objectId/reply', async (req, res) => {
  try { res.json({ success: true, commentId: await service.replyToComment(req.user.id, req.params.objectId, req.body?.message) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/comments', async (req, res) => {
  try { res.json({ success: true, comments: await service.listRecentComments(req.user.id, Number(req.query.limit) || 10) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/conversations', async (req, res) => {
  try { res.json({ success: true, conversations: await service.listConversations(req.user.id, Number(req.query.limit) || 25) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/messages/send', async (req, res) => {
  const { recipientId, text, replyToMid } = req.body || {};
  if (!recipientId || !text) return res.status(400).json({ error: 'recipientId and text required' });
  try { res.json({ success: true, messageId: await service.sendDM(req.user.id, recipientId, text, replyToMid) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/comments/:commentId/private-reply', async (req, res) => {
  try { res.json({ success: true, messageId: await service.sendPrivateReply(req.user.id, req.params.commentId, req.body?.message) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
