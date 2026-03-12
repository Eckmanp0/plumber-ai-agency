import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function displayAppointmentTime(iso: string | null, timeZone: string): string {
  if (!iso) return "your scheduled time";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

function hasSmsProviderConfig(): boolean {
  return Boolean(
    Deno.env.get("TWILIO_ACCOUNT_SID") &&
    Deno.env.get("TWILIO_AUTH_TOKEN") &&
    Deno.env.get("TWILIO_FROM_NUMBER"),
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const smsSendUrl = `${supabaseUrl}/functions/v1/sms-send`;
  const nowIso = new Date().toISOString();

  if (!hasSmsProviderConfig()) {
    return jsonResponse({
      ok: true,
      skipped: true,
      reason: "Missing Twilio credentials. Reminders remain queued.",
      processed_count: 0,
    });
  }

  const { data: reminders, error } = await supabase
    .from("reminders")
    .select(`
      id,
      tenant_id,
      appointment_id,
      reminder_type,
      scheduled_for,
      payload_json,
      appointments(
        id,
        lead_id,
        client_id,
        booked_start,
        timezone,
        clients(id, business_name, phone),
        leads(caller_name, caller_phone, service_address)
      )
    `)
    .eq("status", "queued")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(25);

  if (error) return jsonResponse({ error: error.message }, 500);

  const processed: Array<Record<string, unknown>> = [];

  for (const reminder of reminders ?? []) {
    try {
      const appointment = reminder.appointments as Json | null;
      const lead = appointment?.leads as Json | null;
      const client = appointment?.clients as Json | null;
      const payload = reminder.payload_json && typeof reminder.payload_json === "object"
        ? reminder.payload_json as Json
        : {};
      const toPhone = getString(lead?.caller_phone);
      const templateKey = getString(payload.template_key) ?? "booking_confirmation";
      const timezone = getString(appointment?.timezone) ?? "America/Los_Angeles";

      if (reminder.reminder_type !== "sms" || !toPhone || !client) {
        await supabase
          .from("reminders")
          .update({ status: "failed" })
          .eq("id", reminder.id);
        processed.push({ id: reminder.id, status: "failed", reason: "Missing sms context" });
        continue;
      }

      const smsPayload = {
        tenant_id: reminder.tenant_id,
        lead_id: getString(appointment?.lead_id),
        appointment_id: reminder.appointment_id,
        to_phone: toPhone,
        template_key: templateKey,
        payload_json: {
          customer_name: getString(lead?.caller_name),
          business_name: getString(client.business_name),
          appointment_time: displayAppointmentTime(getString(appointment?.booked_start), timezone),
          service_address: getString(lead?.service_address),
          business_phone: getString(client.phone),
        },
      };

      const smsRes = await fetch(smsSendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify(smsPayload),
      });

      if (!smsRes.ok) {
        const smsError = await smsRes.text();
        await supabase
          .from("reminders")
          .update({ status: "failed" })
          .eq("id", reminder.id);
        processed.push({ id: reminder.id, status: "failed", reason: smsError });
        continue;
      }

      await supabase
        .from("reminders")
        .update({ status: "sent" })
        .eq("id", reminder.id);

      processed.push({ id: reminder.id, status: "sent" });
    } catch (err) {
      await supabase
        .from("reminders")
        .update({ status: "failed" })
        .eq("id", reminder.id);
      processed.push({ id: reminder.id, status: "failed", reason: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  return jsonResponse({
    ok: true,
    processed_count: processed.length,
    processed,
  });
});
