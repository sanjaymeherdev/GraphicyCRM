-- migrations/009_ported_modules.sql
-- Tables for the 7 modules ported from sanjaymeherdev/MetaWhatsappAPI
-- (src/routes/flows.js, src/interactive-templates.js,
-- src/workers/followup-worker.js, src/routes/field-mappings.js,
-- src/routes/bot-builder.js + bot-engine.js, src/routes/meetings.js,
-- src/routes/billing.js, src/api-keys.js). Ecom was explicitly excluded.
-- All client-scoped tables follow the same client_id + RLS-via-app-layer
-- pattern as the rest of schema_full.sql (access is enforced by
-- requireClient in each module's routes.js, not Postgres RLS).

-- ---------------------------------------------------------------------
-- modules/flows — visual multi-step automation builder. Each flow is a
-- JSON graph of steps (message/condition/delay/action nodes); richer than
-- modules/automations' single keyword->reply matching.
-- ---------------------------------------------------------------------
create table if not exists crm_flows (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  name text not null,
  trigger_type text not null default 'keyword' check (trigger_type in ('keyword','event','manual')),
  trigger_value text,                  -- keyword/phrase, or event name (e.g. 'lead_created')
  channels text[] not null default '{}',
  steps jsonb not null default '[]',   -- [{ id, type: 'message'|'condition'|'delay'|'action', ... }]
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_crm_flows_client on crm_flows(client_id);

-- ---------------------------------------------------------------------
-- modules/interactive-templates — WhatsApp interactive message templates
-- (button / list / cta_url), distinct from modules/templates' plain text
-- templates. `config` mirrors Meta's WhatsApp Cloud API interactive object.
-- ---------------------------------------------------------------------
create table if not exists crm_interactive_templates (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  name text not null,
  interactive_type text not null default 'button' check (interactive_type in ('button','list','cta_url')),
  config jsonb not null default '{}',  -- body/header/footer/action per Meta's interactive message schema
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_crm_interactive_templates_client on crm_interactive_templates(client_id);

-- ---------------------------------------------------------------------
-- modules/followup — re-engages leads that have gone quiet. A rule fires
-- once per lead per rule (tracked in crm_followup_log) after
-- inactivity_hours of no inbound message.
-- ---------------------------------------------------------------------
create table if not exists crm_followup_rules (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('whatsapp','facebook','instagram','threads','gmail')),
  inactivity_hours integer not null default 24,
  message text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists crm_followup_log (
  id uuid primary key default uuid_generate_v4(),
  rule_id uuid not null references crm_followup_rules(id) on delete cascade,
  lead_id uuid not null references crm_leads(id) on delete cascade,
  sent_at timestamptz not null default now(),
  unique (rule_id, lead_id)             -- one follow-up per rule per lead, ever
);
create index if not exists idx_crm_followup_rules_client on crm_followup_rules(client_id);

-- ---------------------------------------------------------------------
-- modules/field-mappings — maps incoming webform/sheet column names to
-- crm_leads fields + merge tags, so modules/sheets' watcher and any future
-- webform intake don't assume fixed column names.
-- ---------------------------------------------------------------------
create table if not exists crm_field_mappings (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  channel text not null check (channel in ('webform','sheet')),
  source_field text not null,          -- incoming column/field name, e.g. "Full Name"
  target_field text not null,          -- crm_leads column, e.g. "name"
  created_at timestamptz not null default now(),
  unique (client_id, channel, source_field)
);

-- ---------------------------------------------------------------------
-- modules/bot-builder — deterministic rule-based conversational bot,
-- checked before the AI auto-reply falls through (see modules/ai-bot).
-- Distinct from modules/flows: a rule is single-step (match -> one
-- reply/action), not a multi-step graph.
-- ---------------------------------------------------------------------
create table if not exists crm_bot_rules (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  name text not null,
  match_type text not null default 'contains' check (match_type in ('contains','exact','starts_with','regex')),
  match_value text not null,
  channels text[] not null default '{}',
  reply_type text not null default 'text' check (reply_type in ('text','interactive_template')),
  reply_text text,
  interactive_template_id uuid references crm_interactive_templates(id) on delete set null,
  priority integer not null default 0, -- higher priority checked first
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_crm_bot_rules_client on crm_bot_rules(client_id);

-- ---------------------------------------------------------------------
-- modules/meetings — booking list + public webhook receiver for external
-- booking tools (e.g. smbooking), attached to a lead when the booker's
-- email/phone matches an existing lead. Auth for the public receiver
-- reuses modules/webhook's existing crm_webhook_tokens (per-client token
-- in the URL), same as the lead-intake webhook — no separate secret table.
-- ---------------------------------------------------------------------
create table if not exists crm_meetings (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  lead_id uuid references crm_leads(id) on delete set null,
  title text not null,
  attendee_name text,
  attendee_email text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),
  external_id text,                    -- id from the booking provider, for idempotent webhook replays
  created_at timestamptz not null default now()
);
create index if not exists idx_crm_meetings_client on crm_meetings(client_id);
create unique index if not exists idx_crm_meetings_external on crm_meetings(client_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------------
-- modules/billing — CRM subscription status + checkout kickoff. Order
-- creation is stubbed per-provider (see modules/billing/service.js) —
-- the shape is real, the payment SDK call is a TODO until a provider is
-- chosen, matching the reference repo's approach.
-- ---------------------------------------------------------------------
create table if not exists crm_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade unique,
  plan text not null default 'free' check (plan in ('free','starter','pro','enterprise')),
  status text not null default 'active' check (status in ('active','past_due','cancelled')),
  provider text,                       -- 'razorpay' | 'stripe' | 'paypal', null until checkout completes
  provider_ref text,                   -- provider's subscription/order id
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- modules/api-keys — lets external scripts/tools call this CRM's API with
-- a key instead of a user login. Key itself is never stored — only its
-- SHA-256 hash, checked in shared/apiKeyAuth.js.
-- ---------------------------------------------------------------------
create table if not exists crm_api_keys (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  created_by uuid references auth.users(id),
  name text not null,
  key_prefix text not null,            -- first 8 chars shown in the UI so the user can tell keys apart
  key_hash text not null,              -- sha256(full key), hex
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_crm_api_keys_client on crm_api_keys(client_id);
create unique index if not exists idx_crm_api_keys_hash on crm_api_keys(key_hash);
