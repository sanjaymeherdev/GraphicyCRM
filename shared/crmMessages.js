// shared/crmMessages.js — the inbound-webhook-to-inbox pipeline every
// channel module (whatsapp, facebook, instagram, threads) shares: resolve
// which client owns an event, find-or-create the lead it's from, and record
// the message. modules/inbox only reads crm_messages, so any channel that
// skips this never shows up there.
const { supabase } = require('./db');

async function resolveClientId(userId) {
  const { data, error } = await supabase.from('crm_profiles').select('client_id').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.client_id) throw new Error(`No CRM client found for user ${userId}.`);
  return data.client_id;
}

/**
 * Finds or creates a lead for this client. Pass `phone` for WhatsApp
 * (dedup on phone) or `externalId` for platforms with no phone number —
 * Facebook PSID, Instagram IGSID, Threads user id (dedup on external_id).
 */
async function findOrCreateLead(clientId, source, { phone = null, externalId = null, name = null } = {}) {
  if (!phone && !externalId) throw new Error('findOrCreateLead requires phone or externalId');
  let query = supabase.from('crm_leads').select('id').eq('client_id', clientId).eq('source', source);
  query = phone ? query.eq('phone', phone) : query.eq('external_id', externalId);
  const { data: existing, error: findErr } = await query.maybeSingle();
  if (findErr) throw new Error(findErr.message);
  if (existing) return existing.id;

  const { data, error } = await supabase.from('crm_leads')
    .insert({ client_id: clientId, source, phone, external_id: externalId, name })
    .select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function recordMessage(clientId, leadId, { channel, direction, messageType = 'text', body, externalId, status, sentBy }) {
  const { error } = await supabase.from('crm_messages').insert({
    client_id: clientId, lead_id: leadId, channel, direction,
    message_type: messageType, body: body || '', external_id: externalId || null,
    is_read: direction === 'out', status: status || null, sent_by: sentBy || null,
  });
  if (error) throw new Error(error.message);
  await supabase.from('crm_leads').update({
    last_message: body || '', last_message_at: new Date().toISOString(),
    needs_reply: direction === 'in',
  }).eq('id', leadId);
}

module.exports = { resolveClientId, findOrCreateLead, recordMessage };
