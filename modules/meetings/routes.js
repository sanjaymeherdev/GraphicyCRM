// modules/meetings/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const webhookService = require('../webhook/service');
const service = require('./service');

const router = express.Router();

router.get('/', requireAuth, requireClient, async (req, res) => {
  try { res.json({ meetings: await service.listMeetings(req.clientId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Public — the booking provider (e.g. smbooking) posts here using the same
// per-client token URL modules/webhook issues for lead intake (see
// POST /api/webhook/generate). One token, one URL scheme, for every
// external system that needs to push data into a client's CRM.
router.post('/webhook/:token', express.json(), async (req, res) => {
  try {
    const clientId = await webhookService.getClientIdForToken(req.params.token);
    if (!clientId) return res.status(404).json({ error: 'Unknown webhook token' });
    const meeting = await service.handleBookingWebhook(clientId, req.body || {});
    res.json({ success: true, meeting_id: meeting.id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
