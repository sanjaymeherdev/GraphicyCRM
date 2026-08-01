// modules/leads/service.js — GET/POST/PUT/DELETE /api/leads,
// GET/POST /api/leads/:id/messages
const { supabase } = require('../../shared/db');

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

async function createLead(clientId, { name, phone, email, source, status, notes }) {
  const { data, error } = await supabase.from('crm_leads').insert({
    client_id: clientId, name: name || null, phone: normalizePhone(phone) || null, email: email || null,
    source: source || 'other', status: status || 'new', notes: notes || null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateLead(clientId, id, patch) {
  const allowed = ['name', 'phone', 'email', 'source', 'status', 'notes', 'needs_reply'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  if (clean.phone) clean.phone = normalizePhone(clean.phone);
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

module.exports = { listLeads, createLead, updateLead, deleteLead, getLeadMessages, recordMessage };
