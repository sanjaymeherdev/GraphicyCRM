// modules/followup/service.js — re-engages leads gone quiet. Ported from
// src/workers/followup-worker.js, but wired into GraphicyCRM's existing
// poll-tick pattern (see server.js's scheduleService.pollDuePosts call)
// instead of a standalone process, since this app already has one process
// running background ticks.
//
// NOTE: GraphicyCRM already has modules/automations#checkFollowUps, which
// schedules ONE due-timestamped follow-up per triggered automation (e.g.
// "if no reply in 24h, send template X"). This module is a different
// concept: a recurring rule ("if a channel goes quiet for N hours, send
// message Y") that continuously scans ALL of a channel's leads, not tied
// to any specific automation having fired first. Both can run side by
// side — crm_followup_log's unique constraint keeps this module from ever
// double-sending, independent of crm_followups' own `fired` flag.
const { supabase } = require('../../shared/db');
const { recordMessage } = require('../../shared/crmMessages');

async function listRules(clientId) {
  const { data, error } = await supabase.from('crm_followup_rules').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function createRule(clientId, body) {
  const { name, channel, inactivity_hours, message } = body || {};
  if (!name || !channel || !message) throw new Error('name, channel, and message are required');
  const { data, error } = await supabase.from('crm_followup_rules').insert({
    client_id: clientId, name, channel, inactivity_hours: inactivity_hours || 24, message,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateRule(clientId, id, patch) {
  const allowed = ['name', 'channel', 'inactivity_hours', 'message', 'active'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  clean.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('crm_followup_rules').update(clean).eq('id', id).eq('client_id', clientId).select().single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Rule not found');
  return data;
}

async function deleteRule(clientId, id) {
  const { error } = await supabase.from('crm_followup_rules').delete().eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

// Threads has no DM/messaging API (see modules/threads/service.js's
// sendDM stub) so it's deliberately excluded — a followup rule for
// channel='threads' will just never find a send function and get skipped
// with a warning below, rather than crashing the poll tick.
const SEND_FNS = {
  whatsapp: () => require('../whatsapp/service'),
  facebook: () => require('../facebook/service'),
  instagram: () => require('../instagram/service'),
};

/**
 * Poll tick (see server.js): for every active rule, finds leads on that
 * channel whose last message is inbound and older than inactivity_hours,
 * sends the follow-up, and logs it in crm_followup_log so the same
 * lead+rule pair never fires twice (the table's unique constraint is the
 * real guard; this query is just the efficient path to it).
 */
async function pollDueFollowups(userIdForClient) {
  const { data: rules, error } = await supabase.from('crm_followup_rules').select('*').eq('active', true);
  if (error) { console.error('[followup] failed to load rules:', error.message); return; }

  for (const rule of rules || []) {
    const cutoff = new Date(Date.now() - rule.inactivity_hours * 60 * 60 * 1000).toISOString();
    const { data: leads, error: leadsErr } = await supabase.from('crm_leads')
      .select('id, phone, external_id, client_id, last_message_at').eq('client_id', rule.client_id)
      .eq('source', rule.channel).lte('last_message_at', cutoff);
    if (leadsErr) { console.error(`[followup] rule ${rule.id} lead query failed:`, leadsErr.message); continue; }

    const getService = SEND_FNS[rule.channel];
    if (!getService) { console.warn(`[followup] channel "${rule.channel}" isn't wired to a send function yet — skipping rule ${rule.id}`); continue; }

    for (const lead of leads || []) {
      const { data: already } = await supabase.from('crm_followup_log').select('id').eq('rule_id', rule.id).eq('lead_id', lead.id).maybeSingle();
      if (already) continue;

      try {
        const userId = await userIdForClient(rule.client_id);
        if (!userId) continue;
        const svc = getService();

        if (rule.channel === 'whatsapp') {
          // sendMessage logs to crm_messages itself (skipCrmLog defaults
          // false) — recording it again below would duplicate the row.
          await svc.sendMessage(userId, { to: lead.phone, kind: 'text', cfg: { body: rule.message } });
        } else {
          await svc.sendDM(userId, lead.external_id, rule.message);
          await recordMessage(rule.client_id, lead.id, { channel: rule.channel, direction: 'out', messageType: 'text', body: rule.message });
        }

        await supabase.from('crm_followup_log').insert({ rule_id: rule.id, lead_id: lead.id });
      } catch (err) {
        // A single lead's send failing (e.g. 24h WhatsApp window closed)
        // shouldn't stop the rest of the batch — log and move on, same as
        // modules/schedule's pollDuePosts.
        console.error(`[followup] rule ${rule.id} lead ${lead.id} failed:`, err.message);
      }
    }
  }
}

module.exports = { listRules, createRule, updateRule, deleteRule, pollDueFollowups };
