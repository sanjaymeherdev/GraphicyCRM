// modules/webhook/service.js — POST /api/webhook/generate (auth'd) issues a
// per-client inbound URL; POST /api/webhook/in/:token (public) is what a
// webform/Zapier/custom integration posts to. Payload shape is intentionally
// loose: { name, phone, email, message } — anything else is ignored.
const crypto = require('crypto');
const { supabase } = require('../../shared/db');
const { findOrCreateLead, recordMessage } = require('../../shared/crmMessages');

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
 * logs the payload's message text as an inbound crm_messages row if present.
 * Uses the same find-or-create-lead helper every channel module shares —
 * this also normalizes phone to digits-only, so a webform submission for a
 * number that already messaged in on WhatsApp lands on the same lead
 * instead of silently creating a duplicate. */
async function ingest(clientId, { name, phone, email, message }) {
  if (!phone && !email) throw new Error('phone or email is required');
  const leadId = await findOrCreateLead(clientId, 'webform', { phone, email, name });
  const { data: lead, error } = await supabase.from('crm_leads').select('*').eq('id', leadId).single();
  if (error) throw new Error(error.message);
  if (message) await recordMessage(clientId, leadId, { channel: 'webform', direction: 'in', messageType: 'text', body: message });
  return lead;
}

module.exports = { generateToken, getClientIdForToken, ingest };
