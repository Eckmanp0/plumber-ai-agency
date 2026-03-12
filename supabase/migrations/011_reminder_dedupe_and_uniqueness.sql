delete from reminders r
using reminders newer
where r.id <> newer.id
  and r.appointment_id = newer.appointment_id
  and r.reminder_type = newer.reminder_type
  and coalesce(r.payload_json->>'template_key', '') = coalesce(newer.payload_json->>'template_key', '')
  and r.created_at > newer.created_at;

create unique index if not exists reminders_unique_per_template_idx
  on reminders (
    appointment_id,
    reminder_type,
    (coalesce(payload_json->>'template_key', ''))
  );

create or replace function seed_default_reminders(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_booked_start timestamptz,
  p_payload_json jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_payload jsonb := coalesce(p_payload_json, '{}'::jsonb);
begin
  if p_tenant_id is null or p_appointment_id is null or p_booked_start is null then
    return;
  end if;

  insert into reminders (tenant_id, appointment_id, reminder_type, scheduled_for, payload_json)
  values
    (p_tenant_id, p_appointment_id, 'sms', now(), v_payload || jsonb_build_object('template_key', 'booking_confirmation')),
    (p_tenant_id, p_appointment_id, 'sms', p_booked_start - interval '24 hours', v_payload || jsonb_build_object('template_key', 'reminder_24h')),
    (p_tenant_id, p_appointment_id, 'sms', p_booked_start - interval '2 hours', v_payload || jsonb_build_object('template_key', 'reminder_2h'))
  on conflict do nothing;
end;
$$;
