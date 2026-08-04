// modules/bot-builder/service.js — deterministic rule-based bot, ported
// from src/routes/bot-builder.js + src/services/bot-engine.js. Distinct
// from modules/automations (single keyword->text reply) by supporting
// multiple match types and, optionally, replying with a saved interactive
// template instead of plain text. Intended to run BEFORE the AI auto-reply
// in modules/ai-bot falls through — see matchRule()'s doc comment.
const { supabase } = require('../../shared/db');

async function listRules(clientId) {
  const { data, error } = await supabase.from('crm_bot_rules').select('*').eq('client_id', clientId).order('priority', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function createRule(clientId, body) {
  const { name, match_type, match_value, channels, reply_type, reply_text, interactive_template_id, priority } = body || {};
  if (!name || !match_value) throw new Error('name and match_value are required');
  if (reply_type !== 'interactive_template' && !reply_text) throw new Error('reply_text is required unless reply_type is "interactive_template"');
  const { data, error } = await supabase.from('crm_bot_rules').insert({
    client_id: clientId, name, match_type: match_type || 'contains', match_value,
    channels: channels || [], reply_type: reply_type || 'text', reply_text: reply_text || null,
    interactive_template_id: interactive_template_id || null, priority: priority || 0,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateRule(clientId, id, patch) {
  const allowed = ['name', 'match_type', 'match_value', 'channels', 'reply_type', 'reply_text', 'interactive_template_id', 'priority', 'active'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  clean.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('crm_bot_rules').update(clean).eq('id', id).eq('client_id', clientId).select().single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Rule not found');
  return data;
}

async function deleteRule(clientId, id) {
  const { error } = await supabase.from('crm_bot_rules').delete().eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

function matches(rule, text) {
  const value = rule.match_value;
  switch (rule.match_type) {
    case 'exact': return text.trim().toLowerCase() === value.toLowerCase();
    case 'starts_with': return text.trim().toLowerCase().startsWith(value.toLowerCase());
    case 'regex': try { return new RegExp(value, 'i').test(text); } catch { return false; }
    case 'contains':
    default: return text.toLowerCase().includes(value.toLowerCase());
  }
}

/**
 * Returns the highest-priority active rule matching inbound text on this
 * channel, or null. Callers (each platform module's tryAutoReply-equivalent)
 * should check this BEFORE running the AI auto-reply, and only fall
 * through to AI when this returns null — that ordering is what makes this
 * a "deterministic bot first, AI fallback second" system rather than the
 * two competing to answer the same message.
 */
async function matchRule(clientId, { channel, text }) {
  if (!text) return null;
  const { data, error } = await supabase.from('crm_bot_rules').select('*')
    .eq('client_id', clientId).eq('active', true).contains('channels', [channel]).order('priority', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).find((rule) => matches(rule, text)) || null;
}

module.exports = { listRules, createRule, updateRule, deleteRule, matchRule };
