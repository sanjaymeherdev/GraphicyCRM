// modules/leads/service.js — GET/POST/PUT/DELETE /api/leads,
// GET/POST /api/leads/:id/messages
const { supabase } = require('../../shared/db');
const whatsapp = require('../whatsapp/service');
const gmail = require('../gmail/service');
const instagram = require('../instagram/service');
const facebook = require('../facebook/service');

function normalizePhone(phone) {
  return phone ? phone.replace(/\D/g, '') : phone;
}

async function listLeads(clientId, { status, source } = {}) {
  let q = supabase.from('crm_leads').select('*').eq('client_id', clientId).order('updated_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (source) q = q.eq('source', source);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

async function createLead(clientId, { name, phone, email, source, status, notes, whatsapp, instagram, facebook, account_name }) {
  const normalizedPhone = normalizePhone(phone || whatsapp) || null;
  const normalizedWhatsapp = normalizePhone(whatsapp) || null;
  const { data, error } = await supabase.from('crm_leads').insert({
    client_id: clientId,
    name: name || null,
    phone: normalizedPhone,
    whatsapp: normalizedWhatsapp,
    instagram: instagram || null,
    facebook: facebook || null,
    email: email || null,
    account_name: account_name || null,
    source: source || 'other',
    status: status || 'new',
    notes: notes || null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateLead(clientId, id, patch) {
  const allowed = ['name', 'phone', 'email', 'source', 'status', 'notes', 'needs_reply', 'whatsapp', 'instagram', 'facebook', 'account_name'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  if (clean.phone !== undefined) clean.phone = normalizePhone(clean.phone) || null;
  if (clean.whatsapp !== undefined) clean.whatsapp = normalizePhone(clean.whatsapp) || null;
  if (clean.phone === null && clean.whatsapp) clean.phone = clean.whatsapp;
  if (clean.name !== undefined && clean.name === '') clean.name = null;
  if (clean.account_name !== undefined && clean.account_name === '') clean.account_name = null;
  if (clean.email !== undefined && clean.email === '') clean.email = null;
  clean.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('crm_leads').update(clean)
    .eq('id', id).eq('client_id', clientId).select().single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Lead not found');
  return data;
}

async function deleteLead(clientId, id) {
  const { error } = await supabase.from('crm_leads').delete().eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

async function getLeadMessages(clientId, leadId, channel) {
  // Confirm the lead belongs to this client before returning its thread.
  const { data: lead, error: leadErr } = await supabase.from('crm_leads')
    .select('id').eq('id', leadId).eq('client_id', clientId).maybeSingle();
  if (leadErr) throw new Error(leadErr.message);
  if (!lead) throw new Error('Lead not found');

  let q = supabase.from('crm_messages').select('*').eq('lead_id', leadId).order('created_at', { ascending: true });
  if (channel) q = q.eq('channel', channel);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

/** Records an outbound message against a lead, and marks its thread read.
 * Actually dispatching through the right channel (WhatsApp/Gmail/etc) is
 * the caller's job — see modules/leads/routes.js — this just persists it. */
async function recordMessage(clientId, leadId, { channel, body, message_type, external_id, status, error_reason, sent_by }) {
  const { data: lead, error: leadErr } = await supabase.from('crm_leads')
    .select('id').eq('id', leadId).eq('client_id', clientId).maybeSingle();
  if (leadErr) throw new Error(leadErr.message);
  if (!lead) throw new Error('Lead not found');

  const { data, error } = await supabase.from('crm_messages').insert({
    client_id: clientId, lead_id: leadId, channel, direction: 'out',
    message_type: message_type || 'text', body: body || '',
    external_id: external_id || null, is_read: true,
    status: status || 'sent', error_reason: error_reason || null, sent_by: sent_by || null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function sendOutboundMessage({ clientId, userId, lead, channel, body, deps = {} }) {
  const whatsappSvc = deps.whatsapp || whatsapp;
  const gmailSvc = deps.gmail || gmail;
  const instagramSvc = deps.instagram || instagram;
  const facebookSvc = deps.facebook || facebook;
  const record = deps.recordMessage || recordMessage;

  let external_id = null;
  let status = 'sent';
  let error_reason = null;

  try {
    if (channel === 'whatsapp') {
      if (!lead.phone) throw new Error('Lead has no phone number on file');
      const digits = lead.phone.replace(/\D/g, '');
      const result = await whatsappSvc.sendMessage(userId, { to: digits, kind: 'text', cfg: { body }, skipCrmLog: true });
      external_id = result.messageId;
    } else if (channel === 'gmail') {
      if (!lead.email) throw new Error('Lead has no email on file');
      external_id = await gmailSvc.sendEmail(userId, { to: lead.email, subject: 'New message', text: body });
    } else if (channel === 'instagram') {
      const recipientId = lead.instagram || lead.external_id || null;
      if (!recipientId) throw new Error('Lead has no Instagram identifier on file');
      external_id = await instagramSvc.sendDM(userId, recipientId, body);
    } else if (channel === 'facebook') {
      const recipientId = lead.facebook || lead.external_id || null;
      if (!recipientId) throw new Error('Lead has no Facebook identifier on file');
      external_id = await facebookSvc.sendDM(userId, recipientId, body);
    } else {
      throw new Error(`Channel ${channel} not supported`);
    }
  } catch (sendErr) {
    status = 'failed';
    error_reason = sendErr.message;
  }

  const message = await record(clientId, lead.id, {
    channel,
    body,
    external_id,
    status,
    error_reason,
    sent_by: userId,
  });

  return { status, error_reason, external_id, message };
}

module.exports = { listLeads, createLead, updateLead, deleteLead, getLeadMessages, recordMessage, sendOutboundMessage };
