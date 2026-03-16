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

async function getGoogleAccessToken(): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Google OAuth credentials.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to refresh Google OAuth token (${response.status}): ${text}`);
  }

  const json = await response.json();
  const accessToken = getString(json.access_token);
  if (!accessToken) throw new Error("Google token response did not include an access token.");
  return accessToken;
}

async function cancelGoogleEvent(calendarId: string, eventId: string): Promise<void> {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Failed to cancel Google Calendar event (${response.status}): ${text}`);
  }
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

  const appointmentId = getString(body.appointment_id);
  const externalEventId = getString(body.external_event_id);
  const tenantId = getString(body.tenant_id);
  const cancelReason = getString(body.cancel_reason) ?? "Cancelled by agency";

  if (!appointmentId && !externalEventId) {
    return jsonResponse({ error: "appointment_id or external_event_id is required" }, 400);
  }

  let query = supabase
    .from("appointments")
    .select("id, tenant_id, lead_id, external_event_id, status, notes");

  if (appointmentId) {
    query = query.eq("id", appointmentId);
  } else {
    query = query.eq("external_event_id", externalEventId);
  }

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data: appointment, error: appointmentError } = await query.maybeSingle();
  if (appointmentError) return jsonResponse({ error: appointmentError.message }, 500);
  if (!appointment?.id) return jsonResponse({ error: "Appointment not found" }, 404);

  const { data: calendarConnection, error: calendarError } = await supabase
    .from("calendar_connections")
    .select("calendar_id, active")
    .eq("tenant_id", appointment.tenant_id)
    .eq("active", true)
    .maybeSingle();

  if (calendarError) return jsonResponse({ error: calendarError.message }, 500);

  let calendarMessage = "No external event to cancel.";
  if (appointment.external_event_id && calendarConnection?.calendar_id) {
    await cancelGoogleEvent(String(calendarConnection.calendar_id), String(appointment.external_event_id));
    calendarMessage = "Google Calendar event cancelled.";
  }

  const nextNotes = [getString(appointment.notes), cancelReason].filter(Boolean).join(" | ");

  const { error: updateError } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      confirmed: false,
      notes: nextNotes,
    })
    .eq("id", appointment.id);

  if (updateError) return jsonResponse({ error: updateError.message }, 500);

  await supabase
    .from("reminders")
    .update({ status: "cancelled" })
    .eq("appointment_id", appointment.id)
    .eq("status", "queued");

  if (appointment.lead_id) {
    await supabase
      .from("leads")
      .update({ status: "callback" })
      .eq("id", appointment.lead_id)
      .neq("status", "spam");
  }

  return jsonResponse({
    ok: true,
    appointment_id: appointment.id,
    tenant_id: appointment.tenant_id,
    external_event_id: appointment.external_event_id,
    status: "cancelled",
    calendar_message: calendarMessage,
  });
});
