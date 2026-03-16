import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@5.9.6";

type Json = Record<string, unknown>;

type SheetProvisionResult = {
  spreadsheetId: string;
  routeCreated: boolean;
};

type ServiceCatalogEntry = {
  id: string;
  service_key: string;
  service_name: string;
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

function getStringFrom(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const json = obj as Json;
  for (const key of keys) {
    const value = json[key];
    const result = getString(value);
    if (result) return result;
  }
  return null;
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

function monthKeyFrom(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function truncateAssistantName(value: string): string {
  return `Desk ${value}`.slice(0, 40);
}

function shouldProvisionDedicatedAssistant(value: unknown): boolean {
  return value === true;
}

function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function normalizeServiceKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function titleizeService(value: string): string {
  return value
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatServiceAreaText(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "not yet specified";
  const parts = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Json;
    const city = getStringFrom(item, ["city"]);
    const county = getStringFrom(item, ["county"]);
    const zip = getStringFrom(item, ["zip_code", "zip"]);
    if (city && county) return [`${city}, ${county} County`];
    if (city && zip) return [`${city} (${zip})`];
    if (city) return [city];
    if (county) return [`${county} County`];
    if (zip) return [`ZIP ${zip}`];
    return [];
  });
  return parts.length ? parts.join(", ") : "not yet specified";
}

function formatServicesText(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "general plumbing service";
  const services = value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  return services.length ? services.join(", ") : "general plumbing service";
}

function formatHoursText(value: unknown): string {
  if (!value || typeof value !== "object") return "not yet specified";
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const labels: Record<string, string> = {
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun",
  };
  const json = value as Json;
  const parts = order
    .map((key) => {
      const raw = getStringFrom(json, [key]);
      return raw ? `${labels[key]} ${raw}` : null;
    })
    .filter(Boolean);
  return parts.length ? parts.join("; ") : "not yet specified";
}

function formatBookingRulesText(value: unknown): string {
  if (!value || typeof value !== "object") return "Follow business rules and collect a callback window when uncertain.";
  const rules = value as Json;
  const fragments: string[] = [];
  const sameDay = rules.same_day_allowed === true ? "same-day allowed" : rules.same_day_allowed === false ? "same-day not allowed" : null;
  if (sameDay) fragments.push(sameDay);

  if (Array.isArray(rules.default_slots) && rules.default_slots.length > 0) {
    const slots = rules.default_slots
      .map((slot) => {
        if (!slot || typeof slot !== "object") return null;
        const slotJson = slot as Json;
        const label = getStringFrom(slotJson, ["label"]);
        const date = getStringFrom(slotJson, ["date"]);
        const time = getStringFrom(slotJson, ["time"]);
        return [label, date, time].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    if (slots.length) fragments.push(`default windows: ${slots.join(", ")}`);
  }

  const defaultJobValue = rules.default_job_value;
  if (typeof defaultJobValue === "number") {
    fragments.push(`default job value ${defaultJobValue}`);
  }

  return fragments.length
    ? fragments.join("; ")
    : "Follow business rules and collect a callback window when uncertain.";
}

function buildReceptionistPrompt(args: {
  businessName: string;
  hoursText: string;
  serviceAreaText: string;
  servicesText: string;
  bookingRulesText: string;
  bookingMode: string;
  emergencyEnabled: boolean;
}): string {
  return [
    `You are a professional receptionist for a plumbing company named ${args.businessName}.`,
    `Hours of operation are ${args.hoursText}.`,
    `Service area for ${args.businessName} is ${args.serviceAreaText}.`,
    `Services commonly offered are ${args.servicesText}.`,
    `Emergency service is ${args.emergencyEnabled ? "enabled" : "disabled"}.`,
    `Scheduling and callback rules are: ${args.bookingRulesText}.`,
    `Current booking mode is ${args.bookingMode}.`,
    "Your job is to answer incoming calls from potential customers, understand their plumbing issue, determine urgency, collect customer information, and help schedule service appointments when possible.",
    "Always remain calm, polite, efficient, and grounded in the business information you have been given.",
    "Your goals are to identify the plumbing issue, determine urgency, collect caller details, capture service location, determine service eligibility, schedule an appointment if possible, and log the call outcome truthfully.",
    "Never diagnose plumbing problems or give repair instructions.",
    "Never quote prices unless pricing has been explicitly provided by the business.",
    "If the caller describes active flooding, burst pipes, sewer backup, or major leaks, classify the issue as HIGH URGENCY.",
    "If the caller is outside the service area, politely explain that the company may not serve that location.",
    "If scheduling is not possible, collect preferred appointment times and treat the outcome as callback required.",
    "Always confirm the caller's name, phone number, service address, issue, and next step before ending the call.",
    "Required information to gather before closing whenever possible: caller name, phone number, service address, description of problem, urgency level, requested service type, and preferred appointment time.",
    "Default conversation flow: greeting, qualification, urgency check, information collection, scheduling or callback, confirmation, and closing.",
    "Example phrasing: 'Thank you for calling {{business_name}}, how can I help you today?', 'What seems to be the plumbing issue you're experiencing?', 'Is water currently leaking or causing damage?', 'May I get your name and the address where the service is needed?', 'The next available appointment windows are tomorrow morning or tomorrow afternoon. Which works better?', 'Just to confirm, I have you at [address] for [issue] at [time]. Is that correct?', 'Great. We'll send this request to the plumber and they'll confirm shortly.'",
    "Edge cases to handle carefully: out-of-area, unsupported service, caller refuses the service address, caller only wants a price quote, caller is calling for another property, repeat caller checking status, caller is too upset to finish intake, or no scheduling slots are available.",
    "Do not hallucinate. Use callback_required or the closest truthful outcome and gather as much usable information as possible.",
    "Use the available tools whenever you need to check serviceability, check availability, or create the lead or booking record.",
  ].join(" ");
}

function buildSharedAssistantVariableValues(client: Json, tenantId: string): Json {
  return {
    tenant_id: getStringFrom(client, ["tenant_id"]) ?? tenantId,
    client_id: getStringFrom(client, ["id"]),
    business_name: getStringFrom(client, ["business_name"]) ?? "Plumbing company",
    hours_text: formatHoursText(client.hours_json),
    service_area_text: formatServiceAreaText(client.service_area_json),
    services_text: formatServicesText(client.services_json),
    booking_rules_text: formatBookingRulesText(client.booking_rules_json),
    emergency_service_text: client.emergency_enabled === true ? "enabled" : "disabled",
  };
}

async function syncTenantSettings(
  supabase: ReturnType<typeof createClient>,
  args: {
    tenantId: string;
    businessName: string;
    phone: string | null;
    email: string | null;
    emergencyEnabled: boolean;
    sameDayService: boolean;
    hoursJson: Json;
  },
): Promise<void> {
  const { error } = await supabase
    .from("tenants")
    .update({
      name: args.businessName,
      business_name: args.businessName,
      phone: args.phone,
      email: args.email,
      emergency_enabled: args.emergencyEnabled,
      same_day_service: args.sameDayService,
      hours_json: args.hoursJson,
    })
    .eq("id", args.tenantId);

  if (error) throw new Error(error.message);
}

async function syncPhoneNumberMapping(
  supabase: ReturnType<typeof createClient>,
  args: {
    tenantId: string;
    clientId: string;
    number: string | null;
    vapiPhoneNumberId: string | null;
    active: boolean;
  },
): Promise<void> {
  if (!args.number && !args.vapiPhoneNumberId) return;

  const normalizedNumber = normalizePhone(args.number);
  const { error } = await supabase
    .from("phone_numbers")
    .upsert({
      tenant_id: args.tenantId,
      client_id: args.clientId,
      number: normalizedNumber,
      vapi_phone_number_id: args.vapiPhoneNumberId,
      active: args.active,
    }, { onConflict: normalizedNumber ? "number" : "vapi_phone_number_id" });

  if (error) throw new Error(error.message);
}

async function syncTenantServiceCatalog(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  services: string[],
): Promise<Array<{ service_key: string; service_name: string }>> {
  const cleanedServices = services
    .map((service) => String(service ?? "").trim())
    .filter(Boolean);

  if (cleanedServices.length === 0) return [];

  const catalogUpserts = cleanedServices.map((service) => ({
    service_key: normalizeServiceKey(service),
    service_name: titleizeService(service),
    category: "general",
    emergency_possible: false,
    active: true,
  }));

  const upsertCatalog = await supabase
    .from("service_catalog")
    .upsert(catalogUpserts, { onConflict: "service_key" })
    .select("id, service_key, service_name");

  if (upsertCatalog.error) throw new Error(upsertCatalog.error.message);

  const catalogEntries = Array.isArray(upsertCatalog.data)
    ? upsertCatalog.data as ServiceCatalogEntry[]
    : [];

  if (catalogEntries.length === 0) return [];

  const mappedRows = catalogEntries.map((entry, index) => ({
    tenant_id: tenantId,
    service_id: entry.id,
    enabled: true,
    priority: index + 1,
  }));

  const upsertMappings = await supabase
    .from("tenant_services")
    .upsert(mappedRows, { onConflict: "tenant_id,service_id" });

  if (upsertMappings.error) throw new Error(upsertMappings.error.message);

  return catalogEntries.map((entry) => ({
    service_key: entry.service_key,
    service_name: entry.service_name,
  }));
}

async function syncTenantServiceAreas(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  serviceArea: Array<Record<string, string>>,
): Promise<void> {
  if (serviceArea.length === 0) return;

  const upserts = serviceArea.map((entry) => ({
    tenant_id: tenantId,
    county: getStringFrom(entry, ["county"]),
    city: getStringFrom(entry, ["city"]),
    zip_code: getStringFrom(entry, ["zip_code", "zip"]),
    active: true,
  }));

  const { error } = await supabase
    .from("tenant_service_areas")
    .insert(upserts);

  if (error) throw new Error(error.message);
}

async function seedMonthlyUsage(
  supabase: ReturnType<typeof createClient>,
  args: {
    tenantId: string;
    clientId: string;
  },
): Promise<void> {
  const monthKey = monthKeyFrom();
  const { error } = await supabase
    .from("monthly_usage")
    .upsert({
      tenant_id: args.tenantId,
      client_id: args.clientId,
      month_key: monthKey,
      month: monthKey,
      total_calls: 0,
      qualified_leads: 0,
      booked_jobs: 0,
      minutes_used: 0,
      estimated_cost: 0,
      invoice_amount: 0,
    }, { onConflict: "client_id,month" });

  if (error) throw new Error(error.message);
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
  voiceConfig: Json;
  toolServiceability: string | undefined;
  toolAvailability: string | undefined;
  toolLead: string | undefined;
  structuredOutputId: string | undefined;
  client: Json;
  tenantId: string;
  packageTier: "pilot" | "full_service";
  bookingMode: string;
  featureFlags: Json;
  emergencyEnabled: boolean;
}): Promise<string> {
  const systemPrompt = buildReceptionistPrompt({
    businessName: String(args.client.business_name ?? "the plumbing company"),
    hoursText: formatHoursText(args.client.hours_json),
    serviceAreaText: formatServiceAreaText(args.client.service_area_json),
    servicesText: formatServicesText(args.client.services_json),
    bookingRulesText: formatBookingRulesText(args.client.booking_rules_json),
    bookingMode: args.bookingMode.replace(/_/g, " "),
    emergencyEnabled: args.emergencyEnabled,
  });

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
    voice: args.voiceConfig,
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
  const voiceProvider = Deno.env.get("VAPI_VOICE_PROVIDER") ?? "vapi";
  const voiceModel = Deno.env.get("VAPI_VOICE_MODEL");
  const fallbackVoiceId = Deno.env.get("VAPI_FALLBACK_VOICE_ID");
  const fallbackVoiceProvider = Deno.env.get("VAPI_FALLBACK_VOICE_PROVIDER") ?? "vapi";
  const toolServiceability = Deno.env.get("VAPI_TOOL_ID_CHECK_SERVICEABILITY");
  const toolAvailability = Deno.env.get("VAPI_TOOL_ID_CHECK_AVAILABILITY");
  const toolLead = Deno.env.get("VAPI_TOOL_ID_CREATE_LEAD_OR_BOOKING");
  const structuredOutputId = Deno.env.get("VAPI_STRUCTURED_OUTPUT_ID_PLUMBING_CALL");

  if (!supabaseUrl || !serviceRoleKey || !vapiApiKey) {
    return jsonResponse({ error: "Missing required environment variables." }, 500);
  }

  const voiceConfig: Json = {
    provider: voiceProvider,
    voiceId,
  };
  if (voiceModel) voiceConfig.model = voiceModel;
  if (voiceProvider === "11labs") {
    voiceConfig.stability = 0.5;
    voiceConfig.similarityBoost = 0.75;
  }
  if (fallbackVoiceId) {
    voiceConfig.fallbackPlan = {
      voices: [
        {
          provider: fallbackVoiceProvider,
          voiceId: fallbackVoiceId,
        },
      ],
    };
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
  const counties = Array.isArray(body.counties) ? body.counties : [];
  const zips = Array.isArray(body.zips) ? body.zips : [];
  const services = Array.isArray(body.services) ? body.services.map((service) => String(service)) : [];
  const packageTier = getPackageTier(body.package_tier);
  const featureFlags = buildFeatureFlags(packageTier, body.feature_flags_json);
  const hoursJson = body.hours_json && typeof body.hours_json === "object" ? body.hours_json as Json : {};
  const emergencyEnabled = body.emergency_enabled === true;
  const sameDayAllowed = body.same_day_allowed === true;
  const serviceArea = [
    ...cities.map((city) => ({ city: String(city) })),
    ...counties.map((county) => ({ county: String(county) })),
    ...zips.map((zip) => ({ zip_code: String(zip) })),
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
    hours_json: hoursJson,
    emergency_enabled: emergencyEnabled,
    same_day_allowed: sameDayAllowed,
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

  try {
    await syncTenantSettings(supabase, {
      tenantId,
      businessName,
      phone: insertPayload.phone,
      email: insertPayload.email,
      emergencyEnabled,
      sameDayService: sameDayAllowed,
      hoursJson,
    });
    await syncTenantServiceCatalog(supabase, tenantId, services);
    await syncTenantServiceAreas(supabase, tenantId, serviceArea);
    await syncPhoneNumberMapping(supabase, {
      tenantId,
      clientId: String(client.id),
      number: insertPayload.phone,
      vapiPhoneNumberId: getString(body.vapi_phone_number_id),
      active: true,
    });
    await seedMonthlyUsage(supabase, {
      tenantId,
      clientId: String(client.id),
    });
  } catch (syncError) {
    return jsonResponse({
      error: "Client created but tenant service mappings failed.",
      client,
      detail: syncError instanceof Error ? syncError.message : "Unknown sync error",
    }, 500);
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
        voiceConfig,
        toolServiceability,
        toolAvailability,
        toolLead,
        structuredOutputId,
        client: client as Json,
        tenantId,
        packageTier,
        bookingMode,
        featureFlags: (client.feature_flags_json as Json) ?? featureFlags,
        emergencyEnabled,
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

  const runtimeVariableValues = buildSharedAssistantVariableValues(client as Json, tenantId);

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
    shared_assistant_runtime_variables: runtimeVariableValues,
    sheet_warning: sheetWarning,
    followup_warning: followupWarning,
    next_step: assistantMode === "shared"
      ? "Assign the business phone number to the shared assistant and inject the returned shared_assistant_runtime_variables at runtime."
      : "Assign or create a Vapi phone number and connect it to this dedicated assistant.",
  });
});


