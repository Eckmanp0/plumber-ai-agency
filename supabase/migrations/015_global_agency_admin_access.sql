create or replace function public.current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with has_global_agency_admin as (
    select exists (
      select 1
      from public.tenant_users
      where user_id = auth.uid()
        and role = 'agency_admin'
    ) as allowed
  )
  select t.id
  from public.tenants t
  cross join has_global_agency_admin g
  where g.allowed

  union

  select tenant_id
  from public.tenant_users
  where user_id = auth.uid();
$$;
