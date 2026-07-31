// modules/webhook/service.js — POST /api/webhook/generate (auth'd) issues a
// per-client inbound URL; POST /api/webhook/in/:token (public) is what a
// webform/Zapier/custom integration posts to. Payload shape is intentionally
// loose: { name, phone, email, message } — anything else is ignored.
const crypto = require('crypto');
const { supabase } = require('../../shared/db');

async function generateToken(clientId) {
  const token = crypto.randomBytes(24).toString('base64url');
  const { data, error } = await supabase.from('crm_webhook_tokens')
    .upsert({ client_id: clientId, token }, { onConflict: 'client_id' })
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function getClientIdForToken(token) {
  const { data, error } = await supabase.from('crm_webhook_tokens').select('client_id').eq('token', token).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.client_id || null;
}

/** Upserts a lead by phone/email (whichever is given) for this client, and
 * logs the payload's message text as an inbound crm_messages row if present. */
async function ingest(clientId, { name, phone, email, message }) {
  if (!phone && !email) throw new Error('phone or email is required');

  let lead;
  let q = supabase.from('crm_leads').select('*').eq('client_id', clientId);
  q = phone ? q.eq('phone', phone) : q.eq('email', email);
  const { data: existing } = await q.maybeSingle();

  if (existing) {
    lead = existing;
  } else {
    const { data, error } = await supabase.from('crm_leads').insert({
      client_id: clientId, name: name || null, phone: phone || null, email: email || null, source: 'webform',
    }).select().single();
    if (error) throw new Error(error.message);
    lead = data;
  }

  if (message) {
    const { error } = await supabase.from('crm_messages').insert({
      client_id: clientId, lead_id: lead.id, channel: 'webform', direction: 'in',
      message_type: 'text', body: message,
    });
    if (error) throw new Error(error.message);
  }

  return lead;
}

module.exports = { generateToken, getClientIdForToken, ingest };
