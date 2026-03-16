create extension if not exists "pgcrypto";

alter table if exists tenants
  add column if not exists business_name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists emergency_enabled boolean not null default false,
  add column if not exists same_day_service boolean not null default false,
  add column if not exists hours_json jsonb not null default '{}'::jsonb;

update tenants t
set
  business_name = coalesce(t.business_name, c.business_name, t.name),
  phone = coalesce(t.phone, c.phone, c.contact_phone),
  email = coalesce(t.email, c.email, c.contact_email),
  emergency_enabled = coalesce(c.emergency_enabled, t.emergency_enabled, false),
  same_day_service = coalesce(c.same_day_allowed, t.same_day_service, false),
  hours_json = case
    when t.hours_json = '{}'::jsonb and c.hours_json is not null then c.hours_json
    else t.hours_json
  end
from clients c
where c.tenant_id = t.id;

create table if not exists service_catalog (
  id uuid primary key default gen_random_uuid(),
  service_key text not null unique,
  service_name text not null,
  category text,
  emergency_possible boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists tenant_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  service_id uuid not null references service_catalog(id) on delete cascade,
  enabled boolean not null default true,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  unique (tenant_id, service_id)
);

create index if not exists tenant_services_tenant_enabled_idx
  on tenant_services(tenant_id, enabled, priority);

create table if not exists tenant_service_areas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  county text,
  city text,
  zip_code text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists tenant_service_areas_lookup_idx
  on tenant_service_areas(tenant_id, active, lower(city), zip_code);

create table if not exists phone_numbers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  number text,
  vapi_phone_number_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists phone_numbers_number_uidx
  on phone_numbers(number)
  where number is not null;

create unique index if not exists phone_numbers_vapi_phone_number_uidx
  on phone_numbers(vapi_phone_number_id)
  where vapi_phone_number_id is not null;

insert into service_catalog (service_key, service_name, category, emergency_possible, active)
values
  ('drain_cleaning', 'Drain Cleaning', 'drain', false, true),
  ('leak_repair', 'Leak Repair', 'repair', true, true),
  ('burst_pipe', 'Burst Pipe Repair', 'emergency', true, true),
  ('sewer_repair', 'Sewer Line Repair', 'sewer', true, true),
  ('toilet_repair', 'Toilet Repair', 'fixture', false, true),
  ('faucet_install', 'Faucet Installation', 'install', false, true),
  ('garbage_disposal', 'Garbage Disposal Repair', 'fixture', false, true),
  ('water_heater_repair', 'Water Heater Repair', 'water_heater', true, true),
  ('water_heater_replace', 'Water Heater Replacement', 'water_heater', false, true),
  ('inspection', 'Plumbing Inspection', 'inspection', false, true)
on conflict (service_key) do update
set
  service_name = excluded.service_name,
  category = excluded.category,
  emergency_possible = excluded.emergency_possible,
  active = excluded.active;

with normalized_services as (
  select distinct
    trim(service_name) as service_name,
    lower(regexp_replace(trim(service_name), '[^a-z0-9]+', '_', 'g')) as service_key
  from clients c
  cross join lateral jsonb_array_elements_text(coalesce(c.services_json, '[]'::jsonb)) as service_name
  where trim(service_name) <> ''
)
insert into service_catalog (service_key, service_name, category, emergency_possible, active)
select
  ns.service_key,
  ns.service_name,
  'general',
  false,
  true
from normalized_services ns
where ns.service_key <> ''
on conflict (service_key) do nothing;

with expanded_client_services as (
  select
    c.tenant_id,
    trim(service_name.value) as raw_service_name,
    service_name.ordinality as priority
  from clients c
  cross join lateral jsonb_array_elements_text(coalesce(c.services_json, '[]'::jsonb)) with ordinality as service_name(value, ordinality)
  where c.tenant_id is not null
    and trim(service_name.value) <> ''
),
matched_services as (
  select
    ecs.tenant_id,
    sc.id as service_id,
    min(ecs.priority) as priority
  from expanded_client_services ecs
  join service_catalog sc
    on sc.service_key = lower(regexp_replace(ecs.raw_service_name, '[^a-z0-9]+', '_', 'g'))
    or lower(sc.service_name) = lower(ecs.raw_service_name)
  group by ecs.tenant_id, sc.id
)
insert into tenant_services (tenant_id, service_id, enabled, priority)
select
  tenant_id,
  service_id,
  true,
  priority
from matched_services
on conflict (tenant_id, service_id) do update
set
  enabled = excluded.enabled,
  priority = least(tenant_services.priority, excluded.priority);

with expanded_service_areas as (
  select
    c.tenant_id,
    nullif(trim(area.value ->> 'county'), '') as county,
    nullif(trim(area.value ->> 'city'), '') as city,
    nullif(trim(coalesce(area.value ->> 'zip_code', area.value ->> 'zip')), '') as zip_code
  from clients c
  cross join lateral jsonb_array_elements(coalesce(c.service_area_json, '[]'::jsonb)) as area(value)
  where c.tenant_id is not null
),
deduped_areas as (
  select distinct tenant_id, county, city, zip_code
  from expanded_service_areas
  where county is not null or city is not null or zip_code is not null
)
insert into tenant_service_areas (tenant_id, county, city, zip_code, active)
select
  tenant_id,
  county,
  city,
  zip_code,
  true
from deduped_areas
on conflict do nothing;

insert into phone_numbers (tenant_id, client_id, number, vapi_phone_number_id, active)
select
  c.tenant_id,
  c.id,
  c.phone,
  c.vapi_phone_number_id,
  coalesce(c.active, true)
from clients c
where c.tenant_id is not null
  and (c.phone is not null or c.vapi_phone_number_id is not null)
on conflict (number) where number is not null do update
set
  tenant_id = excluded.tenant_id,
  client_id = excluded.client_id,
  vapi_phone_number_id = coalesce(excluded.vapi_phone_number_id, phone_numbers.vapi_phone_number_id),
  active = excluded.active;

insert into phone_numbers (tenant_id, client_id, number, vapi_phone_number_id, active)
select
  c.tenant_id,
  c.id,
  null,
  c.vapi_phone_number_id,
  coalesce(c.active, true)
from clients c
where c.tenant_id is not null
  and c.vapi_phone_number_id is not null
  and not exists (
    select 1
    from phone_numbers pn
    where pn.vapi_phone_number_id = c.vapi_phone_number_id
  );
