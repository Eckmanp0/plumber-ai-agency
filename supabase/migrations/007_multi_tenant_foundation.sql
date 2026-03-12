create extension if not exists "pgcrypto";

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  package_tier text not null default 'pilot'
    check (package_tier in ('pilot', 'full_service')),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'trialing', 'suspended')),
  created_at timestamptz not null default now()
);

create table if not exists tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null,
  role text not null
    check (role in ('agency_admin', 'client_admin', 'dispatcher', 'tech_viewer')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

alter table if exists clients
  add column if not exists tenant_id uuid,
  add column if not exists same_day_allowed boolean not null default false,
  add column if not exists urgent_alert_phone text,
  add column if not exists reports_email text,
  add column if not exists booking_mode text not null default 'request_only'
    check (booking_mode in ('request_only', 'calendar_direct')),
  add column if not exists package_tier text not null default 'pilot'
    check (package_tier in ('pilot', 'full_service')),
  add column if not exists feature_flags_json jsonb not null default
    '{
      "calendar_enabled": false,
      "sms_enabled": false,
      "reminders_enabled": false,
      "outbound_followups_enabled": false,
      "google_sheets_enabled": true,
      "monthly_reports_enabled": true
    }'::jsonb,
  add column if not exists google_sheet_template_id text;

update clients
set tenant_id = gen_random_uuid()
where tenant_id is null;

insert into tenants (id, name, slug, package_tier, status)
select
  c.tenant_id,
  c.business_name,
  lower(
    regexp_replace(
      regexp_replace(coalesce(c.business_name, 'tenant'), '[^a-zA-Z0-9]+', '-', 'g'),
      '(^-+|-+$)',
      '',
      'g'
    )
  ) || '-' || substr(replace(c.id::text, '-', ''), 1, 8),
  coalesce(c.package_tier, 'pilot'),
  case when coalesce(c.active, true) then 'active' else 'inactive' end
from clients c
where c.tenant_id is not null
  and not exists (
    select 1 from tenants t where t.id = c.tenant_id
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_tenant_id_fkey'
  ) then
    alter table clients
      add constraint clients_tenant_id_fkey
      foreign key (tenant_id) references tenants(id) on delete cascade;
  end if;
end $$;

create unique index if not exists clients_tenant_id_uidx
  on clients(tenant_id)
  where tenant_id is not null;

alter table if exists calls add column if not exists tenant_id uuid;
alter table if exists leads add column if not exists tenant_id uuid;
alter table if exists appointments add column if not exists tenant_id uuid;
alter table if exists monthly_usage add column if not exists tenant_id uuid;
alter table if exists client_sheet_routes add column if not exists tenant_id uuid;

update calls c
set tenant_id = cl.tenant_id
from clients cl
where c.client_id = cl.id
  and c.tenant_id is null;

update leads l
set tenant_id = cl.tenant_id
from clients cl
where l.client_id = cl.id
  and l.tenant_id is null;

update appointments a
set tenant_id = cl.tenant_id
from clients cl
where a.client_id = cl.id
  and a.tenant_id is null;

update monthly_usage mu
set tenant_id = cl.tenant_id
from clients cl
where mu.client_id = cl.id
  and mu.tenant_id is null;

update client_sheet_routes csr
set tenant_id = cl.tenant_id
from clients cl
where csr.client_id = cl.id
  and csr.tenant_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'calls_tenant_id_fkey'
  ) then
    alter table calls
      add constraint calls_tenant_id_fkey
      foreign key (tenant_id) references tenants(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'leads_tenant_id_fkey'
  ) then
    alter table leads
      add constraint leads_tenant_id_fkey
      foreign key (tenant_id) references tenants(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'appointments_tenant_id_fkey'
  ) then
    alter table appointments
      add constraint appointments_tenant_id_fkey
      foreign key (tenant_id) references tenants(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'monthly_usage_tenant_id_fkey'
  ) then
    alter table monthly_usage
      add constraint monthly_usage_tenant_id_fkey
      foreign key (tenant_id) references tenants(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'client_sheet_routes_tenant_id_fkey'
  ) then
    alter table client_sheet_routes
      add constraint client_sheet_routes_tenant_id_fkey
      foreign key (tenant_id) references tenants(id) on delete cascade;
  end if;
end $$;

create table if not exists calendar_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null default 'google',
  calendar_id text not null,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  timezone text not null default 'America/Los_Angeles',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('sms', 'call')),
  scheduled_for timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'cancelled')),
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists sms_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  to_phone text not null,
  direction text not null check (direction in ('outbound', 'inbound')),
  template_key text,
  body text not null,
  provider_message_id text,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

create table if not exists followup_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  active boolean not null default true,
  trigger_reason text not null,
  followup_type text not null
    check (followup_type in ('sms', 'outbound_call')),
  delay_minutes integer not null,
  template_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists followups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  followup_type text not null
    check (followup_type in ('sms', 'outbound_call')),
  trigger_reason text not null,
  scheduled_for timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'sent', 'completed', 'failed', 'cancelled')),
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function feature_enabled(
  p_client_id uuid,
  p_feature_key text
)
returns boolean
language sql
stable
as $$
  select coalesce((feature_flags_json ->> p_feature_key)::boolean, false)
  from clients
  where id = p_client_id
$$;
