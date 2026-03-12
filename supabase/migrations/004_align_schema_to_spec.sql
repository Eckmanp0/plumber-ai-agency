-- Align schema to target operating model while preserving existing data.

-- clients: add canonical phone/email columns and backfill from legacy contact_*.
alter table if exists clients add column if not exists phone text;
alter table if exists clients add column if not exists email text;
update clients set phone = coalesce(phone, contact_phone), email = coalesce(email, contact_email);

-- calls: canonical call_* fields + duration/outcome.
alter table if exists calls add column if not exists call_start timestamptz;
alter table if exists calls add column if not exists call_end timestamptz;
alter table if exists calls add column if not exists duration_seconds integer;
alter table if exists calls add column if not exists call_outcome text;
update calls set
  call_start = coalesce(call_start, started_at),
  call_end = coalesce(call_end, ended_at),
  duration_seconds = coalesce(duration_seconds,
    case when ended_at is not null and started_at is not null
      then greatest(0, extract(epoch from (ended_at - started_at))::int)
      else null
    end
  );

-- leads: enforce status values requested, keep preferred_date for backward compatibility.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'leads' and constraint_name = 'leads_status_check'
  ) then
    alter table leads drop constraint leads_status_check;
  end if;
end $$;
alter table if exists leads
  add constraint leads_status_check
  check (status in ('new','booked','callback','declined','spam'));

-- appointments table.
create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  lead_id uuid references leads(id),
  scheduled_time timestamptz,
  confirmed boolean default false,
  technician text,
  notes text,
  created_at timestamptz default now()
);

-- monthly_usage: canonical reporting columns.
alter table if exists monthly_usage add column if not exists month text;
alter table if exists monthly_usage add column if not exists qualified_leads integer default 0;
alter table if exists monthly_usage add column if not exists booked_jobs integer default 0;
alter table if exists monthly_usage add column if not exists minutes_used numeric default 0;
alter table if exists monthly_usage add column if not exists estimated_cost numeric default 0;
alter table if exists monthly_usage add column if not exists invoice_amount numeric default 0;
update monthly_usage set month = coalesce(month, month_key);
