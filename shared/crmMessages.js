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

function normalizePhone(phone) {
  return phone ? phone.replace(/\D/g, '') : phone;
}

/**
 * Finds or creates a lead for this client. Pass `phone` for WhatsApp (dedup
 * on phone) — normalized to digits-only, since Meta's webhook events and a
 * manually-entered "+1 555-123-4567" lead need to match the same row —
 * `externalId` for platforms with no phone number — Facebook PSID,
 * Instagram IGSID, Threads user id (dedup on external_id) — or `email` for
 * sources with only an email column, like a sheet watcher with no
 * phone_column configured (dedup on email). Checked in that order.
 */
async function findOrCreateLead(clientId, source, { phone = null, externalId = null, email = null, name = null, accountName = null, whatsapp = null, instagram = null, facebook = null } = {}) {
  const normalizedPhone = normalizePhone(phone || whatsapp);
  if (!normalizedPhone && !externalId && !email) throw new Error('findOrCreateLead requires phone, externalId, or email');

  let query = supabase.from('crm_leads').select('id, name, account_name, phone, whatsapp, instagram, facebook, email').eq('client_id', clientId).eq('source', source);
  query = normalizedPhone ? query.eq('phone', normalizedPhone) : externalId ? query.eq('external_id', externalId) : query.eq('email', email);
  const { data: existing, error: findErr } = await query.maybeSingle();
  if (findErr) throw new Error(findErr.message);
  if (existing) {
    const updates = {};
    if (normalizedPhone && !existing.phone) updates.phone = normalizedPhone;
    if (whatsapp && !existing.whatsapp) updates.whatsapp = normalizePhone(whatsapp);
    if (instagram && !existing.instagram) updates.instagram = instagram;
    if (facebook && !existing.facebook) updates.facebook = facebook;
    if (email && !existing.email) updates.email = email;
    if ((name || accountName) && !existing.name && !existing.account_name) {
      updates.name = name || accountName || null;
      updates.account_name = accountName || name || null;
    } else if (accountName && !existing.account_name) {
      updates.account_name = accountName;
    }
    if (Object.keys(updates).length) {
      const { error: updateErr } = await supabase.from('crm_leads').update(updates).eq('id', existing.id);
      if (updateErr) throw new Error(updateErr.message);
    }
    return existing.id;
  }

  const { data, error } = await supabase.from('crm_leads')
    .insert({
      client_id: clientId,
      source,
      phone: normalizedPhone || null,
      whatsapp: normalizePhone(whatsapp) || null,
      instagram: instagram || null,
      facebook: facebook || null,
      external_id: externalId || null,
      email: email || null,
      name: name || null,
      account_name: accountName || name || null,
    })
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
