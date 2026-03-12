alter table if exists appointments
  add column if not exists external_event_id text,
  add column if not exists booked_start timestamptz,
  add column if not exists booked_end timestamptz,
  add column if not exists timezone text not null default 'America/Los_Angeles',
  add column if not exists status text not null default 'pending';

create unique index if not exists calendar_connections_tenant_active_uidx
  on calendar_connections(tenant_id)
  where active = true;
