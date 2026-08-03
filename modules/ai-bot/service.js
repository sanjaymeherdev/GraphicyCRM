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
  // Meta models - Text only
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-3b-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  
  // Mistral models
  'mistralai/mistral-medium-3.5-128b',
  
  // NVIDIA text models (excluding safety/content moderation)
  'nvidia/ising-calibration-1-35b-a3b',
  'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-nano-12b-v2-vl',
];
const DEFAULT_MODEL = 'meta/llama-3.1-70b-instruct';

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
// Sheet lookup / doc grounding — reused by modules/automations/service.js's
// matchRule(), the single rule-matching engine (see that file's header
// comment). This module used to also own a second keyword-matching engine
// and its own `crm_bot_rules` CRUD, reachable only via /api/ai-bot/rules and
// /api/ai-bot/match — nothing in the live inbound webhook path ever called
// it, so saving a rule there didn't affect real messages. That engine has
// been removed; modules/ai-bot/routes.js now delegates rule CRUD and
// matching to modules/automations/service.js instead. See
// migrations/007_fold_bot_rules_into_automations.sql.
// -----------------------------------------------------------------------
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

module.exports = {
  generateReply, getAvailableModels, isAllowedModel,
  performSheetLookup, getGroundingDocContent,
};
