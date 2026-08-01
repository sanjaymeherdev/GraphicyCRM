// modules/ai-bot/service.js — AI chat completions (NVIDIA's OpenAI-compatible
// API) plus keyword-based automation rule matching, optionally grounded in a
// Google Sheet lookup or a Google Doc's content. Ported from the original
// repo's sm/lib/ai.js (chat completions) and src/routes/bot-engine.js (rule
// matching, sheet lookup, doc grounding).
const axios = require('axios');
const { supabase } = require('../../shared/db');
const { getValidGoogleAccessToken } = require('../../shared/googleAuth');
const sheets = require('../sheets/service');
const docs = require('../docs/service');

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

const ALLOWED_MODELS = [
  'mistralai/mistral-small-4-119b-2603',
  'mistralai/mistral-large-3-675b-instruct-2512',
  'mistralai/mistral-medium-3.5-128b',
  'mistralai/ministral-14b-instruct-2512',
  'mistralai/mixtral-8x7b-instruct-v0.1',
];
const DEFAULT_MODEL = 'mistralai/mistral-small-4-119b-2603';

function isAllowedModel(modelId) { return ALLOWED_MODELS.includes(modelId); }

/** Direct chat completion — pass a plain messages[] array ({role, content}). */
async function generateReply(messages, options = {}) {
  const { model = DEFAULT_MODEL, temperature = 0.7, max_tokens = 2048 } = options;
  if (!messages?.length) throw new Error('messages array is required and must not be empty');
  if (!isAllowedModel(model)) throw new Error(`Model "${model}" is not allowed. Allowed: ${ALLOWED_MODELS.join(', ')}`);
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY environment variable is not set');

  try {
    const response = await axios.post(`${NVIDIA_BASE_URL}/chat/completions`, {
      model, messages: messages.map((m) => ({ role: m.role, content: m.content })), temperature, max_tokens, top_p: 1,
    }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NVIDIA_API_KEY}` } });

    return {
      success: true,
      content: response.data?.choices?.[0]?.message?.content || '',
      model: response.data?.model || model,
      usage: response.data?.usage || null,
    };
  } catch (err) {
    throw new Error(`AI reply generation failed: ${err.response?.data?.error?.message || err.message}`);
  }
}

function getAvailableModels() { return { models: ALLOWED_MODELS, default_model: DEFAULT_MODEL }; }

// -----------------------------------------------------------------------
// Rule-based automation matching — `crm_bot_rules` rows keyed by keywords,
// each optionally grounded by a Sheet lookup and/or a Doc's content before
// generating the AI reply. This is what a WhatsApp/Facebook/Instagram
// inbound-message handler calls to decide "does an automation own this
// message, and if so what should the reply be".
// -----------------------------------------------------------------------
function matchesKeyword(text, keywords, matchType) {
  const norm = (text || '').toLowerCase().trim();
  return (keywords || []).some((kw) => {
    const k = kw.toLowerCase().trim();
    if (matchType === 'exact') return norm === k;
    if (matchType === 'fuzzy') return norm.includes(k) || norm.split(/\s+/).some((word) => editDistance(word, k) <= 1);
    return norm.includes(k); // contains (default)
  });
}
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

async function performSheetLookup(userId, lookupConfig, text) {
  const { spreadsheetId, worksheet, lookupColumn, returnColumn, matchType } = lookupConfig || {};
  if (!spreadsheetId || !worksheet || !lookupColumn || !returnColumn) return { found: false };
  try {
    const rows = await sheets.getRows(userId, spreadsheetId, worksheet);
    const norm = (s) => (s || '').toString().trim().toLowerCase();
    const normText = norm(text);
    for (const row of rows) {
      const cell = norm(row[lookupColumn]);
      if (!cell) continue;
      const isMatch = matchType === 'exact' ? normText === cell : (normText.includes(cell) || cell.includes(normText));
      if (isMatch) return { found: true, value: row[returnColumn] ?? '', matchedRow: row };
    }
    return { found: false };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

// 5-minute in-memory cache per docId — grounding rarely needs a fresh fetch on every message.
const docContentCache = new Map();
const DOC_CACHE_TTL_MS = 5 * 60 * 1000;
async function getGroundingDocContent(userId, docId) {
  if (!docId) return null;
  const cached = docContentCache.get(docId);
  if (cached && (Date.now() - cached.fetchedAt) < DOC_CACHE_TTL_MS) return cached.content;
  try {
    const { text } = await docs.getDoc(userId, docId);
    const content = text.trim().slice(0, 8000); // keep the system prompt bounded
    docContentCache.set(docId, { content, fetchedAt: Date.now() });
    return content;
  } catch (err) {
    console.error('[ai-bot] doc grounding fetch failed:', err.message);
    return null;
  }
}

/**
 * Finds the first active rule whose keywords match `text`, resolves any
 * sheet-lookup / doc-grounding configured on it, and — if the rule's action
 * is 'ai_reply' — generates the actual reply. Returns null if no rule matches.
 */
async function matchRule(userId, { contactId, text, replyOptionId }) {
  const { data: rules, error } = await supabase.from('crm_bot_rules').select('*').eq('user_id', userId).eq('active', true);
  if (error) { console.error('[ai-bot] failed to load rules:', error.message); return null; }

  const rule = (rules || []).find((r) => matchesKeyword(text, r.keywords, r.match_type));
  if (!rule) return null;

  const ctx = { reply_option: replyOptionId };
  const sheetLookupConfig = rule.action_config?.sheet_lookup;
  if (sheetLookupConfig?.spreadsheetId) {
    const result = await performSheetLookup(userId, sheetLookupConfig, text);
    ctx.sheet_lookup = result.found ? result.value : '__not_found__';
  }

  const docId = rule.action_config?.knowledge_doc?.docId;
  const docContent = docId ? await getGroundingDocContent(userId, docId) : null;

  if (rule.action_type === 'template') {
    return { rule, replyType: 'template', templateId: rule.action_config?.template_id, ctx };
  }

  if (rule.action_type === 'ai_reply') {
    const systemPrompt = [
      rule.action_config?.ai_prompt || 'You are a helpful assistant.',
      docContent ? `\n\nReference material:\n${docContent}` : '',
      ctx.sheet_lookup && ctx.sheet_lookup !== '__not_found__' ? `\n\nLooked-up value: ${ctx.sheet_lookup}` : '',
    ].join('');
    const { content } = await generateReply([{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], {
      model: rule.action_config?.model,
    });
    return { rule, replyType: 'text', text: content, ctx };
  }

  return { rule, replyType: 'none', ctx };
}

async function listRules(userId) {
  const { data, error } = await supabase.from('crm_bot_rules').select('*').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return data || [];
}
async function createRule(userId, rule) {
  const { data, error } = await supabase.from('crm_bot_rules').insert({ user_id: userId, active: true, ...rule }).select().single();
  if (error) throw new Error(error.message);
  return data;
}
async function updateRule(userId, id, patch) {
  const { data, error } = await supabase.from('crm_bot_rules').update(patch).eq('id', id).eq('user_id', userId).select().single();
  if (error) throw new Error(error.message);
  return data;
}
async function deleteRule(userId, id) {
  const { error } = await supabase.from('crm_bot_rules').delete().eq('id', id).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

module.exports = {
  generateReply, getAvailableModels, isAllowedModel,
  matchRule, listRules, createRule, updateRule, deleteRule,
  performSheetLookup, getGroundingDocContent,
};
