// modules/help-bot/service.js — a support/help assistant for people USING
// GraphicyCRM (not a customer-facing automation reply bot — that's
// modules/ai-bot's matchRule/generateReply used by modules/automations).
// This module answers questions like "how do I send a WhatsApp template?"
// or "why can't I message this contact?" by grounding a chat completion in
// README.md (in this same folder) — the single source of truth for what
// the bot is allowed to claim about the product. No JSON-building mode:
// unlike the source app's assistant, this is general help only.
const fs = require('fs');
const path = require('path');
const aiBot = require('../ai-bot/service');

const README_PATH = path.join(__dirname, 'README.md');

// Cache the file in memory — re-read only if it changes on disk, so a docs
// edit doesn't require a server restart to take effect, without hitting the
// filesystem on every single chat message.
let cachedKnowledge = null;
let cachedMtimeMs = 0;

function loadKnowledge() {
  try {
    const stat = fs.statSync(README_PATH);
    if (!cachedKnowledge || stat.mtimeMs !== cachedMtimeMs) {
      cachedKnowledge = fs.readFileSync(README_PATH, 'utf8');
      cachedMtimeMs = stat.mtimeMs;
    }
    return cachedKnowledge;
  } catch (err) {
    console.error('[help-bot] failed to read README.md:', err.message);
    return null;
  }
}

function buildSystemPrompt() {
  const knowledge = loadKnowledge();
  return [
    'You are the in-app Help Assistant for GraphicyCRM, a CRM that unifies ',
    'WhatsApp/Instagram/Facebook/Threads/Gmail messaging into one inbox.',
    'Answer the user\'s question about how to use the product, using ONLY ',
    'the reference guide below. If the guide doesn\'t cover something, say ',
    'you\'re not sure and suggest they check with their team or the docs, ',
    'rather than guessing or inventing feature details that aren\'t in the ',
    'guide. Keep answers short and practical — a few sentences or a short ',
    'numbered list, not a essay. Refer to buttons/screens by the exact ',
    'names used in the guide (e.g. "Inbox", "Templates", "Sources").\n\n',
    '--- REFERENCE GUIDE START ---\n',
    knowledge || '(reference guide unavailable)',
    '\n--- REFERENCE GUIDE END ---',
  ].join('');
}

/** history: [{ role: 'user' | 'assistant', content: string }, ...] (no system message — this builds its own). */
async function chat(history, { model } = {}) {
  if (!Array.isArray(history) || !history.length) throw new Error('history array is required');
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
  ];
  return aiBot.generateReply(messages, { model, temperature: 0.3, max_tokens: 700 });
}

module.exports = { chat, loadKnowledge };