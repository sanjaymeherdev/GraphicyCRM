-- migrations/012_crm_edu_config.sql
--
-- Backs modules/education's per-client Google Sheet connection (see that
-- module's service.js header comment). One school/institute (crm_clients
-- row) connects exactly one Apps Script Web App deployment, the same
-- "paste this script -> deploy -> paste back the /exec URL + secret"
-- pattern as modules/mail-capture, except scoped to client_id (one shared
-- sheet per school account) instead of user_id (one per individual login) —
-- education data belongs to the institute, not to whichever staff member
-- happened to set up the connection.
--
-- The secret is generated server-side (service.generateSecret()), embedded
-- into the Apps Script template the admin pastes in (appsScript.js), and
-- stored here encrypted at rest; every proxied request to the script
-- resends it so the script can reject calls that don't match (see
-- appsScript.js's handleRequest: `if (params.key !== SECRET_KEY)`).
create table if not exists crm_edu_config (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null unique references crm_clients(id) on delete cascade,
  script_url text not null,       -- the deployed Apps Script /exec URL
  secret_key_enc text not null,   -- AES-256-GCM via shared/crypto.js — never sent back to the frontend as plaintext
  school_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table crm_edu_config enable row level security;

-- No end user ever queries this table directly — every module route goes
-- through shared/db.js's service-role client (see that file's header
-- comment), so no permissive policies are added here; RLS with zero
-- policies just denies anon/auth-key access outright, same as every other
-- table in this schema.

comment on table crm_edu_config is 'Per-client Apps Script Web App connection (Google Sheet backend) for modules/education — one per school/institute account.';
