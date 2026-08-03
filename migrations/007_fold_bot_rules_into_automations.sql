-- migrations/007_fold_bot_rules_into_automations.sql
-- Folds crm_bot_rules (001_init.sql) into crm_automations (002_crmsuite.sql)
-- so there is a single rule table/engine for "what happens when a message
-- comes in", instead of two:
--
--   * crm_automations — matched by modules/automations/service.js#matchRule,
--     which every channel webhook handler (whatsapp/facebook/instagram/
--     threads) actually calls on inbound messages.
--   * crm_bot_rules — matched by modules/ai-bot/service.js's own matchRule,
--     reachable only via POST /api/ai-bot/match and the Chatbot tab's rule
--     CRUD. No webhook handler ever called it, so a rule saved in the
--     Chatbot tab never fired on a real inbound message.
--
-- modules/ai-bot/routes.js no longer talks to crm_bot_rules at all — its
-- rule CRUD/match endpoints now delegate to modules/automations/service.js
-- (see that file). This migration carries over any rules that were only
-- ever saved through the old crm_bot_rules-backed endpoints, mapped from
-- user_id to that user's client_id (crm_bot_rules had no client concept),
-- then drops the now-unused table.
--
-- Safe to re-run: the insert is keyed off crm_bot_rules rows that still
-- exist, and `drop table if exists` is a no-op the second time.
insert into crm_automations (
  client_id, name, keywords, match_type, action_type,
  template_id, ai_prompt, action_config, active, created_at, updated_at
)
select
  p.client_id,
  coalesce(b.name, 'Untitled automation'),
  b.keywords,
  b.match_type,
  b.action_type,
  nullif(b.action_config->>'template_id', '')::uuid,
  b.action_config->>'ai_prompt',
  (b.action_config - 'template_id' - 'ai_prompt'),  -- keep model / sheet_lookup / knowledge_doc
  b.active,
  b.created_at,
  b.updated_at
from crm_bot_rules b
join crm_profiles p on p.id = b.user_id
where p.client_id is not null;

drop table if exists crm_bot_rules;
