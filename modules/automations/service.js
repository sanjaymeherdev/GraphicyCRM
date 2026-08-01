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
    const { data: tpl } = await supabase.from('crm_templates').select('body').eq('id', rule.template_id).single();
    const body = (tpl?.body || '').split('{{sheet_lookup}}').join(sheetLookupValue);
    return { rule, replyType: 'text', text: body, sheetLookupResult };
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

module.exports = { listAutomations, createAutomation, updateAutomation, deleteAutomation, matchRule };
