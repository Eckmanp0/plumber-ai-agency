drop policy if exists "leads_delete_for_dispatchers" on leads;
create policy "leads_delete_for_dispatchers"
on leads for delete
using (public.has_tenant_role(tenant_id, array['agency_admin','client_admin','dispatcher']));
