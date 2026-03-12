import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@5.9.6";

type Json = Record<string, unknown>;

type SheetProvisionResult = {
  spreadsheetId: string;
  routeCreated: boolean;
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

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getPackageTier(value: unknown): "pilot" | "full_service" {
  return value === "full_service" ? "full_service" : "pilot";
}

function buildFeatureFlags(packageTier: "pilot" | "full_service", overrides: unknown): Json {
  const base = packageTier === "full_service"
    ? {
        calendar_enabled: true,
        sms_enabled: true,
        reminders_enabled: true,
        outbound_followups_enabled: true,
        google_sheets_enabled: true,
        monthly_reports_enabled: true,
      }
    : {
        calendar_enabled: false,
        sms_enabled: false,
        reminders_enabled: false,
        outbound_followups_enabled: false,
        google_sheets_enabled: true,
        monthly_reports_enabled: true,
      };

  return overrides && typeof overrides === "object"
    ? { ...base, ...(overrides as Json) }
    : base;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function truncateAssistantName(value: string): string {
  return `Desk ${value}`.slice(0, 40);
}

function shouldProvisionDedicatedAssistant(value: unknown): boolean {
  return value === true;
}

function getSharedAssistantId(packageTier: "pilot" | "full_service"): string | null {
  const tierSpecific = packageTier === "full_service"
    ? Deno.env.get("VAPI_SHARED_ASSISTANT_ID_FULL_SERVICE")
    : Deno.env.get("VAPI_SHARED_ASSISTANT_ID_PILOT");
  const fallback = Deno.env.get("VAPI_ASSISTANT_ID");
  const selected = tierSpecific || fallback;
  return selected && selected.trim().length > 0 ? selected.trim() : null;
}

async function getGoogleAccessToken(): Promise<string | null> {
  const oauthClientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const oauthClientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const oauthRefreshToken = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");

  if (oauthClientId && oauthClientSecret && oauthRefreshToken) {
    const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauthClientId,
        client_secret: oauthClientSecret,
        refresh_token: oauthRefreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!refreshResponse.ok) {
      const text = await refreshResponse.text();
      throw new Error(`Failed to refresh Google OAuth token (${refreshResponse.status}): ${text}`);
    }

    const refreshed = await refreshResponse.json();
    const refreshedToken = getString(refreshed.access_token);
    if (refreshedToken) return refreshedToken;
  }

  const clientEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKeyB64 = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64");
  const privateKeyRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  const privateKey = privateKeyB64
    ? atob(privateKeyB64)
    : privateKeyRaw?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) return null;

  const algorithm = "RS256";
  const key = await importPKCS8(privateKey, algorithm);
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets",
  })
    .setProtectedHeader({ alg: algorithm, typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get Google access token (${response.status})`);
  }

  const json = await response.json();
  return getString(json.access_token);
}

async function copyTemplateSpreadsheet(templateId: string, title: string): Promise<string> {
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) throw new Error("Google credentials are not configured.");

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${templateId}/copy?supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: title }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to copy Google Sheet (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  const spreadsheetId = getString(json.id);
  if (!spreadsheetId) throw new Error("Google copy response did not include a spreadsheet id.");
  return spreadsheetId;
}

async function createTenant(
  supabase: ReturnType<typeof createClient>,
  businessName: string,
  packageTier: "pilot" | "full_service",
): Promise<string> {
  const baseSlug = slugify(businessName) || "tenant";
  const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;

  const { data, error } = await supabase
    .from("tenants")
    .insert({
      name: businessName,
      slug,
      package_tier: packageTier,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? "Failed to create tenant");
  }

  return data.id as string;
}

async function provisionTenantSheet(
  supabase: ReturnType<typeof createClient>,
  client: Json,
  requestedSheetId: string | null,
): Promise<SheetProvisionResult | null> {
  const webhookUrl = Deno.env.get("GOOGLE_SHEETS_WEBHOOK_URL");
  const webhookBearer = Deno.env.get("GOOGLE_SHEETS_WEBHOOK_BEARER");
  const defaultTab = Deno.env.get("GOOGLE_SHEETS_DEFAULT_TAB") ?? "New Leads";
  const templateId = getString(client.google_sheet_template_id) ?? Deno.env.get("GOOGLE_SHEETS_TEMPLATE_ID");

  if (!webhookUrl) return null;

  let spreadsheetId = requestedSheetId;
  if (!spreadsheetId && templateId) {
    spreadsheetId = await copyTemplateSpreadsheet(templateId, `${client.business_name} Dashboard`);
  }

  if (!spreadsheetId) return null;

  const { error: clientUpdateError } = await supabase
    .from("clients")
    .update({ google_sheet_id: spreadsheetId })
    .eq("id", client.id);

  if (clientUpdateError) throw new Error(clientUpdateError.message);

  const { error: routeError } = await supabase
    .from("client_sheet_routes")
    .upsert({
      client_id: client.id,
      tenant_id: client.tenant_id,
      webhook_url: webhookUrl,
      webhook_bearer: webhookBearer,
      spreadsheet_id: spreadsheetId,
      tab_name: defaultTab,
      active: true,
    }, { onConflict: "client_id" });

  if (routeError) throw new Error(routeError.message);

  return { spreadsheetId, routeCreated: true };
}

async function createDedicatedAssistant(args: {
  supabaseUrl: string;
  vapiApiKey: string;
  voiceId: string | undefined;
  toolServiceability: string | undefined;
  toolAvailability: string | undefined;
  toolLead: string | undefined;
  structuredOutputId: string | undefined;
  client: Json;
  tenantId: string;
  packageTier: "pilot" | "full_service";
  bookingMode: string;
  featureFlags: Json;
}): Promise<string> {
  const systemPrompt = `You are the professional receptionist for ${args.client.business_name}. Service areas: ${JSON.stringify(args.client.service_area_json)}. Services: ${JSON.stringify(args.client.services_json)}. Business hours: ${JSON.stringify(args.client.hours_json)}. Emergency enabled: ${args.client.emergency_enabled}. Booking mode: ${args.bookingMode}. Package tier: ${args.packageTier}. Feature flags: ${JSON.stringify(args.featureFlags)}. Booking rules: ${JSON.stringify(args.client.booking_rules_json)}. Always collect name, phone, service address, issue description, urgency, and preferred appointment time.`;

  const assistantPayload = {
    name: truncateAssistantName(String(args.client.business_name ?? "Plumbing Desk")),
    firstMessage: `Thanks for calling ${args.client.business_name}. How can I help you today?`,
    server: {
      url: `${args.supabaseUrl}/functions/v1/vapi-events`,
    },
    model: {
      provider: "openai",
      model: "gpt-4o",
      toolIds: [args.toolServiceability, args.toolAvailability, args.toolLead].filter(Boolean),
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
      ],
    },
    voice: {
      provider: "vapi",
      voiceId: args.voiceId,
    },
    artifactPlan: {
      structuredOutputIds: args.structuredOutputId ? [args.structuredOutputId] : [],
    },
    metadata: {
      client_id: args.client.id,
      tenant_id: args.client.tenant_id ?? args.tenantId,
      package_tier: args.packageTier,
      booking_mode: args.bookingMode,
    },
  };

  const assistantRes = await fetch("https://api.vapi.ai/assistant", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.vapiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(assistantPayload),
  });

  const assistantJson = await assistantRes.json();
  if (!assistantRes.ok || !getString(assistantJson.id)) {
    throw new Error(JSON.stringify(assistantJson));
  }

  return String(assistantJson.id);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapiApiKey = Deno.env.get("VAPI_API_KEY");
  const voiceId = Deno.env.get("VAPI_VOICE_ID");
  const toolServiceability = Deno.env.get("VAPI_TOOL_ID_CHECK_SERVICEABILITY");
  const toolAvailability = Deno.env.get("VAPI_TOOL_ID_CHECK_AVAILABILITY");
  const toolLead = Deno.env.get("VAPI_TOOL_ID_CREATE_LEAD_OR_BOOKING");
  const structuredOutputId = Deno.env.get("VAPI_STRUCTURED_OUTPUT_ID_PLUMBING_CALL");

  if (!supabaseUrl || !serviceRoleKey || !vapiApiKey) {
    return jsonResponse({ error: "Missing required environment variables." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let body: Json = {};
  try {
    body = (await req.json()) as Json;
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  const cities = Array.isArray(body.cities) ? body.cities : [];
  const zips = Array.isArray(body.zips) ? body.zips : [];
  const services = Array.isArray(body.services) ? body.services : [];
  const packageTier = getPackageTier(body.package_tier);
  const featureFlags = buildFeatureFlags(packageTier, body.feature_flags_json);
  const serviceArea = [
    ...cities.map((city) => ({ city: String(city) })),
    ...zips.map((zip) => ({ zip: String(zip) })),
  ];

  const businessName = getString(body.business_name);
  if (!businessName) {
    return jsonResponse({ error: "business_name is required" }, 400);
  }

  const tenantId = await createTenant(supabase, businessName, packageTier);

  const insertPayload = {
    tenant_id: tenantId,
    business_name: businessName,
    owner_name: getString(body.owner_name),
    contact_email: getString(body.contact_email),
    contact_phone: getString(body.contact_phone),
    email: getString(body.contact_email),
    phone: getString(body.contact_phone),
    notification_sms: getString(body.notification_sms),
    notification_email: getString(body.notification_email),
    service_area_json: serviceArea,
    services_json: services,
    hours_json: body.hours_json && typeof body.hours_json === "object" ? body.hours_json : {},
    emergency_enabled: body.emergency_enabled === true,
    same_day_allowed: body.same_day_allowed === true,
    urgent_alert_phone: getString(body.urgent_alert_phone),
    reports_email: getString(body.reports_email),
    booking_mode: body.booking_mode === "calendar_direct" ? "calendar_direct" : "request_only",
    package_tier: packageTier,
    feature_flags_json: featureFlags,
    booking_rules_json: body.booking_rules_json && typeof body.booking_rules_json === "object" ? body.booking_rules_json : {},
    google_sheet_id: getString(body.google_sheet_id),
    google_sheet_template_id: getString(body.google_sheet_template_id),
  };

  const { data: client, error } = await supabase
    .from("clients")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error || !client) {
    return jsonResponse({ error: error?.message ?? "Failed to create client" }, 500);
  }

  let sheetProvision: SheetProvisionResult | null = null;
  let sheetWarning: string | null = null;
  try {
    sheetProvision = await provisionTenantSheet(supabase, client as Json, insertPayload.google_sheet_id);
  } catch (sheetError) {
    sheetWarning = sheetError instanceof Error ? sheetError.message : "Sheet provisioning failed.";
  }

  let followupWarning: string | null = null;
  if ((featureFlags.outbound_followups_enabled === true) && client.tenant_id) {
    const followupSeed = await supabase.rpc("seed_default_followup_rules", {
      p_tenant_id: client.tenant_id,
    });
    if (followupSeed.error) {
      followupWarning = followupSeed.error.message;
    }
  }

  const bookingMode = String(client.booking_mode ?? insertPayload.booking_mode);
  const provisionDedicatedAssistant = shouldProvisionDedicatedAssistant(body.provision_dedicated_assistant);
  let assistantId = getSharedAssistantId(packageTier);
  let assistantMode: "shared" | "dedicated" = "shared";
  let assistantWarning: string | null = null;

  if (!assistantId || provisionDedicatedAssistant) {
    try {
      assistantId = await createDedicatedAssistant({
        supabaseUrl,
        vapiApiKey,
        voiceId,
        toolServiceability,
        toolAvailability,
        toolLead,
        structuredOutputId,
        client: client as Json,
        tenantId,
        packageTier,
        bookingMode,
        featureFlags: (client.feature_flags_json as Json) ?? featureFlags,
      });
      assistantMode = "dedicated";
    } catch (assistantError) {
      return jsonResponse({
        error: "Client created but Vapi assistant binding failed.",
        client,
        assistant_mode: provisionDedicatedAssistant ? "dedicated_requested" : "shared_fallback_to_dedicated",
        vapi: assistantError instanceof Error ? assistantError.message : "Unknown assistant error",
        sheet_warning: sheetWarning,
      }, 500);
    }
  } else {
    assistantWarning = "Shared assistant assigned. Runtime client resolution still depends on per-number metadata or explicit client_id injection.";
  }

  await supabase
    .from("clients")
    .update({ vapi_assistant_id: assistantId })
    .eq("id", client.id);

  return jsonResponse({
    ok: true,
    client_id: client.id,
    tenant_id: client.tenant_id ?? tenantId,
    package_tier: client.package_tier ?? packageTier,
    feature_flags_json: client.feature_flags_json ?? featureFlags,
    vapi_assistant_id: assistantId,
    assistant_mode: assistantMode,
    assistant_warning: assistantWarning,
    google_sheet_id: sheetProvision?.spreadsheetId ?? client.google_sheet_id ?? null,
    client_sheet_route_created: sheetProvision?.routeCreated ?? false,
    sheet_warning: sheetWarning,
    followup_warning: followupWarning,
    next_step: assistantMode === "shared"
      ? "Assign the business phone number to the shared assistant and make sure the number injects client_id/tenant_id at runtime."
      : "Assign or create a Vapi phone number and connect it to this dedicated assistant.",
  });
});


