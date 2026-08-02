// modules/facebook/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { logWebhookDelivery } = require('../../shared/webhookLog');
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
    const result = await service.handleOAuthCallback(code, state);
    if (result.needsPageSelection) {
      const options = result.pages.map((p) => `<button onclick="choose('${p.id}')" style="display:block;width:100%;margin:6px 0;padding:10px;font-size:15px;">${p.name}${p.hasInstagram ? ' (+ Instagram)' : ''}</button>`).join('');
      return res.send(`<!doctype html><html><body style="font-family:sans-serif;max-width:420px;margin:40px auto;">
        <h3>Which Page should this connect?</h3>
        <div>${options}</div>
        <script>
          function choose(pageId) {
            fetch('/api/facebook/connect/select-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
              body: JSON.stringify({ selectionToken: ${JSON.stringify(result.selectionToken)}, pageId }) })
              .then(r => r.json()).then(d => { window.location = d.returnTo || '/'; });
          }
        </script>
      </body></html>`);
    }
    res.redirect(result.returnTo || '/');
  } catch (err) {
    res.status(500).send(`Facebook connect failed: ${err.message}`);
  }
});

router.post('/connect/select-page', express.json(), async (req, res) => {
  const { selectionToken, pageId } = req.body || {};
  if (!selectionToken || !pageId) return res.status(400).json({ error: 'selectionToken and pageId required' });
  try {
    const { returnTo } = await service.selectPage(selectionToken, pageId);
    res.json({ success: true, returnTo: returnTo || '/' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Webhook (Page comments/messages — public, Meta calls this) ---
router.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.FB_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});
router.post('/webhook', express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }), (req, res) => {
  const valid = service.verifySignature(req.rawBody, req.headers['x-hub-signature-256']);
  logWebhookDelivery({
    channel: 'facebook', accountId: req.body?.entry?.[0]?.id || null, objectType: req.body?.object || null,
    fields: [...new Set((req.body?.entry || []).flatMap((e) => (e.changes || []).map((c) => c.field)))],
    signatureValid: valid, rejectReason: valid ? null : 'bad signature', payload: req.body,
  });
  if (!valid) return res.sendStatus(403);
  res.sendStatus(200); // ack immediately, Meta retries on non-2xx

  const payload = req.body || {};
  if (payload.object === 'user') {
    // Subscribed to the wrong webhook object — "user" only reports personal-
    // profile changes and never delivers Page comments. Needs "page" + "feed".
    return console.warn('[facebook webhook] received a USER-object webhook — subscribe to the "page" object with the "feed" field instead.');
  }
  for (const entry of payload.entry || []) {
    const pageId = entry.id;
    for (const change of entry.changes || []) {
      if (change.field !== 'feed') continue;
      const value = change.value || {};
      if (value.item !== 'comment' || value.verb !== 'add') continue;
      service.handleCommentEvent({
        pageId, commentId: value.comment_id, text: value.message,
        senderId: value.from?.id || null, senderName: value.from?.name || null,
      }).catch((err) => console.error('[facebook webhook] failed to record comment:', err.message));
    }
    for (const messaging of entry.messaging || []) {
      if (!messaging.message || messaging.message.is_echo) continue;
      service.handleDmEvent({
        pageId, mid: messaging.message.mid, text: messaging.message.text, senderId: messaging.sender?.id || null,
      }).catch((err) => console.error('[facebook webhook] failed to record DM:', err.message));
    }
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
