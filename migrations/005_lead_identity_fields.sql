alter table crm_leads add column if not exists whatsapp text;
alter table crm_leads add column if not exists instagram text;
alter table crm_leads add column if not exists facebook text;
alter table crm_leads add column if not exists account_name text;

create index if not exists idx_crm_leads_account_name on crm_leads(client_id, account_name);

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'crm_insights_snapshots') then
    create table crm_insights_snapshots (
      id uuid primary key default uuid_generate_v4(),
      client_id uuid not null references crm_clients(id) on delete cascade,
      platform text not null check (platform in ('facebook','instagram','threads')),
      account_id text not null,
      followers int,
      metrics jsonb not null default '{}',
      captured_at timestamptz not null default now()
    );
  end if;

  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'crm_post_insights') then
    create table crm_post_insights (
      id uuid primary key default uuid_generate_v4(),
      client_id uuid not null references crm_clients(id) on delete cascade,
      scheduled_post_id uuid references crm_scheduled_posts(id) on delete set null,
      platform text not null check (platform in ('facebook','instagram','threads')),
      external_post_id text not null,
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
      replies int not null default 0,
      reposts int not null default 0,
      quotes int not null default 0,
      captured_at timestamptz not null default now(),
      unique (client_id, platform, external_post_id)
    );
  end if;
end $$;

alter table crm_insights_snapshots add column if not exists snapshot_date date;
update crm_insights_snapshots set snapshot_date = captured_at::date where snapshot_date is null;
delete from crm_insights_snapshots a
using crm_insights_snapshots b
where a.id <> b.id
  and a.client_id = b.client_id
  and a.platform = b.platform
  and a.snapshot_date = b.snapshot_date
  and a.captured_at < b.captured_at;
create unique index if not exists idx_crm_insights_snapshots_daily on crm_insights_snapshots(client_id, platform, snapshot_date);
create index if not exists idx_crm_insights_snapshots_lookup on crm_insights_snapshots(client_id, platform, captured_at desc);
create index if not exists idx_crm_post_insights_client on crm_post_insights(client_id, platform, posted_at desc);
