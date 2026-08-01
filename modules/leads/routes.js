// modules/leads/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const { supabase } = require('../../shared/db');
const service = require('./service');
const whatsapp = require('../whatsapp/service');
const gmail = require('../gmail/service');

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
  const { channel, body } = req.body || {};
  if (!channel || !body) return res.status(400).json({ error: 'channel and body required' });
  try {
    const { data: lead, error } = await supabase.from('crm_leads')
      .select('phone, email').eq('id', req.params.id).eq('client_id', req.clientId).single();
    if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

    let external_id = null, status = 'sent', error_reason = null;
    try {
      if (channel === 'whatsapp') {
        if (!lead.phone) throw new Error('Lead has no phone number on file');
        const digits = lead.phone.replace(/\D/g, '');
        const result = await whatsapp.sendMessage(req.user.id, { to: digits, kind: 'text', cfg: { body }, skipCrmLog: true });
        external_id = result.messageId;
      } else if (channel === 'gmail') {
        if (!lead.email) throw new Error('Lead has no email on file');
        external_id = await gmail.sendEmail(req.user.id, { to: lead.email, subject: 'New message', text: body });
      }
      // Other channels (instagram/facebook/threads/webform): recorded only,
      // no outbound send wired up yet — extend here when the frontend needs it.
    } catch (sendErr) {
      status = 'failed'; error_reason = sendErr.message;
    }

    const message = await service.recordMessage(req.clientId, req.params.id, {
      channel, body, external_id, status, error_reason, sent_by: req.user.id,
    });
    if (status === 'failed') return res.status(502).json({ error: error_reason, message });
    res.json({ success: true, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
