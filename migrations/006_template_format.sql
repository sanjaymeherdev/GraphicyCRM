-- migrations/006_template_format.sql
-- Adds a `format` column to crm_templates so a template's body can be sent
-- as plain text, a raw JSON payload (WhatsApp/Facebook/Instagram interactive
-- or attachment payloads), or HTML (email/Gmail templates), instead of
-- always being treated as literal text.
--
-- Safe to re-run: `add column if not exists` + a guarded `check` add.
alter table crm_templates add column if not exists format text not null default 'text';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crm_templates_format_check'
  ) then
    alter table crm_templates
      add constraint crm_templates_format_check check (format in ('text', 'json', 'html'));
  end if;
end $$;

comment on column crm_templates.format is
  'How to interpret/send `body`: text = plain text, json = raw channel API payload (WhatsApp/Facebook/Instagram), html = HTML email body.';
