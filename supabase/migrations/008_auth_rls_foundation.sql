create or replace function public.current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id
  from public.tenant_users
  where user_id = auth.uid()
$$;

create or replace function public.has_tenant_role(
  p_tenant_id uuid,
  p_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = auth.uid()
      and tu.role = any(p_roles)
  )
$$;

alter table tenant_users enable row level security;
alter table tenants enable row level security;
alter table clients enable row level security;
alter table leads enable row level security;
alter table calls enable row level security;
alter table appointments enable row level security;
alter table monthly_usage enable row level security;
alter table client_sheet_routes enable row level security;
alter table calendar_connections enable row level security;
alter table reminders enable row level security;
alter table sms_messages enable row level security;
alter table followup_rules enable row level security;
alter table followups enable row level security;

drop policy if exists "tenant_users_select_own_memberships" on tenant_users;
create policy "tenant_users_select_own_memberships"
on tenant_users for select
using (user_id = auth.uid());

drop policy if exists "tenants_select_for_members" on tenants;
create policy "tenants_select_for_members"
on tenants for select
using (id in (select public.current_tenant_ids()));

drop policy if exists "clients_select_for_members" on clients;
create policy "clients_select_for_members"
on clients for select
using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "clients_update_for_admins" on clients;
create policy "clients_update_for_admins"
on clients for update
using (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']))
with check (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']));

drop policy if exists "leads_select_for_members" on leads;
create policy "leads_select_for_members"
on leads for select
using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "leads_insert_for_dispatchers" on leads;
create policy "leads_insert_for_dispatchers"
on leads for insert
with check (public.has_tenant_role(tenant_id, array['agency_admin','client_admin','dispatcher']));

drop policy if exists "leads_update_for_dispatchers" on leads;
create policy "leads_update_for_dispatchers"
on leads for update
using (public.has_tenant_role(tenant_id, array['agency_admin','client_admin','dispatcher']))
with check (public.has_tenant_role(tenant_id, array['agency_admin','client_admin','dispatcher']));

drop policy if exists "calls_select_for_members" on calls;
create policy "calls_select_for_members"
on calls for select
using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "appointments_select_for_members" on appointments;
create policy "appointments_select_for_members"
on appointments for select
using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "appointments_write_for_dispatchers" on appointments;
create policy "appointments_write_for_dispatchers"
on appointments for all
using (public.has_tenant_role(tenant_id, array['agency_admin','client_admin','dispatcher']))
with check (public.has_tenant_role(tenant_id, array['agency_admin','client_admin','dispatcher']));

drop policy if exists "monthly_usage_select_for_admins" on monthly_usage;
create policy "monthly_usage_select_for_admins"
on monthly_usage for select
using (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']));

drop policy if exists "client_sheet_routes_select_for_admins" on client_sheet_routes;
create policy "client_sheet_routes_select_for_admins"
on client_sheet_routes for select
using (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']));

drop policy if exists "client_sheet_routes_write_for_admins" on client_sheet_routes;
create policy "client_sheet_routes_write_for_admins"
on client_sheet_routes for all
using (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']))
with check (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']));

drop policy if exists "calendar_connections_select_for_admins" on calendar_connections;
create policy "calendar_connections_select_for_admins"
on calendar_connections for select
using (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']));

drop policy if exists "calendar_connections_write_for_admins" on calendar_connections;
create policy "calendar_connections_write_for_admins"
on calendar_connections for all
using (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']))
with check (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']));

drop policy if exists "reminders_select_for_members" on reminders;
create policy "reminders_select_for_members"
on reminders for select
using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "sms_messages_select_for_members" on sms_messages;
create policy "sms_messages_select_for_members"
on sms_messages for select
using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists "followup_rules_select_for_admins" on followup_rules;
create policy "followup_rules_select_for_admins"
on followup_rules for select
using (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']));

drop policy if exists "followup_rules_write_for_admins" on followup_rules;
create policy "followup_rules_write_for_admins"
on followup_rules for all
using (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']))
with check (public.has_tenant_role(tenant_id, array['agency_admin','client_admin']));

drop policy if exists "followups_select_for_members" on followups;
create policy "followups_select_for_members"
on followups for select
using (tenant_id in (select public.current_tenant_ids()));
