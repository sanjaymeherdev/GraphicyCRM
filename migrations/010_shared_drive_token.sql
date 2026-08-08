-- migrations/010_shared_drive_token.sql
--
-- Single-row shared-owner-Drive token store, ported from
-- sanjayaidev/MetaWhatsappAPI's smc_shared_tokens (see sm/lib/ownerDriveToken.js
-- and migrations/008_smc_shared_drive_token.sql in that repo).
--
-- Why this exists: modules/media/routes.js's upload/stream endpoints were
-- disabled because per-user Google OAuth in this app only requests the
-- approved scope list (see shared/googleAuth.js's GOOGLE_SCOPES comment) —
-- `drive`/`drive.file` isn't in it, and adding it would require
-- re-verification. The shared-owner-Drive pattern sidesteps that: ONE
-- Google account (the operator's own Drive), connected once via a separate
-- admin-only OAuth flow that requests ONLY drive.file (see
-- modules/admin-drive/routes.js), backs media storage for every client's
-- scheduled posts. No end user ever OAuths into Drive themselves.
--
-- There is intentionally no client_id/user_id column — this is
-- operator-level infrastructure, one row, shared by every client's
-- scheduled-post media uploads.
create extension if not exists "uuid-ossp";

create table if not exists crm_shared_tokens (
  id uuid primary key default uuid_generate_v4(),
  service text unique not null,  -- e.g. 'google_drive_owner'
  refresh_token_enc text not null,
  access_token_enc text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table crm_shared_tokens enable row level security;

-- No end-user ever touches this table (only the service-role client, via
-- the admin-secret-gated /api/admin/drive routes), so no permissive
-- policies are added — RLS with zero policies denies all access under the
-- anon/auth keys, which is what we want. The app's Supabase client uses the
-- service-role key anyway (see shared/db.js) so this doesn't block it.

comment on table crm_shared_tokens is 'Single-row shared credential store (currently: owner Google Drive for scheduled-post media), managed manually via /admin/drive';
