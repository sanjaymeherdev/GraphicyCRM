// modules/threads/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { logWebhookDelivery } = require('../../shared/webhookLog');
const { parseState, getConnection } = require('../../shared/metaConnections');
const service = require('./service');

const router = express.Router();

router.get('/connect', requireAuth, (req, res) => {
  try {
    res.json({ url: service.getAuthUrl(req.user.id, req.query.return_to) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/connect/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Threads connect failed: ${error}`);
  try {
    const { returnTo } = await service.handleOAuthCallback(code, state);
    res.redirect(returnTo || '/');
  } catch (err) {
    const metaBody = err.response?.data;
    console.error('[threads connect] token exchange failed:', metaBody || err.message);

    // Authorization codes are single-use. A duplicate/retried request with
    // the same code (browser back/forward cache, a proxy retry on the slow
    // multi-hop exchange below, a double-tap before navigation) hits this
    // exact Meta error even though the FIRST request already succeeded and
    // saved the connection. Don't show an error for that — check whether
    // we're actually connected now before deciding this failed.
    if (metaBody?.error?.error_subcode === 4279030 || /used_authorization_code/.test(metaBody?.error?.error_user_msg || '')) {
      try {
        const { userId, returnTo } = parseState(state);
        const conn = await getConnection(userId, 'threads').catch(() => null);
        if (conn) return res.redirect(returnTo || '/');
      } catch { /* fall through to error response below */ }
    }

    const message = metaBody ? JSON.stringify(metaBody) : err.message;
    res.status(500).send(`Threads connect failed: ${message}`);
  }
});

// --- Webhook (replies — public, Meta calls this; Threads has no DM API) ---
router.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.TH_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

router.post('/webhook', express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }), (req, res) => {
  const valid = service.verifySignature(req.rawBody, req.headers['x-hub-signature-256']);
  logWebhookDelivery({
    channel: 'threads', accountId: req.body?.entry?.[0]?.id || req.body?.target_id || null, objectType: req.body?.topic || req.body?.object || null,
    fields: req.body?.topic ? [req.body.topic] : [...new Set((req.body?.entry || []).flatMap((e) => (e.changes || []).map((c) => c.field)))],
    signatureValid: valid, rejectReason: valid ? null : 'bad signature', payload: req.body,
  });
  if (!valid) return res.sendStatus(403);
  res.sendStatus(200); // ack immediately, Meta retries on non-2xx

  const events = service.parseInboundEvents(req.body || {});
  for (const { text, replyId, accountId } of events) {
    service.handleReplyEvent({ accountId, replyId, text })
      .catch((err) => console.error('[threads webhook] failed to record reply:', err.message));
  }
});

router.use(requireAuth);

router.delete('/connect', async (req, res) => {
  try { await service.disconnect(req.user.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

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
