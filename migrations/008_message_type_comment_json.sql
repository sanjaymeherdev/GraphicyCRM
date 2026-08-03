-- migrations/008_message_type_comment_json.sql
-- Fixes: "new row for relation crm_messages violates check constraint
-- crm_messages_message_type_check" whenever a comment (Instagram/Facebook/
-- Threads) or a JSON-payload automation reply (Instagram/Facebook/WhatsApp)
-- is recorded.
--
-- crm_messages.message_type (schema_full.sql) only ever allowed:
--   text, image, video, audio, document, sticker, location, button, list,
--   cta_url, interactive, template, unknown
--
-- but shared/crmMessages.js#recordMessage has always been called with two
-- values that were never added to that list:
--   - 'comment'  — modules/instagram, modules/facebook, modules/threads
--                  service.js's handleCommentEvent()/handleWebhookEvent(),
--                  for inbound comments and comment replies. The frontend
--                  (public/js/modules/inbox.js) already keys off
--                  message_type === 'comment' to show a "Comment" badge and
--                  pick reply-mode options, so this is a real, used
--                  distinction, not dead code — the fix is to widen the
--                  constraint, not to rewrite those call sites to 'text'.
--   - 'json'     — modules/instagram, modules/facebook, modules/whatsapp
--                  service.js's tryAutoReply()/sendMessage(), when an
--                  automation rule's reply is a raw JSON payload (e.g. a
--                  WhatsApp interactive/template send helper) rather than
--                  plain text.
--
-- So every inbound comment, and any JSON-payload automation reply, has been
-- failing this constraint since those call sites were written. This
-- migration just catches the constraint up to the values the app already
-- sends.
--
-- Safe to re-run: drops the constraint if present, then re-adds it.
alter table crm_messages drop constraint if exists crm_messages_message_type_check;

alter table crm_messages add constraint crm_messages_message_type_check
  check (message_type in (
    'text','image','video','audio','document','sticker','location','button',
    'list','cta_url','interactive','template','unknown','comment','json'
  ));
