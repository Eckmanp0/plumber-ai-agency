create unique index if not exists followup_rules_unique_rule_idx
  on followup_rules (tenant_id, trigger_reason, followup_type, template_key);

create unique index if not exists followups_unique_per_trigger_idx
  on followups (
    tenant_id,
    lead_id,
    followup_type,
    trigger_reason,
    (coalesce(payload_json->>'template_key', ''))
  )
  where lead_id is not null;

create index if not exists followups_due_idx
  on followups (status, scheduled_for);

create or replace function seed_default_followup_rules(
  p_tenant_id uuid
)
returns void
language plpgsql
as $$
begin
  if p_tenant_id is null then
    return;
  end if;

  insert into followup_rules (tenant_id, active, trigger_reason, followup_type, delay_minutes, template_key)
  values
    (p_tenant_id, true, 'unbooked_new_lead', 'sms', 15, 'unbooked_new_lead'),
    (p_tenant_id, true, 'after_hours_callback', 'outbound_call', 600, 'after_hours_callback'),
    (p_tenant_id, true, 'estimate_followup', 'sms', 120, 'estimate_followup'),
    (p_tenant_id, true, 'post_service_review', 'sms', 1440, 'post_service_review')
  on conflict do nothing;
end;
$$;

create or replace function queue_followups_for_lead(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_trigger_reason text,
  p_payload_json jsonb default '{}'::jsonb,
  p_appointment_id uuid default null
)
returns integer
language plpgsql
as $$
declare
  v_payload jsonb := coalesce(p_payload_json, '{}'::jsonb);
  v_inserted integer := 0;
begin
  if p_tenant_id is null or p_lead_id is null or p_trigger_reason is null then
    return 0;
  end if;

  insert into followups (
    tenant_id,
    lead_id,
    appointment_id,
    followup_type,
    trigger_reason,
    scheduled_for,
    payload_json
  )
  select
    p_tenant_id,
    p_lead_id,
    p_appointment_id,
    fr.followup_type,
    fr.trigger_reason,
    now() + make_interval(mins => fr.delay_minutes),
    v_payload || jsonb_build_object('template_key', fr.template_key)
  from followup_rules fr
  where fr.tenant_id = p_tenant_id
    and fr.active = true
    and fr.trigger_reason = p_trigger_reason
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
