// modules/instagram/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { logWebhookDelivery } = require('../../shared/webhookLog');
const service = require('./service');

const router = express.Router();

router.get('/connect', requireAuth, (req, res) => {
  res.json({ url: service.getAuthUrl(req.user.id, req.query.return_to) });
});

router.get('/connect/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Instagram connect failed: ${error}`);
  try {
    const { returnTo } = await service.handleOAuthCallback(code, state);
    res.redirect(returnTo || '/');
  } catch (err) { res.status(500).send(`Instagram connect failed: ${err.message}`); }
});

router.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.IG_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});
router.post('/webhook', express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }), (req, res) => {
  const valid = service.verifySignature(req.rawBody, req.headers['x-hub-signature-256']);
  logWebhookDelivery({
    channel: 'instagram', accountId: req.body?.entry?.[0]?.id || null, objectType: req.body?.object || null,
    fields: [...new Set((req.body?.entry || []).flatMap((e) => (e.changes || []).map((c) => c.field)))],
    signatureValid: valid, rejectReason: valid ? null : 'bad signature', payload: req.body,
  });
  if (!valid) return res.sendStatus(403);
  res.sendStatus(200); // ack immediately, Meta retries on non-2xx

  for (const entry of req.body?.entry || []) {
    const accountId = entry.id;
    for (const change of entry.changes || []) {
      if (change.field !== 'comments') continue;
      const value = change.value || {};
      service.handleCommentEvent({
        accountId, commentId: value.id, text: value.text,
        senderId: value.from?.id || null, senderName: value.from?.username || value.from?.name || value.from?.id || null,
      }).catch((err) => console.error('[instagram webhook] failed to record comment:', err.message));
    }
    for (const messaging of entry.messaging || []) {
      if (!messaging.message || messaging.message.is_echo) continue;
      service.handleDmEvent({
        accountId, mid: messaging.message.mid, text: messaging.message.text, senderId: messaging.sender?.id || null, senderName: messaging.sender?.username || messaging.sender?.name || null,
      }).catch((err) => console.error('[instagram webhook] failed to record DM:', err.message));
    }
  }
});

router.use(requireAuth);

router.delete('/connect', async (req, res) => {
  try { await service.disconnect(req.user.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/media', async (req, res) => {
  try { res.json({ success: true, mediaId: await service.publishPost(req.user.id, req.body || {}) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/comments/:commentId/reply', async (req, res) => {
  try { res.json({ success: true, commentId: await service.replyToComment(req.user.id, req.params.commentId, req.body?.message) }); }
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
