-- migrations/004_google_account_email.sql
-- Run this on an EXISTING database that already has crm_oauth_tokens
-- (i.e. you ran 001_init.sql / schema_full.sql before this migration existed).
--
-- Adds the connected Google account's email to crm_oauth_tokens so the
-- Profile tab's "Connected accounts" list can show *which* Google account
-- (gmail/sheets/docs/drive) is connected, not just that "Google" is
-- connected. Populated going forward by shared/googleAuth.js on
-- connect/reconnect; existing rows will show a generic "Google account"
-- label until the user reconnects once.

alter table crm_oauth_tokens add column if not exists account_email text;
