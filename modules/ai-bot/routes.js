// modules/ai-bot/routes.js
const express = require('express');
const { requireAuth } = require('../../shared/auth');
const { requireClient } = require('../../shared/clientContext');
const service = require('./service');
const automations = require('../automations/service');

const router = express.Router();
router.use(requireAuth, requireClient);

router.get('/models', (req, res) => res.json({ success: true, ...service.getAvailableModels() }));

router.post('/chat', async (req, res) => {
  const { messages, model, temperature, max_tokens } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages array required' });
  try { res.json(await service.generateReply(messages, { model, temperature, max_tokens })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// --------------------------------------------------------------------
// Rule matching + rule CRUD, for the Chatbot tab.
//
// This used to run against `crm_bot_rules`, a second keyword-matching
// engine with its own matchRule() that nothing in the live inbound webhook
// path (modules/whatsapp|facebook|instagram|threads' handleInboundEvent)
// ever called. Only modules/automations' `crm_automations` rules fired on
// real messages, so saving a rule here silently did nothing outside of
// this /match endpoint and the Test Chat panel.
//
// There is now exactly one rule table (crm_automations) and one matcher
// (modules/automations/service.js#matchRule), which the channel webhook
// handlers already call. The Chatbot tab is just a second UI over the same
// rows — saving a rule here IS saving an automation, so it's live on the
// next inbound message through any channel. The two helpers below only
// translate between crm_automations' column shape and the shape the
// existing Chatbot UI (public/js/modules/chatbot.js) already sends/expects
// (action_config.{ai_prompt,model,template_id} instead of top-level
// ai_prompt/template_id columns), so the frontend needed no changes.
//
// crm_bot_rules is deprecated — see
// migrations/007_fold_bot_rules_into_automations.sql.
// --------------------------------------------------------------------
function toBotRuleShape(row) {
  if (!row) return row;
  const { ai_prompt, template_id, action_config, ...rest } = row;
  return { ...rest, action_config: { ...(action_config || {}), ai_prompt, template_id } };
}
function fromBotRuleShape(body) {
  const { action_config, ...rest } = body || {};
  const { ai_prompt, template_id, ...restConfig } = action_config || {};
  return { ...rest, ai_prompt, template_id, action_config: restConfig };
}

// Runs the rule-matching engine directly — useful for testing a rule
// before it fires for real (same engine the Automation tab's "test" uses).
router.post('/match', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const match = await automations.matchRule(req.clientId, { text });
    res.json({ success: true, match: match ? { ...match, rule: toBotRuleShape(match.rule) } : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/rules', async (req, res) => {
  try {
    const rules = await automations.listAutomations(req.clientId);
    res.json({ success: true, rules: rules.map(toBotRuleShape) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/rules', async (req, res) => {
  try {
    const rule = await automations.createAutomation(req.clientId, fromBotRuleShape(req.body));
    res.json({ success: true, rule: toBotRuleShape(rule) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.put('/rules/:id', async (req, res) => {
  try {
    const rule = await automations.updateAutomation(req.clientId, req.params.id, fromBotRuleShape(req.body));
    res.json({ success: true, rule: toBotRuleShape(rule) });
  } catch (err) { res.status(err.message === 'Automation not found' ? 404 : 400).json({ error: err.message }); }
});
router.delete('/rules/:id', async (req, res) => {
  try { await automations.deleteAutomation(req.clientId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
