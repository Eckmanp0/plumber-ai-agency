drop policy if exists "tenants_update_for_admins" on tenants;
create policy "tenants_update_for_admins"
on tenants for update
using (public.has_tenant_role(id, array['agency_admin', 'client_admin']))
with check (public.has_tenant_role(id, array['agency_admin', 'client_admin']));

drop policy if exists "tenants_delete_for_agency_admins" on tenants;
create policy "tenants_delete_for_agency_admins"
on tenants for delete
using (public.has_tenant_role(id, array['agency_admin']));
