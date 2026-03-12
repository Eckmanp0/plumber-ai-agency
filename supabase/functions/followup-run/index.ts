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

function hasSmsProviderConfig(): boolean {
  return Boolean(
    Deno.env.get("TWILIO_ACCOUNT_SID") &&
    Deno.env.get("TWILIO_AUTH_TOKEN") &&
    Deno.env.get("TWILIO_FROM_NUMBER"),
  );
}

function hasOutboundCallConfig(): boolean {
  return Boolean(
    Deno.env.get("VAPI_API_KEY") &&
    Deno.env.get("VAPI_OUTBOUND_ASSISTANT_ID"),
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

  const smsReady = hasSmsProviderConfig();
  const outboundReady = hasOutboundCallConfig();
  if (!smsReady && !outboundReady) {
    return jsonResponse({
      ok: true,
      skipped: true,
      reason: "No follow-up delivery providers are configured. Follow-ups remain queued.",
      processed_count: 0,
    });
  }

  const { data: followups, error } = await supabase
    .from("followups")
    .select(`
      id,
      tenant_id,
      lead_id,
      appointment_id,
      followup_type,
      trigger_reason,
      scheduled_for,
      payload_json,
      leads(
        id,
        client_id,
        caller_name,
        caller_phone,
        issue_description,
        service_address,
        clients(id, business_name, phone)
      )
    `)
    .eq("status", "queued")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(25);

  if (error) return jsonResponse({ error: error.message }, 500);

  const processed: Array<Record<string, unknown>> = [];

  for (const followup of followups ?? []) {
    const lead = followup.leads as Json | null;
    const client = lead?.clients as Json | null;
    const payload = followup.payload_json && typeof followup.payload_json === "object"
      ? followup.payload_json as Json
      : {};
    const templateKey = getString(payload.template_key) ?? getString(followup.trigger_reason) ?? "followup";

    if (followup.followup_type === "sms") {
      if (!smsReady) {
        processed.push({ id: followup.id, status: "queued", reason: "SMS provider not configured" });
        continue;
      }

      const toPhone = getString(lead?.caller_phone);
      if (!toPhone || !client) {
        await supabase.from("followups").update({ status: "failed" }).eq("id", followup.id);
        processed.push({ id: followup.id, status: "failed", reason: "Missing SMS context" });
        continue;
      }

      const smsRes = await fetch(smsSendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          tenant_id: followup.tenant_id,
          lead_id: followup.lead_id,
          appointment_id: followup.appointment_id,
          to_phone: toPhone,
          template_key: templateKey,
          payload_json: {
            customer_name: getString(lead?.caller_name),
            business_name: getString(client.business_name),
            issue_description: getString(lead?.issue_description),
            service_address: getString(lead?.service_address),
            business_phone: getString(client.phone),
          },
        }),
      });

      if (!smsRes.ok) {
        const smsError = await smsRes.text();
        await supabase.from("followups").update({ status: "failed" }).eq("id", followup.id);
        processed.push({ id: followup.id, status: "failed", reason: smsError });
        continue;
      }

      await supabase.from("followups").update({ status: "sent" }).eq("id", followup.id);
      processed.push({ id: followup.id, status: "sent", channel: "sms" });
      continue;
    }

    if (followup.followup_type === "outbound_call") {
      if (!outboundReady) {
        processed.push({ id: followup.id, status: "queued", reason: "Outbound call provider not configured" });
        continue;
      }

      await supabase.from("followups").update({ status: "processing" }).eq("id", followup.id);
      processed.push({ id: followup.id, status: "processing", channel: "outbound_call", reason: "Provider wiring still pending" });
      continue;
    }
  }

  return jsonResponse({ ok: true, processed_count: processed.length, processed });
});
