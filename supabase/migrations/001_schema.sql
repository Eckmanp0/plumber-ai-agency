create extension if not exists pgcrypto;

create table clients (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  owner_name text,
  contact_phone text,
  contact_email text,
  notification_sms text,
  notification_email text,
  service_area_json jsonb default '[]',
  services_json jsonb default '[]',
  hours_json jsonb default '{}',
  emergency_enabled boolean default true,
  booking_rules_json jsonb default '{}',
  vapi_assistant_id text,
  created_at timestamptz default now()
);

create table calls (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  vapi_call_id text unique,
  started_at timestamptz,
  ended_at timestamptz,
  transcript text,
  summary text,
  structured_output jsonb,
  created_at timestamptz default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  call_id uuid references calls(id),
  caller_name text,
  caller_phone text,
  service_address text,
  issue_description text,
  service_type text,
  urgency_level text,
  preferred_date text,
  preferred_time text,
  status text default 'new',
  created_at timestamptz default now()
);

create table monthly_usage (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  month_key text,
  total_calls integer default 0
);
