create table if not exists client_monthly_report_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  month_key text not null,
  report_date date not null,
  calls integer not null default 0,
  leads integer not null default 0,
  bookings integer not null default 0,
  est_revenue numeric not null default 0,
  synced boolean not null default false,
  message text,
  created_at timestamptz default now(),
  unique (client_id, month_key, report_date)
);
