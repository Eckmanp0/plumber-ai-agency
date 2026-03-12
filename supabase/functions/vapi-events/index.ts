import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

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

function monthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getString(obj: Json, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function asJson(value: unknown): Json {
  return value && typeof value === "object" ? value as Json : {};
}

function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

async function resolveClientContext(args: {
  supabase: ReturnType<typeof createClient>;
  payload: Json;
  messageJson: Json;
  callJson: Json;
  assistantMetadata: Json;
  callAssistantMetadata: Json;
  vapiCallId: string | null;
}): Promise<{ clientId: string | null; tenantId: string | null }> {
  const directClientId =
    getString(args.assistantMetadata, ["client_id"]) ??
    getString(args.callAssistantMetadata, ["client_id"]) ??
    getString(args.payload, ["client_id"]);
  const directTenantId =
    getString(args.assistantMetadata, ["tenant_id"]) ??
    getString(args.callAssistantMetadata, ["tenant_id"]) ??
    getString(args.payload, ["tenant_id"]);

  if (directClientId) {
    return { clientId: directClientId, tenantId: directTenantId };
  }

  const assistantOverrides = asJson(args.callJson.assistantOverrides);
  const variableValues = asJson(assistantOverrides.variableValues);
  const overrideClientId = getString(variableValues, ["client_id"]);
  const overrideTenantId = getString(variableValues, ["tenant_id"]);
  if (overrideClientId) {
    return { clientId: overrideClientId, tenantId: overrideTenantId ?? directTenantId };
  }

  const assistantJson = asJson(args.messageJson.assistant);
  const assistantVariableValues = asJson(assistantJson.variableValues);
  const assistantOverrideClientId = getString(assistantVariableValues, ["client_id"]);
  const assistantOverrideTenantId = getString(assistantVariableValues, ["tenant_id"]);
  if (assistantOverrideClientId) {
    return { clientId: assistantOverrideClientId, tenantId: assistantOverrideTenantId ?? directTenantId };
  }

  const tenantIdCandidate = directTenantId ?? overrideTenantId ?? assistantOverrideTenantId;
  if (tenantIdCandidate) {
    const { data: clientByTenant } = await args.supabase
      .from("clients")
      .select("id, tenant_id")
      .eq("tenant_id", tenantIdCandidate)
      .limit(1)
      .maybeSingle();

    if (clientByTenant?.id) {
      return {
        clientId: String(clientByTenant.id),
        tenantId: clientByTenant.tenant_id ? String(clientByTenant.tenant_id) : tenantIdCandidate,
      };
    }
  }

  if (args.vapiCallId) {
    const { data: existingCall } = await args.supabase
      .from("calls")
      .select("client_id, tenant_id")
      .eq("vapi_call_id", args.vapiCallId)
      .maybeSingle();

    if (existingCall?.client_id) {
      return {
        clientId: String(existingCall.client_id),
        tenantId: existingCall.tenant_id ? String(existingCall.tenant_id) : directTenantId,
      };
    }
  }

  const phoneNumberId =
    getString(args.callJson, ["phoneNumberId", "phone_number_id"]) ??
    getString(asJson(args.callJson.phoneNumber), ["id"]) ??
    getString(asJson(args.callJson.customer), ["phoneNumberId", "phone_number_id"]) ??
    getString(asJson(args.payload.phoneNumber), ["id"]);

  if (phoneNumberId) {
    const { data: clientByNumber } = await args.supabase
      .from("clients")
      .select("id, tenant_id")
      .eq("vapi_phone_number_id", phoneNumberId)
      .maybeSingle();

    if (clientByNumber?.id) {
      return {
        clientId: String(clientByNumber.id),
        tenantId: clientByNumber.tenant_id ? String(clientByNumber.tenant_id) : null,
      };
    }
  }

  const toNumber =
    normalizePhone(getString(args.callJson, ["to", "toNumber"])) ??
    normalizePhone(getString(asJson(args.callJson.customer), ["to", "toNumber"])) ??
    normalizePhone(getString(asJson(args.payload.customer), ["to", "toNumber"]));

  if (toNumber) {
    const { data: matchingClients } = await args.supabase
      .from("clients")
      .select("id, tenant_id, phone, contact_phone")
      .or(`phone.eq.${toNumber},contact_phone.eq.${toNumber}`)
      .limit(1);

    const match = Array.isArray(matchingClients) ? matchingClients[0] : null;
    if (match?.id) {
      return {
        clientId: String(match.id),
        tenantId: match.tenant_id ? String(match.tenant_id) : null,
      };
    }
  }

  return { clientId: null, tenantId: directTenantId };
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

async function appendSheetRow(
  route: SheetRoute,
  tabName: string,
  row: Record<string, unknown>,
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
      tab_name: tabName,
      row,
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

  try {
    const body = await req.json();
    const payload = body && typeof body === "object" ? body as Json : {};
    const message = payload.message;
    if (!message || typeof message !== "object") return jsonResponse({ ok: true });

    const messageJson = message as Json;
    const messageType = getString(messageJson, ["type"]);
    const callJson = asJson(messageJson.call);
    const artifact = asJson(messageJson.artifact);
    const vapiCallId = getString(callJson, ["id"]);
    const assistantJson = asJson(messageJson.assistant);
    const assistantMetadata = asJson(assistantJson.metadata);
    const callAssistantJson = asJson(callJson.assistant);
    const callAssistantMetadata = asJson(callAssistantJson.metadata);
    const resolved = await resolveClientContext({
      supabase,
      payload,
      messageJson,
      callJson,
      assistantMetadata,
      callAssistantMetadata,
      vapiCallId,
    });
    const clientId = resolved.clientId;
    const tenantId = resolved.tenantId;

    if (!messageType || !vapiCallId) return jsonResponse({ ok: true });

    if (messageType === "status-update") {
      const status = getString(messageJson, ["status"]);
      if (status === "in-progress") {
        await supabase.from("calls").upsert({
          tenant_id: tenantId,
          client_id: clientId,
          vapi_call_id: vapiCallId,
          call_start: new Date().toISOString(),
          started_at: new Date().toISOString(),
          raw_event: payload,
        }, { onConflict: "vapi_call_id" });
      }

      if (status === "ended") {
        const endedAt = new Date().toISOString();
        await supabase
          .from("calls")
          .update({ tenant_id: tenantId, client_id: clientId, call_end: endedAt, ended_at: endedAt })
          .eq("vapi_call_id", vapiCallId);
      }

      return jsonResponse({ ok: true, client_id: clientId, tenant_id: tenantId });
    }

    if (messageType === "end-of-call-report") {
      const transcript = getString(artifact, ["transcript"]);
      const endedReason = getString(messageJson, ["endedReason"]);
      const recording = asJson(artifact.recording);
      const recordingUrl = getString(recording, ["stereoUrl", "monoUrl"]);
      const structuredOutputs = artifact.structuredOutputs && typeof artifact.structuredOutputs === "object"
        ? artifact.structuredOutputs as Json
        : {};

      let structuredResult: Json | null = null;
      let summary: string | null = null;
      const structuredKeys = Object.keys(structuredOutputs);
      if (structuredKeys.length > 0) {
        const firstOutput = structuredOutputs[structuredKeys[0]];
        if (firstOutput && typeof firstOutput === "object") {
          const result = (firstOutput as Json).result;
          if (result && typeof result === "object") {
            structuredResult = result as Json;
            const outcome = asJson(structuredResult.outcome);
            summary = getString(outcome, ["summary"]);
          }
        }
      }

      const endedAt = new Date().toISOString();
      await supabase.from("calls").upsert({
        tenant_id: tenantId,
        client_id: clientId,
        vapi_call_id: vapiCallId,
        call_end: endedAt,
        ended_at: endedAt,
        ended_reason: endedReason,
        transcript,
        summary,
        recording_url: recordingUrl,
        structured_output: structuredResult,
        raw_event: payload,
      }, { onConflict: "vapi_call_id" });

      if (clientId) {
        const currentMonth = monthKey();
        const { data: usage } = await supabase
          .from("monthly_usage")
          .select("id, total_calls")
          .eq("client_id", clientId)
          .eq("month_key", currentMonth)
          .maybeSingle();

        if (!usage?.id) {
          await supabase.from("monthly_usage").insert({
            tenant_id: tenantId,
            client_id: clientId,
            month_key: currentMonth,
            month: currentMonth,
            total_calls: 1,
          });
        } else {
          await supabase
            .from("monthly_usage")
            .update({ total_calls: Number(usage.total_calls ?? 0) + 1 })
            .eq("id", usage.id);
        }
      }

      if (clientId) {
        const route = await getSheetRoute(supabase, clientId);
        if (route) {
          const call = await supabase.from("calls").select("duration_seconds, call_outcome").eq("vapi_call_id", vapiCallId).maybeSingle();
          await appendSheetRow(route, "Call Logs", {
            Time: endedAt,
            Duration: String(call.data?.duration_seconds ?? 0),
            Outcome: String(call.data?.call_outcome ?? endedReason ?? "completed"),
            Summary: summary ?? "",
          });
        }
      }

      return jsonResponse({ ok: true, client_id: clientId, tenant_id: tenantId });
    }

    return jsonResponse({ ok: true, client_id: clientId, tenant_id: tenantId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});

