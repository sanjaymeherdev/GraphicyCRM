// modules/integrations/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');

const router = express.Router();

router.get('/', requireAuth, requireClient, async (req, res) => {
  try { res.json({ integrations: await service.listIntegrations(req.clientId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/connect', requireAuth, requireClient, async (req, res) => {
  try { res.json({ success: true, integration: await service.connectIntegration(req.clientId, req.params.id, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/disconnect', requireAuth, requireClient, async (req, res) => {
  try { res.json(await service.disconnectIntegration(req.clientId, req.params.id)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// Pulls recent Calendly bookings and matches them to existing leads by
// email/phone. Polling (not a webhook) -- same reasoning as modules/insights:
// simpler than standing up a signed-webhook receiver for a "check every so
// often" use case. Call on-demand from the Sources tab, or wire to the same
// timer server.js already runs for insights.
router.post('/calendly/sync', requireAuth, requireClient, async (req, res) => {
  try { res.json({ success: true, ...(await service.pollCalendlyBookings(req.clientId, req.body?.since_days)) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// Sends a real email through the client's connected Resend account --
// useful as a "send test email" button, and callable from automations.
router.post('/resend/send', requireAuth, requireClient, async (req, res) => {
  try { res.json({ success: true, message_id: await service.sendResendEmail(req.clientId, req.body || {}) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// Public -- ManyChat calls this directly when a subscriber triggers a flow.
// Client is resolved from the per-connection webhook token generated at
// connect time (service.connectManychat), not from a logged-in session.
router.post('/manychat/webhook/:token', express.json(), async (req, res) => {
  try { res.json({ success: true, ...(await service.handleManychatWebhook(req.params.token, req.body || {})) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
