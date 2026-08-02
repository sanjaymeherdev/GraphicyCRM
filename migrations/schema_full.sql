-- schema_full.sql — complete CRM backend schema, for deploying to a NEW client from scratch.
-- This is 001_init.sql + 002_crmsuite.sql + 003_schedule_insights.sql concatenated in order.
-- Safe to run top-to-bottom on an empty Supabase project. Existing clients should NOT re-run
-- this — apply 001/002/003 individually only for whatever hasn't been run yet.

-- migrations/001_init.sql
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- Every module's service.js reads/writes exactly these tables.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- Auth / profiles (Supabase Auth handles auth.users; this mirrors basic
-- profile info for convenience — auth.js upserts this on /register).
-- ---------------------------------------------------------------------
create table if not exists crm_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Google OAuth tokens — shared by gmail, sheets, docs modules.
-- One row per user (service = 'google').
-- ---------------------------------------------------------------------
create table if not exists crm_oauth_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null default 'google',
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, service)
);

-- ---------------------------------------------------------------------
-- Platform connections — shared by facebook, instagram, threads, linkedin
-- modules. One row per (user, platform, account_id) — a user could
-- theoretically connect multiple Pages/accounts per platform.
-- ---------------------------------------------------------------------
create table if not exists crm_connections (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','threads','linkedin')),
  account_name text,
  account_id text not null,
  page_id text,
  access_token_enc text not null,
  is_connected boolean not null default true,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, account_id)
);

-- ---------------------------------------------------------------------
-- WhatsApp accounts — modules/whatsapp
-- ---------------------------------------------------------------------
create table if not exists crm_wa_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null,
  phone_number text,
  display_name text,
  access_token_enc text not null,
  quality_rating text default 'UNKNOWN',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Webhook audit log — every /webhook POST any channel module receives,
