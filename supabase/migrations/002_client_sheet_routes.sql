create table if not exists client_sheet_routes (
  client_id uuid primary key references clients(id) on delete cascade,
  webhook_url text not null,
  webhook_bearer text,
  spreadsheet_id text not null,
  tab_name text not null default 'New Leads',
  active boolean not null default true,
  created_at timestamptz default now()
);
