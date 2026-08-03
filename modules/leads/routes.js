// modules/leads/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const { supabase } = require('../../shared/db');
const service = require('./service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/', async (req, res) => {
  try { res.json({ leads: await service.listLeads(req.clientId, { status: req.query.status, source: req.query.source }) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json({ success: true, lead: await service.createLead(req.clientId, req.body || {}) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try { res.json({ success: true, lead: await service.updateLead(req.clientId, req.params.id, req.body || {}) }); }
  catch (err) { res.status(err.message === 'Lead not found' ? 404 : 500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await service.deleteLead(req.clientId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/messages', async (req, res) => {
  try { res.json({ messages: await service.getLeadMessages(req.clientId, req.params.id, req.query.channel) }); }
  catch (err) { res.status(err.message === 'Lead not found' ? 404 : 500).json({ error: err.message }); }
});

// Sends a message out through the actual channel (WhatsApp/Gmail today —
// Facebook/Instagram/Threads DMs use their own service.sendDM the same way,
// add branches here as the frontend starts asking for those channels too),
// then records it against the lead's thread either way.
router.post('/:id/messages', async (req, res) => {
  const { channel, body, format, subject, replyType, replyToExternalId } = req.body || {};
  if (!channel || !body) return res.status(400).json({ error: 'channel and body required' });
  try {
    const { data: lead, error } = await supabase.from('crm_leads')
      .select('id, phone, email, instagram, facebook, external_id').eq('id', req.params.id).eq('client_id', req.clientId).single();
    if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

    const result = await service.sendOutboundMessage({
      clientId: req.clientId,
      userId: req.user.id,
      lead,
      channel,
      body,
      format,
      subject,
      replyType,
      replyToExternalId,
    });

    if (result.status === 'failed') return res.status(502).json({ error: result.error_reason, message: result.message });
    res.json({ success: true, message: result.message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
