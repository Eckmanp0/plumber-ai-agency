create or replace function seed_default_reminders(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_booked_start timestamptz,
  p_payload_json jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
begin
  if p_booked_start is null then
    return;
  end if;

  insert into reminders (tenant_id, appointment_id, reminder_type, scheduled_for, payload_json)
  values
    (p_tenant_id, p_appointment_id, 'sms', now(), jsonb_set(p_payload_json, '{template_key}', '"booking_confirmation"')),
    (p_tenant_id, p_appointment_id, 'sms', p_booked_start - interval '24 hours', jsonb_set(p_payload_json, '{template_key}', '"reminder_24h"')),
    (p_tenant_id, p_appointment_id, 'sms', p_booked_start - interval '2 hours', jsonb_set(p_payload_json, '{template_key}', '"reminder_2h"'))
  on conflict do nothing;
end;
$$;

create index if not exists reminders_due_idx
  on reminders(status, scheduled_for);

create index if not exists sms_messages_tenant_created_idx
  on sms_messages(tenant_id, created_at desc);
