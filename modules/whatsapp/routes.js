// modules/whatsapp/routes.js — thin Express layer over service.js.
// Mount with: app.use('/api/whatsapp', require('./modules/whatsapp/routes'))
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const service = require('./service');

const router = express.Router();

// --- Webhook (public — Meta calls these, not the logged-in user) ---
// GET is the one-time subscription challenge; POST receives live events.
router.get('/webhook', (req, res) => {
  const challenge = service.verifySubscription(req.query['hub.mode'], req.query['hub.verify_token'], req.query['hub.challenge']);
  if (challenge !== null) return res.status(200).send(challenge);
  res.sendStatus(403);
});

router.post('/webhook', express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }), (req, res) => {
  res.sendStatus(200); // ack immediately, Meta retries on non-2xx
  const valid = service.verifySignature(req.rawBody, req.headers['x-hub-signature-256']);
  if (!valid) return console.warn('[whatsapp webhook] rejected: bad signature');
  const events = service.parseInboundEvents(req.body);
  for (const event of events) {
    const handler = event.type === 'message' ? service.handleInboundEvent
      : event.type === 'status' ? service.handleStatusEvent
      : null;
    if (!handler) continue;
    handler(event).catch((err) => console.error(`[whatsapp webhook] failed to record ${event.type} event:`, err.message));
  }
});

// --- Everything below requires login ---
router.use(requireAuth);

router.get('/accounts', async (req, res) => {
  try {
    res.json({ success: true, accounts: await service.listAccounts(req.user.id) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/accounts/verify', async (req, res) => {
  const { waba_id, access_token } = req.body || {};
  if (!waba_id || !access_token) return res.status(400).json({ error: 'waba_id and access_token required' });
  try {
    res.json({ success: true, numbers: await service.verifyWaba(waba_id, access_token) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/accounts', async (req, res) => {
  const { waba_id, phone_number_id, access_token } = req.body || {};
  if (!waba_id || !phone_number_id || !access_token) return res.status(400).json({ error: 'waba_id, phone_number_id, access_token required' });
  try {
    res.json({ success: true, account: await service.connectAccount(req.user.id, { waba_id, phone_number_id, access_token }) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/accounts/:id', async (req, res) => {
  try {
    await service.disconnectAccount(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send a free-form text/button/list/cta_url message (must be within the 24h window)
router.post('/messages/send', async (req, res) => {
  const { to, kind, cfg, vars } = req.body || {};
  if (!to || !cfg) return res.status(400).json({ error: 'to and cfg required' });
  try {
    res.json({ success: true, ...(await service.sendMessage(req.user.id, { to, kind, cfg, vars })) });
  } catch (err) {
    const status = err instanceof service.WhatsAppValidationError ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Send an approved business-initiated template
router.post('/messages/send-template', async (req, res) => {
  const { to, name, language, components } = req.body || {};
  if (!to || !name) return res.status(400).json({ error: 'to and name required' });
  try {
    res.json({ success: true, ...(await service.sendTemplate(req.user.id, { to, name, language, components })) });
  } catch (err) {
    const status = err instanceof service.WhatsAppValidationError ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
