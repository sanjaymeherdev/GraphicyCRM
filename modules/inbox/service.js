// modules/inbox/service.js — GET /api/inbox
// Builds the unified-thread view the frontend renders: one thread per lead
// that has at least one message, most-recently-active first.
const { supabase } = require('../../shared/db');

async function getInbox(clientId, { channel } = {}) {
  let leadsQ = supabase.from('crm_leads').select('id, name, phone, email, source')
    .eq('client_id', clientId).not('last_message_at', 'is', null)
    .order('last_message_at', { ascending: false });
  const { data: leads, error: leadsErr } = await leadsQ;
  if (leadsErr) throw new Error(leadsErr.message);
  if (!leads?.length) return [];

  let msgQ = supabase.from('crm_messages').select('*')
    .in('lead_id', leads.map((l) => l.id)).order('created_at', { ascending: true });
  if (channel) msgQ = msgQ.eq('channel', channel);
  const { data: messages, error: msgErr } = await msgQ;
  if (msgErr) throw new Error(msgErr.message);

  const byLead = new Map();
  for (const m of messages || []) {
    if (!byLead.has(m.lead_id)) byLead.set(m.lead_id, []);
    byLead.get(m.lead_id).push(m);
  }

  return leads
    .map((lead) => {
      const msgs = byLead.get(lead.id) || [];
      if (channel && !msgs.length) return null; // filtered out entirely for this channel
      const last = msgs[msgs.length - 1];
      return {
        id: lead.id, name: lead.name, phone: lead.phone, email: lead.email,
        channel: last?.channel || lead.source,
        last_message: last?.body || '',
        last_message_at: last?.created_at || null,
        needs_reply: msgs.length ? msgs[msgs.length - 1].direction === 'in' : false,
        messages: msgs,
      };
    })
    .filter(Boolean);
}

module.exports = { getInbox };
