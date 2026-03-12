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
    throw new Error(`Failed to refresh Google OAuth token (${response.status})`);
  }

  const json = await response.json();
  const accessToken = getString(json.access_token);
  if (!accessToken) throw new Error("Google token response did not include an access token.");
  return accessToken;
}

async function createSecondaryCalendar(summary: string, timeZone: string): Promise<{ calendarId: string; summary: string; }> {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ summary, timeZone }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create Google Calendar (${response.status}): ${text}`);
  }

  const json = await response.json();
  const calendarId = getString(json.id);
  if (!calendarId) throw new Error("Calendar creation response did not include an id.");
  return { calendarId, summary: getString(json.summary) ?? summary };
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
  const clientId = getString(body.client_id);
  const timeZone = getString(body.timezone) ?? "America/Los_Angeles";

  let targetTenantId = tenantId;
  let businessName = getString(body.business_name);

  if (!targetTenantId && clientId) {
    const { data: client } = await supabase
      .from("clients")
      .select("tenant_id, business_name")
      .eq("id", clientId)
      .single();
    targetTenantId = client?.tenant_id ? String(client.tenant_id) : null;
    businessName = businessName ?? (client?.business_name ? String(client.business_name) : null);
  }

  if (!targetTenantId || !businessName) {
    return jsonResponse({ error: "tenant_id or client_id/business_name is required" }, 400);
  }

  const { calendarId, summary } = await createSecondaryCalendar(`${businessName} Service Calendar`, timeZone);

  const { data: existing } = await supabase
    .from("calendar_connections")
    .select("id")
    .eq("tenant_id", targetTenantId)
    .eq("active", true)
    .maybeSingle();

  let error;
  if (existing?.id) {
    ({ error } = await supabase
      .from("calendar_connections")
      .update({
        provider: "google",
        calendar_id: calendarId,
        timezone: timeZone,
        active: true,
      })
      .eq("id", existing.id));
  } else {
    ({ error } = await supabase
      .from("calendar_connections")
      .insert({
        tenant_id: targetTenantId,
        provider: "google",
        calendar_id: calendarId,
        timezone: timeZone,
        active: true,
      }));
  }

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({
    ok: true,
    tenant_id: targetTenantId,
    calendar_id: calendarId,
    summary,
    timezone: timeZone,
  });
});
