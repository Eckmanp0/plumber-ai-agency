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

function startOfUtcDay(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function endOfUtcDay(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter((item) => item.length > 0);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let payload: Json = {};
  try {
    payload = (await req.json()) as Json;
  } catch {
    payload = {};
  }

  const targetClientId = typeof payload.client_id === "string" ? payload.client_id : null;
  const targetClientIds = [...new Set(getStringArray(payload.client_ids))];
  const targetTenantIds = [...new Set(getStringArray(payload.tenant_ids))];
  const now = new Date();
  const dayKey = startOfUtcDay(now).slice(0, 10);
  const start = startOfUtcDay(now);
  const end = endOfUtcDay(now);

  let clientQuery = supabase
    .from("clients")
    .select("id, tenant_id, business_name, package_tier, booking_mode, active");

  if (targetClientId) clientQuery = clientQuery.eq("id", targetClientId);
  if (targetClientIds.length > 0) clientQuery = clientQuery.in("id", targetClientIds);
  if (targetTenantIds.length > 0) clientQuery = clientQuery.in("tenant_id", targetTenantIds);

  const { data: clients, error: clientsError } = await clientQuery;
  if (clientsError) return jsonResponse({ error: clientsError.message }, 500);

  const results: Json[] = [];

  for (const client of clients ?? []) {
    if ((client as Json).active === false) continue;
    const clientId = String((client as Json).id);

    const [{ count: leadsCount }, { count: bookedCount }, { count: callsCount }, { count: callbackCount }] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("client_id", clientId).gte("created_at", start).lt("created_at", end),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("status", "booked").gte("created_at", start).lt("created_at", end),
      supabase.from("calls").select("id", { count: "exact", head: true }).eq("client_id", clientId).gte("created_at", start).lt("created_at", end),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("status", "callback").gte("created_at", start).lt("created_at", end),
    ]);

    results.push({
      client_id: clientId,
      tenant_id: (client as Json).tenant_id,
      business_name: (client as Json).business_name,
      package_tier: (client as Json).package_tier,
      booking_mode: (client as Json).booking_mode,
      day_key: dayKey,
      calls_today: callsCount ?? 0,
      leads_today: leadsCount ?? 0,
      booked_today: bookedCount ?? 0,
      callback_required_today: callbackCount ?? 0,
    });
  }

  return jsonResponse({
    ok: true,
    day_key: dayKey,
    start,
    end,
    results,
  });
});
