import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

type ClientRow = {
  id: string;
  booking_rules_json: Json | null;
};

type SheetRoute = {
  webhook_url: string;
  webhook_bearer: string | null;
  spreadsheet_id: string;
};

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

function monthKeyFrom(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(monthKey: string): { start: string; end: string } {
  const start = `${monthKey}-01T00:00:00.000Z`;
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { start, end: next.toISOString() };
}

function parseRevenueRules(rules: Json | null): { map: Record<string, number>; defaultValue: number } {
  const raw = (rules ?? {}) as Json;
  const rawMap = raw.revenue_by_job_type;
  const map: Record<string, number> = {};

  if (rawMap && typeof rawMap === "object") {
    for (const [key, value] of Object.entries(rawMap as Record<string, unknown>)) {
      const amount = Number(value);
      if (!Number.isNaN(amount)) map[key.trim().toLowerCase()] = amount;
    }
  }

  const defaultValue = Number(raw.default_job_value ?? 250);
  return { map, defaultValue: Number.isNaN(defaultValue) ? 250 : defaultValue };
}

async function getSheetRoute(
  supabase: ReturnType<typeof createClient>,
  clientId: string,
): Promise<SheetRoute | null> {
  const { data, error } = await supabase
    .from("client_sheet_routes")
    .select("webhook_url, webhook_bearer, spreadsheet_id, active")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!error && data && data.active !== false) {
    return {
      webhook_url: String(data.webhook_url),
      webhook_bearer: data.webhook_bearer ? String(data.webhook_bearer) : null,
      spreadsheet_id: String(data.spreadsheet_id),
    };
  }

  const webhookUrl = Deno.env.get("GOOGLE_SHEETS_WEBHOOK_URL");
  const spreadsheetId = Deno.env.get("GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID");
  if (!webhookUrl || !spreadsheetId) return null;

  return {
    webhook_url: webhookUrl,
    webhook_bearer: Deno.env.get("GOOGLE_SHEETS_WEBHOOK_BEARER"),
    spreadsheet_id: spreadsheetId,
  };
}

async function appendMonthlyRow(
  route: SheetRoute,
  monthTimestamp: string,
  calls: number,
  leads: number,
  bookings: number,
  revenue: number,
): Promise<void> {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (route.webhook_bearer) headers.Authorization = `Bearer ${route.webhook_bearer}`;

  const webhookUrl = route.webhook_bearer
    ? `${route.webhook_url}${route.webhook_url.includes("?") ? "&" : "?"}auth=${encodeURIComponent(route.webhook_bearer)}`
    : route.webhook_url;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      spreadsheet_id: route.spreadsheet_id,
      tab_name: "Monthly Report",
      row: {
        Month: monthTimestamp,
        Calls: String(calls),
        Leads: String(leads),
        Bookings: String(bookings),
        "Est Revenue": String(revenue),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Sheets webhook failed with status ${response.status}`);
  }
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

  const force = payload.force === true;
  const targetClientId = typeof payload.client_id === "string" ? payload.client_id : null;
  const now = new Date();
  const reportDate = now.toISOString().slice(0, 10);
  const monthKey = monthKeyFrom(now);
  const range = monthRange(monthKey);

  const clientQuery = supabase.from("clients").select("id, booking_rules_json");
  const { data: clients, error: clientsError } = targetClientId
    ? await clientQuery.eq("id", targetClientId)
    : await clientQuery;

  if (clientsError) return jsonResponse({ error: clientsError.message }, 500);

  const results: Json[] = [];

  for (const client of (clients as ClientRow[])) {
    const clientId = client.id;

    if (!force) {
      const { data: existingRun } = await supabase
        .from("client_monthly_report_runs")
        .select("id")
        .eq("client_id", clientId)
        .eq("month_key", monthKey)
        .eq("report_date", reportDate)
        .maybeSingle();

      if (existingRun?.id) {
        results.push({ client_id: clientId, skipped: true, reason: "already-synced-today" });
        continue;
      }
    }

    const [{ count: callsCount }, { count: leadsCount }, { data: bookedRows }, { data: callRows }] = await Promise.all([
      supabase.from("calls").select("id", { count: "exact", head: true }).eq("client_id", clientId).gte("call_start", range.start).lt("call_start", range.end),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("client_id", clientId).gte("created_at", range.start).lt("created_at", range.end),
      supabase.from("leads").select("service_type").eq("client_id", clientId).eq("status", "booked").gte("created_at", range.start).lt("created_at", range.end),
      supabase.from("calls").select("duration_seconds").eq("client_id", clientId).gte("call_start", range.start).lt("call_start", range.end),
    ]);

    const rules = parseRevenueRules(client.booking_rules_json);
    const bookings = (bookedRows ?? []).length;
    const revenue = (bookedRows ?? []).reduce((sum, row) => {
      const serviceType = String((row as Json).service_type ?? "").trim().toLowerCase();
      return sum + (rules.map[serviceType] ?? rules.defaultValue);
    }, 0);

    const totalSeconds = (callRows ?? []).reduce((sum, row) => {
      const duration = Number((row as Json).duration_seconds ?? 0);
      return sum + (Number.isFinite(duration) ? duration : 0);
    }, 0);

    const minutesUsed = totalSeconds / 60;
    const estimatedCost = minutesUsed * Number(Deno.env.get("CALL_COST_PER_MINUTE") ?? "0.15");
    const invoiceAmount = estimatedCost * Number(Deno.env.get("INVOICE_MULTIPLIER") ?? "1.0");

    await supabase.from("monthly_usage").upsert({
      client_id: clientId,
      month_key: monthKey,
      month: monthKey,
      total_calls: callsCount ?? 0,
      qualified_leads: leadsCount ?? 0,
      booked_jobs: bookings,
      minutes_used: minutesUsed,
      estimated_cost: estimatedCost,
      invoice_amount: invoiceAmount,
    }, { onConflict: "client_id,month" });

    const route = await getSheetRoute(supabase, clientId);
    let syncMessage = "No active Google Sheets route for client.";
    let synced = false;

    if (route) {
      await appendMonthlyRow(route, `${monthKey}-01T00:00:00.000Z`, callsCount ?? 0, leadsCount ?? 0, bookings, revenue);
      syncMessage = "Monthly Report MTD row appended.";
      synced = true;
    }

    await supabase.from("client_monthly_report_runs").upsert({
      client_id: clientId,
      month_key: monthKey,
      report_date: reportDate,
      calls: callsCount ?? 0,
      leads: leadsCount ?? 0,
      bookings,
      est_revenue: revenue,
      synced,
      message: syncMessage,
    }, { onConflict: "client_id,month_key,report_date" });

    results.push({
      client_id: clientId,
      synced,
      calls: callsCount ?? 0,
      leads: leadsCount ?? 0,
      bookings,
      est_revenue: revenue,
      message: syncMessage,
    });
  }

  return jsonResponse({ success: true, month_key: monthKey, report_date: reportDate, results });
});
