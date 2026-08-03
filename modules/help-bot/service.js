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
const MODULES_DIR = path.join(__dirname, '..');

// Whitelist of taggable modules — every folder under modules/ that exposes a
// routes.js + service.js pair. Built once at startup by scanning the
// filesystem (falls back to [] if it can't read the dir, e.g. in some
// packaged deployments), NOT from user input, so a chat request can only
// ever reference a module that actually exists on disk.
function discoverModules() {
  try {
    return fs.readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => fs.existsSync(path.join(MODULES_DIR, name, 'routes.js')))
      .sort();
  } catch (err) {
    console.error('[help-bot] failed to list modules dir:', err.message);
    return [];
  }
}

const AVAILABLE_MODULES = discoverModules();

function listModules() {
  return AVAILABLE_MODULES;
}

/** Read a tagged module's routes.js/service.js off disk for grounding. Only
 * ever reads from the whitelist built by discoverModules() above — the
 * module name coming from the request body is checked against that list,
 * never used to build a path directly, so this can't be used to read
 * arbitrary files. */
function getModuleSource(moduleName) {
  if (!AVAILABLE_MODULES.includes(moduleName)) return null;
  const dir = path.join(MODULES_DIR, moduleName);
  const files = {};
  for (const file of ['routes.js', 'service.js']) {
    const p = path.join(dir, file);
    try {
      files[file] = fs.readFileSync(p, 'utf8');
    } catch (err) {
      // service.js is optional for a couple of modules; routes.js always exists per discoverModules()
    }
  }
  return files;
}

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

function buildSystemPrompt(moduleTag) {
  const knowledge = loadKnowledge();
  const base = [
    'You are the in-app Help Assistant for GraphicyCRM, a CRM that unifies ',
    'WhatsApp/Instagram/Facebook/Threads/Gmail messaging into one inbox.',
    'Answer the user\'s question about how to use the product, using ONLY ',
    'the reference guide below. If the guide doesn\'t cover something, say ',
    'you\'re not sure and suggest they check with their team or the docs, ',
    'rather than guessing or inventing feature details that aren\'t in the ',
    'guide. Keep answers short and practical — a few sentences or a short ',
    'numbered list, not a essay. Refer to buttons/screens by the exact ',
    'names used in the guide (e.g. "Inbox", "Templates", "Sources"). ',
    'Answer in plain text only — never use code blocks here.\n\n',
    '--- REFERENCE GUIDE START ---\n',
    knowledge || '(reference guide unavailable)',
    '\n--- REFERENCE GUIDE END ---',
  ];

  if (!moduleTag) return base.join('');

  const source = getModuleSource(moduleTag);
  if (!source) return base.join('');

  base.push(
    '\n\n--- TAGGED MODULE SOURCE START (modules/', moduleTag, ') ---\n',
    'The user has tagged this specific backend module because their question ',
    'or problem relates to it. You may now also act as a developer aide for ',
    'this module: explain what its code does and help diagnose a bug they ',
    'describe.\n',
    'IMPORTANT — do not paste, quote, or reproduce the module\'s source code ',
    'in your explanation. Describe what it does and where the problem likely ',
    'is in plain English (function/route names are fine to mention, e.g. ',
    '"the POST /chat handler in routes.js"). The user only sees your ',
    'explanation, never the file contents you were given below.\n',
    'If — and only if — a code change would fix the problem, provide it as ',
    'a unified diff (git patch format: "--- a/modules/', moduleTag, '/<file>" / ',
    '"+++ b/modules/', moduleTag, '/<file>" headers, @@ hunks, real file paths) ',
    'inside a single fenced ```diff code block, so the user can save it and ',
    'apply it with `git apply` or `patch -p1`. This diff is the ONLY code ',
    'block allowed in your reply — do not add any other ```code fences. ',
    'Keep the diff minimal — only the lines that actually change. Only ',
    'reference code that appears below; don\'t invent functions or files ',
    'that aren\'t shown. If no fix is needed yet (e.g. you need more info, ',
    'or it\'s just an explanation), don\'t include a diff at all.\n\n',
    'routes.js:\n```javascript\n', source['routes.js'] || '(not found)', '\n```\n',
    source['service.js'] ? ['service.js:\n```javascript\n', source['service.js'], '\n```\n'].join('') : '',
    '--- TAGGED MODULE SOURCE END (reference only — never quote this back) ---',
  );
  return base.join('');
}

/**
 * history: [{ role: 'user' | 'assistant', content: string }, ...] (no system message — this builds its own).
 * moduleTag: optional module folder name (e.g. "leads") — when set, the
 * module's routes.js/service.js are attached as extra grounding so the bot
 * can explain that module's code and suggest a fix.patch for it.
 */
async function chat(history, { model, module: moduleTag } = {}) {
  if (!Array.isArray(history) || !history.length) throw new Error('history array is required');
  if (moduleTag && !AVAILABLE_MODULES.includes(moduleTag)) {
    throw new Error(`Unknown module "${moduleTag}". Available: ${AVAILABLE_MODULES.join(', ')}`);
  }
  const messages = [
    { role: 'system', content: buildSystemPrompt(moduleTag) },
    ...history.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
  ];
  // Module-tagged questions get more headroom (source code + patch output eat tokens fast).
  return aiBot.generateReply(messages, { model, temperature: 0.3, max_tokens: moduleTag ? 1800 : 700 });
}

module.exports = { chat, loadKnowledge, listModules };