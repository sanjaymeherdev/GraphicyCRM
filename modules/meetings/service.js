// modules/meetings/service.js — booking list + public webhook receiver for
// external booking tools, ported from src/routes/meetings.js. A booking
// attaches to a lead by matching attendee_email/phone against crm_leads,
// so meetings show up as activity on an existing lead when possible.
// Auth for the public receiver reuses modules/webhook's existing
// crm_webhook_tokens (see getClientIdForToken there) rather than a
// separate per-client secret — one inbound-webhook token system for the
// whole app, same URL shape as the lead-intake webhook.
const { supabase } = require('../../shared/db');

async function listMeetings(clientId) {
  const { data, error } = await supabase.from('crm_meetings').select('*, crm_leads(name)').eq('client_id', clientId).order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function findLeadByAttendee(clientId, { email, phone }) {
  let q = supabase.from('crm_leads').select('id').eq('client_id', clientId);
  if (email) q = q.eq('email', email);
  else if (phone) q = q.eq('phone', phone);
  else return null;
  const { data } = await q.maybeSingle();
  return data?.id || null;
}

/** Handles one inbound booking event from the provider. Idempotent on
 * (client_id, external_id) — the schema's unique index means a retried
 * webhook delivery upserts instead of creating a duplicate meeting. */
async function handleBookingWebhook(clientId, payload) {
  const { title, attendee_name, attendee_email, attendee_phone, starts_at, ends_at, status, external_id } = payload || {};
  if (!title || !starts_at) throw new Error('title and starts_at are required');

  const leadId = await findLeadByAttendee(clientId, { email: attendee_email, phone: attendee_phone });

  const { data, error } = await supabase.from('crm_meetings').upsert({
    client_id: clientId, lead_id: leadId, title, attendee_name: attendee_name || null,
    attendee_email: attendee_email || null, starts_at, ends_at: ends_at || null,
    status: status || 'scheduled', external_id: external_id || null,
  }, { onConflict: 'client_id,external_id' }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { listMeetings, handleBookingWebhook };
