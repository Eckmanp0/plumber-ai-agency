alter table if exists clients add column if not exists vapi_phone_number_id text;
alter table if exists clients add column if not exists google_sheet_id text;
alter table if exists clients add column if not exists active boolean not null default true;

alter table if exists calls add column if not exists ended_reason text;
alter table if exists calls add column if not exists recording_url text;
alter table if exists calls add column if not exists raw_event jsonb;

alter table if exists leads add column if not exists disposition text;
alter table if exists leads add column if not exists summary text;

alter table if exists appointments add column if not exists scheduled_date text;
alter table if exists appointments add column if not exists scheduled_time text;
alter table if exists appointments add column if not exists assigned_to text;
