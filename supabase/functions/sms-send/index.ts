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

function renderTemplate(templateKey: string, data: Json): string {
  const customerName = getString(data.customer_name) ?? "there";
  const businessName = getString(data.business_name) ?? "the plumbing team";
  const appointmentTime = getString(data.appointment_time) ?? "your scheduled time";
  const serviceAddress = getString(data.service_address) ?? "your service address";
  const businessPhone = getString(data.business_phone) ?? "the office";

  switch (templateKey) {
    case "booking_confirmation":
      return `Hi ${customerName}, you're scheduled with ${businessName} on ${appointmentTime} at ${serviceAddress}. Reply C to confirm or call ${businessPhone}.`;
    case "reminder_24h":
      return `Reminder from ${businessName}: your plumbing appointment is tomorrow at ${appointmentTime}. Reply if you need to reschedule.`;
    case "reminder_2h":
      return `${businessName} reminder: your appointment is coming up at ${appointmentTime}. Call ${businessPhone} if anything changes.`;
    default:
      return `Reminder from ${businessName}: your appointment is scheduled for ${appointmentTime} at ${serviceAddress}.`;
  }
}

async function sendViaTwilio(toPhone: string, body: string): Promise<{ sid: string; status: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("Missing Twilio credentials.");
  }

  const basicAuth = btoa(`${accountSid}:${authToken}`);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: toPhone,
      From: fromNumber,
      Body: body,
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.message ?? `Twilio send failed (${response.status})`);
  }

  return {
    sid: String(json.sid),
    status: String(json.status ?? "sent"),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  const tenantId = getString(body.tenant_id);
  const leadId = getString(body.lead_id);
  const appointmentId = getString(body.appointment_id);
  const toPhone = getString(body.to_phone);
  const templateKey = getString(body.template_key) ?? "booking_confirmation";
  const payload = body.payload_json && typeof body.payload_json === "object" ? body.payload_json as Json : {};

  if (!tenantId || !toPhone) {
    return jsonResponse({ error: "tenant_id and to_phone are required" }, 400);
  }

  const smsBody = renderTemplate(templateKey, payload);

  const providerResult = await sendViaTwilio(toPhone, smsBody);

  const { data: smsMessage, error } = await supabase
    .from("sms_messages")
    .insert({
      tenant_id: tenantId,
      lead_id: leadId,
      appointment_id: appointmentId,
      to_phone: toPhone,
      direction: "outbound",
      template_key: templateKey,
      body: smsBody,
      provider_message_id: providerResult.sid,
      status: providerResult.status,
    })
    .select("id, provider_message_id, status")
    .single();

  if (error || !smsMessage) {
    return jsonResponse({ error: error?.message ?? "Failed to log sms message" }, 500);
  }

  return jsonResponse({
    ok: true,
    sms_message_id: smsMessage.id,
    provider_message_id: smsMessage.provider_message_id,
    status: smsMessage.status,
  });
});