-- valid or signature-rejected, so delivery issues (missed events, bad
-- signatures, unexpected payload shapes) can be diagnosed after the fact
-- instead of only via console output. No RLS — only ever written/read by
-- the service-role client, never exposed to end users. Ported from the
-- original repo's wb_webhook_logs, generalized from WhatsApp-only to all
-- four channel modules (whatsapp/facebook/instagram/threads).
-- ---------------------------------------------------------------------
create table if not exists crm_webhook_logs (
  id uuid primary key default uuid_generate_v4(),
  channel text not null check (channel in ('whatsapp','facebook','instagram','threads')),
  account_id text,             -- waba_id / Page id / IG account id / Threads account id, whichever the payload carries
  object_type text,            -- payload.object, e.g. 'whatsapp_business_account' | 'page' | 'instagram'
  fields text[] default '{}',  -- distinct change.field values seen in this delivery
  signature_valid boolean not null default true,
  reject_reason text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_crm_webhook_logs_created_at on crm_webhook_logs(created_at desc);
create index if not exists idx_crm_webhook_logs_channel on crm_webhook_logs(channel, created_at desc);

-- ---------------------------------------------------------------------
-- Sheet watchers — modules/sheets automation engine
-- watch_type: 'new_row' | 'date_reminder'
-- ---------------------------------------------------------------------
create table if not exists crm_sheet_watchers (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  spreadsheet_id text not null,
  worksheet text not null,
  watch_type text not null check (watch_type in ('new_row','date_reminder')),
  poll_interval_minutes int not null default 15,
  date_column text,               -- required for date_reminder
  offset_days int default 0,      -- e.g. remind 3 days before the date
  -- Lead-field mapping — which sheet columns identify the lead a matched row
  -- is about. At least one of phone_column/email_column is required for a
  -- match to actually produce a lead (see server.js's watcher onMatch).
  name_column text,
  phone_column text,
  email_column text,
  channel text default 'whatsapp' check (channel in ('whatsapp','facebook','instagram')),
  -- template_id (FK to crm_templates) is added further down via ALTER TABLE,
  -- after crm_templates is created — crm_templates doesn't exist yet at this
  -- point in the file (it's part of 002_crmsuite, below), so an inline FK
  -- here would fail with "relation crm_templates does not exist" on a fresh
  -- empty database run top-to-bottom.
  -- Same shape as campaign placeholder mapping: { "1": {type:'name'}, "2":
  -- {type:'field', field:'Amount'}, ... } — resolved against the matched
  -- row's columns when sending a WhatsApp template.
  placeholder_mapping jsonb not null default '{}',
  message_template text,          -- fallback body (merge tags via {field}) when no template_id, or for non-WhatsApp channels
  fired_log jsonb default '{}',   -- {"<rowIndex>": "<YYYY-M-D fired>"} — de-dupes date_reminder fires
  last_row_count int default 0,
  last_polled_at timestamptz,
  last_error text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table crm_sheet_watchers add column if not exists name_column text;
alter table crm_sheet_watchers add column if not exists phone_column text;
alter table crm_sheet_watchers add column if not exists email_column text;
alter table crm_sheet_watchers add column if not exists channel text default 'whatsapp';
alter table crm_sheet_watchers add column if not exists placeholder_mapping jsonb not null default '{}';

-- ---------------------------------------------------------------------
-- AI bot automation rules — modules/ai-bot
-- action_type: 'ai_reply' | 'template' | 'none'
-- action_config shape (all optional):
--   { ai_prompt, model, template_id,
--     sheet_lookup: { spreadsheetId, worksheet, lookupColumn, returnColumn, matchType },
--     knowledge_doc: { docId } }
-- ---------------------------------------------------------------------
create table if not exists crm_bot_rules (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  keywords text[] not null default '{}',
  match_type text not null default 'contains' check (match_type in ('contains','exact','fuzzy')),
  action_type text not null default 'ai_reply' check (action_type in ('ai_reply','template','none')),
  action_config jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_crm_connections_user_platform on crm_connections(user_id, platform);
create index if not exists idx_crm_wa_accounts_user on crm_wa_accounts(user_id) where is_active;
create index if not exists idx_crm_sheet_watchers_active on crm_sheet_watchers(active) where active;
create index if not exists idx_crm_bot_rules_user_active on crm_bot_rules(user_id) where active;

-- Row Level Security: every table is written through the service-role key
-- (see shared/db.js), so RLS can stay enabled with no policies — access
-- control happens in shared/auth.js's requireAuth + each service.js's
-- `.eq('user_id', userId)` filters, not at the DB layer.
alter table crm_profiles enable row level security;
alter table crm_oauth_tokens enable row level security;
alter table crm_connections enable row level security;
alter table crm_wa_accounts enable row level security;
alter table crm_sheet_watchers enable row level security;
alter table crm_bot_rules enable row level security;

-- ============================================================
-- 002_crmsuite.sql
-- ============================================================

-- migrations/002_crmsuite.sql
-- Adds the CRM-facing layer that CRMSuite's frontend (js/api.js) expects:
-- clients, leads, contacts, unified inbox messages, automations, templates,
-- non-channel integrations, webhook tokens, and per-client settings.
--
-- Run this AFTER 001_init.sql — it references auth.users and reuses the
-- channel/platform tables from 001 (crm_connections, crm_wa_accounts,
-- crm_oauth_tokens) as the thing that actually sends/receives messages;
-- this migration is the CRM data model sitting on top of them.
--
-- Scoped by client_id rather than user_id directly, since CRMSuite is
-- "multi-client" (package.json) — more than one login can belong to the
-- same client/business. A user's own client is found via crm_profiles.client_id.

create extension if not exists "uuid-ossp";

-- Safety net: if 001_init.sql hasn't been run yet, create a minimal
-- crm_profiles here so the ALTER TABLE below doesn't fail. If you do run
-- 001_init.sql (recommended — it also creates crm_connections, crm_wa_accounts,
-- crm_oauth_tokens, crm_bot_rules used by the channel modules), this is skipped.
create table if not exists crm_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Clients — one row per business/tenant using the CRM. Maps to GET /api/client.
-- ---------------------------------------------------------------------
create table if not exists crm_clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  role text not null default 'Client',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every profile belongs to exactly one client (extends crm_profiles from 001).
alter table crm_profiles add column if not exists client_id uuid references crm_clients(id) on delete set null;
alter table crm_profiles add column if not exists role text not null default 'client';

-- ---------------------------------------------------------------------
-- Leads — GET/POST/PUT/DELETE /api/leads
-- ---------------------------------------------------------------------
create table if not exists crm_leads (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  name text,
  phone text,
  email text,
  -- Platform-native sender id for channels with no phone number (Facebook
  -- PSID, Instagram IGSID, Threads user id) — WhatsApp leads are still
  -- deduped on `phone` directly; this is only populated/queried for the
  -- other three.
  external_id text,
  source text not null default 'other' check (source in ('whatsapp','instagram','facebook','threads','webform','email','sheet','other')),
  status text not null default 'new' check (status in ('new','contacted','engaged','converted','lost')),
  notes text,
  needs_reply boolean not null default false,
  last_message text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table crm_leads add column if not exists external_id text;
create index if not exists crm_leads_client_source_external_id_idx on crm_leads(client_id, source, external_id) where external_id is not null;
do $$ begin
  alter table crm_leads drop constraint if exists crm_leads_source_check;
  alter table crm_leads add constraint crm_leads_source_check check (source in ('whatsapp','instagram','facebook','threads','webform','email','sheet','other'));
exception when others then null; end $$;

-- ---------------------------------------------------------------------
-- Contacts — GET/POST /api/contacts (converted/qualified leads, or people
-- added directly without going through the lead pipeline)
-- ---------------------------------------------------------------------
create table if not exists crm_contacts (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  lead_id uuid references crm_leads(id) on delete set null,
  name text,
  phone text,
  email text,
  source text not null default 'other' check (source in ('whatsapp','instagram','facebook','threads','webform','email','sheet','other')),
  status text not null default 'new' check (status in ('new','contacted','engaged','converted','lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Messages — unified inbox backing GET /api/inbox and
-- GET/POST /api/leads/:id/messages. One row per inbound or outbound message,
-- regardless of which module (whatsapp/facebook/instagram/threads/gmail)
-- actually carried it.
-- ---------------------------------------------------------------------
create table if not exists crm_messages (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  lead_id uuid references crm_leads(id) on delete cascade,
  contact_id uuid references crm_contacts(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','instagram','facebook','threads','gmail','webform')),
  direction text not null check (direction in ('in','out')),
  message_type text not null default 'text' check (message_type in ('text','image','video','audio','document','sticker','location','button','list','cta_url','interactive','template','unknown')),
  body text not null default '',           -- rendered preview text (e.g. "📷 Image" for media, caption if present)
  external_id text,                        -- provider's message id (wamid, Graph message id, Gmail message id...)
  is_read boolean not null default false,  -- unread badge for inbound; app sets true explicitly when inserting outbound rows (they're inherently "read" by the business)
  status text check (status in ('queued','sent','delivered','read','failed')),  -- outbound delivery tracking; null for inbound
  error_reason text,                       -- populated when status = 'failed'
  sent_by uuid references auth.users(id),  -- set for direction='out' when a human sent it (null = automation/AI)
  created_at timestamptz not null default now(),
  check (lead_id is not null or contact_id is not null)
);

-- Keep crm_leads.last_message / last_message_at / needs_reply in sync so
-- listing leads/inbox doesn't require aggregating crm_messages every request.
create or replace function crm_touch_lead_on_message() returns trigger as $$
begin
  if new.lead_id is not null then
    update crm_leads set
      last_message = new.body,
      last_message_at = new.created_at,
      needs_reply = (new.direction = 'in'),
      updated_at = now()
    where id = new.lead_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_lead_on_message on crm_messages;
create trigger trg_touch_lead_on_message
  after insert on crm_messages
  for each row execute function crm_touch_lead_on_message();

-- ---------------------------------------------------------------------
-- Templates — GET/POST/PUT/DELETE /api/templates
-- Distinct from modules/whatsapp's approved Meta templates: these are
-- reusable reply snippets usable across any channel (and can reference a
-- Meta template by name for WhatsApp sends via meta_template_name).
-- ---------------------------------------------------------------------
create table if not exists crm_templates (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  name text not null,
  type text not null default 'plaintext' check (type in ('plaintext','whatsapp_template')),
  body text not null default '',
  footer text,
  meta_template_name text,   -- set when type = 'whatsapp_template'
  -- Meta WhatsApp template management (modules/templates 'meta/*' routes) —
  -- irrelevant for type='plaintext' rows, all null/default there.
  category text default 'MARKETING' check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  language text default 'en_US',
  status text not null default 'local' check (status in ('local','PENDING','APPROVED','REJECTED')),
  header_type text default 'NONE',
  header_text text,
  header_media_url text,
  buttons jsonb not null default '[]',
  placeholders jsonb not null default '[]',
  meta_template_id text,     -- Meta's own template id, once submitted — used to match on re-sync
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Additive columns for databases that already ran this table's original
-- (narrower) definition — safe to re-run, no-ops once applied.
alter table crm_templates add column if not exists category text default 'MARKETING';
alter table crm_templates add column if not exists language text default 'en_US';
alter table crm_templates add column if not exists status text not null default 'local';
alter table crm_templates add column if not exists header_type text default 'NONE';
alter table crm_templates add column if not exists header_text text;
alter table crm_templates add column if not exists header_media_url text;
alter table crm_templates add column if not exists buttons jsonb not null default '[]';
alter table crm_templates add column if not exists placeholders jsonb not null default '[]';
alter table crm_templates add column if not exists meta_template_id text;
do $$ begin
  alter table crm_templates add constraint crm_templates_status_check check (status in ('local','PENDING','APPROVED','REJECTED'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table crm_templates add constraint crm_templates_category_check check (category in ('MARKETING','UTILITY','AUTHENTICATION'));
exception when duplicate_object then null; end $$;

-- Deferred from crm_sheet_watchers' definition above (001_init section) —
-- crm_templates has to exist first, which it now does.
alter table crm_sheet_watchers add column if not exists template_id uuid references crm_templates(id) on delete set null;

-- ---------------------------------------------------------------------
-- Automations — GET/POST/PUT/DELETE /api/automations
-- Superset of crm_bot_rules (001) shaped to match the frontend's exact
-- fields (name, ai_fallback, conditions, else_template_id, follow_up).
-- The ai-bot module's matchRule() logic (keywords/match_type/sheet_lookup/
-- knowledge_doc) still applies — action_config on crm_bot_rules maps onto
-- ai_prompt/conditions here; keep both tables and have the CRM layer read
-- from crm_automations, converting to the ai-bot rule shape when needed.
-- ---------------------------------------------------------------------
create table if not exists crm_automations (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  name text not null default 'Untitled automation',
  keywords text[] not null default '{}',
  match_type text not null default 'contains' check (match_type in ('contains','exact','fuzzy')),
  action_type text not null default 'template' check (action_type in ('template','ai_reply','none')),
  template_id uuid references crm_templates(id) on delete set null,
  ai_prompt text,
  ai_fallback text,
  conditions jsonb not null default '[]',        -- e.g. [{ field:'source', op:'eq', value:'whatsapp' }]
  else_template_id uuid references crm_templates(id) on delete set null,
  follow_up jsonb not null default '{"enabled":false,"hours":4,"condition":"no_reply","template_id":null}',
  -- { sheet_lookup: { spreadsheetId, worksheet, lookupColumn, returnColumn, matchType },
  --   knowledge_doc: { docId, docName } } — see modules/ai-bot/service.js's
  -- performSheetLookup/getGroundingDocContent, reused (not duplicated) by
  -- modules/automations/service.js's matchRule.
  action_config jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table crm_automations add column if not exists action_config jsonb not null default '{}';

-- Pending follow-ups scheduled by an automation's follow_up config —
-- a worker polls this table (due_at <= now(), fired = false) and sends
-- follow_up.template_id's content if the follow_up.condition still holds
-- (e.g. 'no_reply' means the lead hasn't replied since).
create table if not exists crm_followups (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  lead_id uuid not null references crm_leads(id) on delete cascade,
  automation_id uuid not null references crm_automations(id) on delete cascade,
  condition text not null default 'no_reply',
  due_at timestamptz not null,
  fired boolean not null default false,
  fired_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Non-channel integrations — GET /api/integrations, POST /api/integrations/:id/connect
-- (Calendly, Manychat, Resend, Webhook Builder, Shopify, Slack — distinct
-- from crm_connections in 001, which is for the messaging channels).
-- ---------------------------------------------------------------------
create table if not exists crm_integrations (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  integration_id text not null check (integration_id in ('calendly','manychat','resend','webhook_builder','shopify','slack')),
  status text not null default 'disconnected' check (status in ('connected','disconnected')),
  config jsonb not null default '{}',   -- API keys / webhook secrets, store encrypted at the app layer if sensitive
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, integration_id)
);

-- ---------------------------------------------------------------------
-- Webhook tokens — POST /api/webhook/generate (one inbound webhook URL per
-- client for generic/custom integrations, e.g. a webform or Zapier).
-- ---------------------------------------------------------------------
create table if not exists crm_webhook_tokens (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade unique,
  token text not null unique,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Settings — /api/settings (per-client AI + notification preferences)
-- ---------------------------------------------------------------------
create table if not exists crm_settings (
  client_id uuid primary key references crm_clients(id) on delete cascade,
  ai_model text not null default 'mistralai/mistral-small-4-119b-2603',
  system_prompt text not null default 'You are a helpful CRM assistant.',
  channels text[] not null default '{}',
  notifications jsonb not null default '{"email":true,"push":false,"weekly":true}',
  updated_at timestamptz not null default now()
);

-- Indexes for the frontend's common queries (list leads/contacts by client,
-- inbox ordered by recency, message history per lead).
create index if not exists idx_crm_leads_client on crm_leads(client_id, updated_at desc);
create index if not exists idx_crm_leads_needs_reply on crm_leads(client_id) where needs_reply;
create index if not exists idx_crm_contacts_client on crm_contacts(client_id, updated_at desc);
create index if not exists idx_crm_messages_lead on crm_messages(lead_id, created_at);
create index if not exists idx_crm_messages_contact on crm_messages(contact_id, created_at);
create index if not exists idx_crm_messages_unread on crm_messages(lead_id) where direction = 'in' and not is_read;
create index if not exists idx_crm_templates_client on crm_templates(client_id);
create index if not exists idx_crm_automations_client_active on crm_automations(client_id) where active;
create index if not exists idx_crm_followups_due on crm_followups(due_at) where not fired;
create index if not exists idx_crm_integrations_client on crm_integrations(client_id);

-- RLS: same model as 001 — service-role key bypasses RLS; access control
-- happens in the app layer via requireAuth + client_id scoping.
alter table crm_clients enable row level security;
alter table crm_leads enable row level security;
alter table crm_contacts enable row level security;
alter table crm_messages enable row level security;
alter table crm_templates enable row level security;
alter table crm_automations enable row level security;
alter table crm_followups enable row level security;
alter table crm_integrations enable row level security;
alter table crm_webhook_tokens enable row level security;
alter table crm_settings enable row level security;

-- ============================================================
-- 003_schedule_insights.sql
-- ============================================================

-- migrations/003_schedule_insights.sql
-- NEW tables only — adds a post-scheduling queue and an insights cache on
-- top of 001_init.sql + 002_crmsuite.sql (both already applied). Ported
-- from the original repo's sm/scheduler.js (smc_posts) and
-- sm/routes/insights.js (account/post-level Graph insights), adapted to
-- this project's client_id-scoped model.
--
-- Insights are cached rather than fetched live on every dashboard load —
-- Graph's /insights edge is rate-limited and only returns a short trailing
-- window for most metrics, so a periodic snapshot is what makes a real
-- trend chart possible.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- Scheduled posts — one row per post, published to one or more platforms.
-- A background worker (same shape as the original repo's scheduler.js)
-- polls status='scheduled' AND scheduled_date <= now() every minute and
-- publishes via modules/{facebook,instagram,threads}/service.js.
-- ---------------------------------------------------------------------
create table if not exists crm_scheduled_posts (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  created_by uuid references auth.users(id),
  title text,                          -- internal label only, never sent to any platform
  caption text not null default '',
  hook text,                           -- optional opening line/hook, kept separate for A/B swapping before publish
  platforms text[] not null default '{}' check (platforms <@ array['facebook','instagram','threads','linkedin']),
  media_url text,                      -- LinkedIn is text-only (see modules/linkedin note below) — ignored for that platform
  google_drive_file_id text,           -- optional source asset in Drive (modules/docs' shared Google token covers Drive scope too)
  scheduled_date timestamptz,          -- null = draft, not yet scheduled
  status text not null default 'draft' check (status in ('draft','scheduled','published','partial','failed')),
  published_ids jsonb not null default '{}',    -- { "facebook": "12345_67890", "instagram": "179..." }
  publish_errors jsonb not null default '{}',   -- { "linkedin": "Duplicate post" }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_scheduled_posts_due on crm_scheduled_posts(scheduled_date) where status = 'scheduled';
create index if not exists idx_crm_scheduled_posts_client on crm_scheduled_posts(client_id, scheduled_date desc);

-- ---------------------------------------------------------------------
-- Account-level insights snapshots — one row per (client, platform) per
-- poll tick, so the dashboard can chart followers/views/likes over time
-- instead of only ever showing Graph's current-moment numbers.
-- ---------------------------------------------------------------------
create table if not exists crm_insights_snapshots (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','threads')),
  account_id text not null,
  followers int,
  metrics jsonb not null default '{}',   -- everything else from toMetricsMap(): views, likes, replies, reposts, quotes, impressions, reach...
  captured_at timestamptz not null default now()
);

create index if not exists idx_crm_insights_snapshots_lookup on crm_insights_snapshots(client_id, platform, captured_at desc);

-- ---------------------------------------------------------------------
-- Per-post insights cache — mirrors GET /api/insights/posts's shape
-- (id, caption, thumbnail, likes, comments, shares, saves, reach, plus
-- Threads' replies/reposts/quotes), refreshed on a poll rather than fetched
-- live on every dashboard open.
-- ---------------------------------------------------------------------
create table if not exists crm_post_insights (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references crm_clients(id) on delete cascade,
  scheduled_post_id uuid references crm_scheduled_posts(id) on delete set null,  -- null if the post was published outside this CRM (organic/imported)
  platform text not null check (platform in ('facebook','instagram','threads')),
  external_post_id text not null,      -- Graph/Threads media or post id
  caption text,
  thumbnail text,
  permalink text,
  posted_at timestamptz,
  likes int not null default 0,
  comments int not null default 0,
  shares int not null default 0,
  saves int not null default 0,
  reach int not null default 0,
  views int not null default 0,
  replies int not null default 0,      -- Threads
  reposts int not null default 0,      -- Threads
  quotes int not null default 0,       -- Threads
  captured_at timestamptz not null default now(),
  unique (client_id, platform, external_post_id)
);

create index if not exists idx_crm_post_insights_client on crm_post_insights(client_id, platform, posted_at desc);

alter table crm_scheduled_posts enable row level security;
alter table crm_insights_snapshots enable row level security;
alter table crm_post_insights enable row level security;