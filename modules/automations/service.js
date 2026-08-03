// modules/automations/service.js — CRUD /api/automations (crm_automations),
// plus matchRule() for wiring inbound webhooks -> automated replies later
// (channel webhook handlers aren't calling this yet — see modules/*/routes.js
// webhook handlers, which currently only log; call matchRule() from there
// when you're ready to go live with auto-replies).
const { supabase } = require('../../shared/db');
const { resolveFirstUserId } = require('../../shared/clientContext');
const aiBot = require('../ai-bot/service');

async function listAutomations(clientId) {
  const { data, error } = await supabase.from('crm_automations').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

const ALLOWED_FIELDS = [
  'name', 'keywords', 'match_type', 'action_type', 'template_id', 'ai_prompt',
  'ai_fallback', 'conditions', 'else_template_id', 'follow_up', 'active', 'action_config',
];
function clean(patch) {
  return Object.fromEntries(Object.entries(patch || {}).filter(([k]) => ALLOWED_FIELDS.includes(k)));
}

async function createAutomation(clientId, body) {
  const { data, error } = await supabase.from('crm_automations').insert({ client_id: clientId, ...clean(body) }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateAutomation(clientId, id, body) {
  const patch = clean(body);
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('crm_automations').update(patch)
    .eq('id', id).eq('client_id', clientId).select().single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Automation not found');
  return data;
}

async function deleteAutomation(clientId, id) {
  const { error } = await supabase.from('crm_automations').delete().eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

function matchesKeyword(text, keywords, matchType) {
  const norm = (text || '').toLowerCase().trim();
  return (keywords || []).some((kw) => {
    const k = kw.toLowerCase().trim();
    if (matchType === 'exact') return norm === k;
    return norm.includes(k);
  });
}

/** Finds the first active automation matching `text` for a lead's incoming
 * message, and resolves what to send back (a template body or an AI reply).
 * If the matched rule has action_config.sheet_lookup and/or .knowledge_doc
 * configured, those get resolved first and used as grounding — same
 * mechanism as modules/ai-bot's bot-engine, reused (not duplicated) here. */
async function matchRule(clientId, { text }) {
  const { data: rules, error } = await supabase.from('crm_automations').select('*').eq('client_id', clientId).eq('active', true);
  if (error) throw new Error(error.message);

  const rule = (rules || []).find((r) => matchesKeyword(text, r.keywords, r.match_type));
  if (!rule) return null;

  const sheetLookupConfig = rule.action_config?.sheet_lookup;
  const docConfig = rule.action_config?.knowledge_doc;
  let sheetLookupResult = null;
  let docContent = null;
  if (sheetLookupConfig?.spreadsheetId || (rule.action_type === 'ai_reply' && docConfig?.docId)) {
    const userId = await resolveFirstUserId(clientId);
    if (userId) {
      if (sheetLookupConfig?.spreadsheetId) sheetLookupResult = await aiBot.performSheetLookup(userId, sheetLookupConfig, text);
      if (rule.action_type === 'ai_reply' && docConfig?.docId) docContent = await aiBot.getGroundingDocContent(userId, docConfig.docId);
    }
  }
  const sheetLookupValue = sheetLookupResult?.found ? String(sheetLookupResult.value) : '';

  if (rule.action_type === 'template' && rule.template_id) {
    const { data: tpl } = await supabase.from('crm_templates').select('body, format').eq('id', rule.template_id).single();
    const rawBody = (tpl?.body || '').split('{{sheet_lookup}}').join(sheetLookupValue);
    const format = tpl?.format || 'text';

    if (format === 'json') {
      try {
        return { rule, replyType: 'json', payload: JSON.parse(rawBody), sheetLookupResult };
      } catch (err) {
        console.error(`[automations] template ${rule.template_id} has format=json but body is not valid JSON:`, err.message);
        return { rule, replyType: 'none', sheetLookupResult };
      }
    }
    if (format === 'html') {
      return { rule, replyType: 'html', html: rawBody, sheetLookupResult };
    }
    return { rule, replyType: 'text', text: rawBody, sheetLookupResult };
  }

  if (rule.action_type === 'ai_reply') {
    const systemPrompt = [
      rule.ai_prompt || 'You are a helpful assistant.',
      docContent ? `\n\nReference material:\n${docContent}` : '',
      sheetLookupResult?.found ? `\n\nSheet lookup result for this message: "${sheetLookupValue}". Use this as the answer if it's relevant, in your own words.` : '',
    ].join('');
    try {
      const { content } = await aiBot.generateReply([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ]);
      return { rule, replyType: 'text', text: content, sheetLookupResult };
    } catch (err) {
      if (rule.ai_fallback) return { rule, replyType: 'text', text: rule.ai_fallback, sheetLookupResult };
      throw err;
    }
  }

  return { rule, replyType: 'none', sheetLookupResult };
}

/** Schedules a crm_followups row per the matched rule's follow_up config —
 * called by each channel's inbound handler right after it sends the auto-reply. */
async function scheduleFollowUp(clientId, leadId, rule) {
  if (!rule.follow_up?.enabled || !rule.follow_up?.template_id) return;
  const hours = rule.follow_up.hours || 4;
  const { error } = await supabase.from('crm_followups').insert({
    client_id: clientId, lead_id: leadId, automation_id: rule.id,
    condition: rule.follow_up.condition || 'no_reply',
    due_at: new Date(Date.now() + hours * 3600000).toISOString(),
  });
  if (error) console.error('[automations] failed to schedule follow-up:', error.message);
}

async function markFollowUpFired(id) {
  await supabase.from('crm_followups').update({ fired: true, fired_at: new Date().toISOString() }).eq('id', id);
}

/** Sends a follow-up's template body through whichever channel the lead's most
 * recent message was on. WhatsApp needs an approved template for a send this
 * far outside any reply window; Facebook/Instagram DM plain text (or a raw
 * JSON payload, for format='json' templates) is fine; email sends the body
 * as HTML when the template's format is 'html', plain text otherwise;
 * Threads has no DM API, so a threads-sourced lead can't get a DM follow-up. */
async function sendFollowUpMessage(userId, clientId, lead, channel, tpl) {
  const { recordMessage } = require('../../shared/crmMessages');
  if (channel === 'whatsapp' && lead.phone) {
    const whatsapp = require('../whatsapp/service');
    if (tpl.type === 'whatsapp_template' && tpl.meta_template_name) {
      await whatsapp.sendTemplate(userId, { to: lead.phone, name: tpl.meta_template_name, language: tpl.language || 'en_US', components: [] });
    } else if (tpl.format === 'json') {
      try { await whatsapp.sendRawMessage(userId, { to: lead.phone, payload: JSON.parse(tpl.body) }); }
      catch (err) { console.error(`[automations] follow-up template ${tpl.id} format=json but invalid JSON body:`, err.message); }
    } else {
      await whatsapp.sendMessage(userId, { to: lead.phone, kind: 'text', cfg: { body: tpl.body } });
    }
  } else if ((channel === 'facebook' || channel === 'instagram') && lead.external_id) {
    const svc = require(`../${channel}/service`);
    if (tpl.format === 'json') {
      try {
        const externalId = await svc.sendDMRaw(userId, lead.external_id, JSON.parse(tpl.body));
        await recordMessage(clientId, lead.id, { channel, direction: 'out', messageType: 'json', body: tpl.body, externalId });
      } catch (err) {
        console.error(`[automations] follow-up template ${tpl.id} format=json but invalid JSON body:`, err.message);
      }
    } else {
      const externalId = await svc.sendDM(userId, lead.external_id, tpl.body);
      await recordMessage(clientId, lead.id, { channel, direction: 'out', messageType: 'text', body: tpl.body, externalId });
    }
  } else if (channel === 'gmail' && lead.email) {
    const gmail = require('../gmail/service');
    const isHtml = tpl.format === 'html';
    const externalId = await gmail.sendEmail(userId, { to: lead.email, subject: tpl.name || 'Follow-up', ...(isHtml ? { html: tpl.body } : { text: tpl.body }) });
    await recordMessage(clientId, lead.id, { channel: 'gmail', direction: 'out', messageType: isHtml ? 'html' : 'text', body: tpl.body, externalId });
  } else {
    console.warn(`[automations] follow-up for lead ${lead.id}: no sendable channel/identifier (channel="${channel}")`);
  }
}

/** Polls crm_followups for due, unfired rows and sends them (if their
 * condition still holds — currently only 'no_reply' is implemented: skips
 * silently if the lead has messaged back since, i.e. crm_leads.needs_reply
 * flipped true from a later inbound message). Called on a timer from server.js. */
async function checkFollowUps() {
  const { data: due, error } = await supabase.from('crm_followups')
    .select('*, crm_leads(*), crm_automations(follow_up)')
    .eq('fired', false).lte('due_at', new Date().toISOString());
  if (error) throw new Error(error.message);

  for (const followup of due || []) {
    try {
      const lead = followup.crm_leads;
      if (!lead) { await markFollowUpFired(followup.id); continue; }
      if (followup.condition === 'no_reply' && lead.needs_reply) { await markFollowUpFired(followup.id); continue; } // lead already replied — condition no longer holds

      const templateId = followup.crm_automations?.follow_up?.template_id;
      const { data: tpl } = templateId ? await supabase.from('crm_templates').select('*').eq('id', templateId).single() : { data: null };
      if (!tpl) { await markFollowUpFired(followup.id); continue; }

      const { data: lastMsg } = await supabase.from('crm_messages').select('channel')
        .eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const channel = lastMsg?.channel || lead.source;
      const userId = await resolveFirstUserId(followup.client_id);
      if (userId) await sendFollowUpMessage(userId, followup.client_id, lead, channel, tpl);
      await markFollowUpFired(followup.id);
    } catch (err) {
      console.error(`[automations] follow-up ${followup.id} failed:`, err.message);
    }
  }
}

module.exports = { listAutomations, createAutomation, updateAutomation, deleteAutomation, matchRule, scheduleFollowUp, checkFollowUps };
