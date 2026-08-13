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

const LEAD_SELECT = 'id, name, account_name, phone, whatsapp, instagram, facebook, email, source, external_id';

/**
 * Finds or creates a lead for this client. Dedup is CROSS-CHANNEL: if this
 * person has messaged before through ANY channel, this returns that same
 * lead instead of creating a new one — a returning contact simply gets a
 * new message in the inbox, they never show up again as a fresh "new lead"
 * card just because this particular message arrived on a different
 * platform than the first one did.
 *
 * Pass `phone` for WhatsApp/webform/sheet/integrations (dedup on phone) —
 * normalized to digits-only, since Meta's webhook events and a
 * manually-entered "+1 555-123-4567" lead need to match the same row —
 * `externalId` for platforms with no phone number — Facebook PSID,
 * Instagram IGSID, Threads user id — or `email` for sources with only an
 * email column, like a sheet watcher with no phone_column configured.
 *
 * Match order (first hit wins, searched across every source for this
 * client — not scoped to the current one):
 *   1. phone/whatsapp against crm_leads.phone OR crm_leads.whatsapp.
 *   2. email against crm_leads.email.
 *   3. externalId against this channel's own identity column
 *      (crm_leads.instagram for Instagram, crm_leads.facebook for
 *      Facebook) — so a returning IG/FB sender is matched no matter how
 *      they first entered the CRM (WhatsApp, a manually added contact,
 *      another platform's comment, etc).
 *   4. Fallback for channels with no dedicated identity column (Threads):
 *      externalId against crm_leads.external_id, scoped to this source only
 *      — a PSID/IGSID/Threads-id isn't comparable across platforms, so this
 *      step alone stays same-source, same as the original behavior.
 *
 * Only when NONE of those match does this create a new lead, tagged with
 * `source` = the channel it first arrived on.
 */
async function findOrCreateLead(clientId, source, { phone = null, externalId = null, email = null, name = null, accountName = null, whatsapp = null, instagram = null, facebook = null } = {}) {
  const normalizedPhone = normalizePhone(phone || whatsapp);
  if (!normalizedPhone && !externalId && !email) throw new Error('findOrCreateLead requires phone, externalId, or email');

  // Instagram/Facebook have a dedicated identity column that can carry a
  // sender's id regardless of which channel originally created the lead;
  // other channels (Threads) fall back to same-source external_id dedup,
  // since their ids aren't safely comparable across platforms.
  const identityColumn = source === 'instagram' ? 'instagram' : source === 'facebook' ? 'facebook' : null;

  let existing = null;

  if (!existing && normalizedPhone) {
    const { data, error } = await supabase.from('crm_leads').select(LEAD_SELECT)
      .eq('client_id', clientId)
      .or(`phone.eq.${normalizedPhone},whatsapp.eq.${normalizedPhone}`)
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    existing = data;
  }

  if (!existing && email) {
    const { data, error } = await supabase.from('crm_leads').select(LEAD_SELECT)
      .eq('client_id', clientId).eq('email', email)
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    existing = data;
  }

  if (!existing && externalId && identityColumn) {
    const { data, error } = await supabase.from('crm_leads').select(LEAD_SELECT)
      .eq('client_id', clientId).eq(identityColumn, externalId)
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    existing = data;
  }

  if (!existing && externalId) {
    const { data, error } = await supabase.from('crm_leads').select(LEAD_SELECT)
      .eq('client_id', clientId).eq('source', source).eq('external_id', externalId)
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    existing = data;
  }

  if (existing) {
    const updates = {};
    if (normalizedPhone && !existing.phone) updates.phone = normalizedPhone;
    if (whatsapp && !existing.whatsapp) updates.whatsapp = normalizePhone(whatsapp);
    if (instagram && !existing.instagram) updates.instagram = instagram;
    if (facebook && !existing.facebook) updates.facebook = facebook;
    if (email && !existing.email) updates.email = email;
    // Remember this channel's native id on the lead going forward, so the
    // NEXT message on this same platform matches step 3 directly — even
    // when this particular message only matched via phone/email.
    if (externalId && identityColumn && !existing[identityColumn]) updates[identityColumn] = externalId;
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
      instagram: instagram || (source === 'instagram' ? externalId : null) || null,
      facebook: facebook || (source === 'facebook' ? externalId : null) || null,
      external_id: externalId || null,
      email: email || null,
      name: name || null,
      account_name: accountName || name || null,
    })
    .select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

/**
 * True if a message with this external_id has already been recorded for
 * this channel — regardless of direction. Used by inbound webhook handlers
 * to make delivery idempotent: Meta (and Threads in particular) can and
 * will redeliver the same event, and a bot's own outbound reply can come
 * back around as a *new* inbound webhook event (the platform reports it as
 * a fresh reply on the thread). Without this check, a redelivered/echoed
 * event gets recorded as a brand new message every time and, worse, can
 * re-trigger auto-reply automations — which post another reply, which
 * generates another webhook event, forming a runaway loop.
 */
async function messageExists(clientId, channel, externalId) {
  if (!externalId) return false;
  const { data, error } = await supabase.from('crm_messages')
    .select('id').eq('client_id', clientId).eq('channel', channel).eq('external_id', externalId)
    .limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
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

module.exports = { resolveClientId, findOrCreateLead, recordMessage, messageExists };
