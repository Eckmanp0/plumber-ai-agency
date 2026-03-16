import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

type ToolCall = {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
};

type SheetRoute = {
  webhook_url: string;
  webhook_bearer: string | null;
  spreadsheet_id: string;
  default_tab_name: string;
};

type CalendarConnection = {
  calendar_id: string;
  timezone: string;
};

type TenantMappedService = {
  service_key: string;
  service_name: string;
  emergency_possible: boolean;
};

type TenantMappedArea = {
  county: string | null;
  city: string | null;
  zip_code: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-vapi-tenant-id, x-vapi-client-id, x-vapi-business-name",
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

function getString(obj: Json, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function normalizeUrgency(value: unknown): string {
  if (typeof value !== "string") return "medium";
  const normalized = value.trim().toLowerCase();
  return ["low", "medium", "high", "emergency"].includes(normalized) ? normalized : "medium";
}

function asJson(value: unknown): Json {
  return value && typeof value === "object" ? value as Json : {};
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function verifyVapiBearer(req: Request): string | null {
  const expected = Deno.env.get("VAPI_WEBHOOK_BEARER");
  if (!expected) return null;
  const provided = getBearerToken(req);
  if (!provided || provided !== expected) return "Unauthorized Vapi request.";
  return null;
}

function headerContext(req: Request): Json {
  return {
    tenant_id: req.headers.get("x-vapi-tenant-id")?.trim(),
    client_id: req.headers.get("x-vapi-client-id")?.trim(),
    business_name: req.headers.get("x-vapi-business-name")?.trim(),
  };
}

function boolFlag(obj: Json, key: string): boolean {
  return obj[key] === true;
}

function maybePhone(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^\d+]/g, "");
  return normalized.length >= 10 ? normalized : value;
}

function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function normalizeServiceToken(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || null;
}

async function resolveClientId(
  supabase: ReturnType<typeof createClient>,
  payload: Json,
  messageJson: Json,
  callJson: Json,
  existingArgs: Json,
  requestContext: Json,
  vapiCallId: string | null,
): Promise<string | null> {
  const directClientId = getString(existingArgs, ["client_id"]);
  if (directClientId) return directClientId;

  const requestClientId = getString(requestContext, ["client_id"]);
  const requestTenantId = getString(requestContext, ["tenant_id"]);
  if (requestClientId) return requestClientId;

  const assistantMetadata = asJson(asJson(messageJson.assistant).metadata);
  const callAssistantMetadata = asJson(asJson(asJson(callJson.assistant)).metadata);
  const metadataClientId =
    getString(assistantMetadata, ["client_id"]) ??
    getString(callAssistantMetadata, ["client_id"]) ??
    getString(payload, ["client_id"]);
  const metadataTenantId =
    getString(existingArgs, ["tenant_id"]) ??
    getString(assistantMetadata, ["tenant_id"]) ??
    getString(callAssistantMetadata, ["tenant_id"]) ??
    getString(payload, ["tenant_id"]);
  if (metadataClientId) return metadataClientId;

  const assistantOverrides = asJson(callJson.assistantOverrides);
  const overrideVariableValues = asJson(assistantOverrides.variableValues);
  const overrideClientId = getString(overrideVariableValues, ["client_id"]);
  const overrideTenantId = getString(overrideVariableValues, ["tenant_id"]);
  if (overrideClientId) return overrideClientId;

  const assistantVariableValues = asJson(asJson(messageJson.assistant).variableValues);
  const assistantClientId = getString(assistantVariableValues, ["client_id"]);
  const assistantTenantId = getString(assistantVariableValues, ["tenant_id"]);
  if (assistantClientId) return assistantClientId;

  const tenantIdCandidate = requestTenantId ?? metadataTenantId ?? overrideTenantId ?? assistantTenantId;
  if (tenantIdCandidate) {
    const { data: clientByTenant } = await supabase
      .from("clients")
      .select("id")
      .eq("tenant_id", tenantIdCandidate)
      .limit(1)
      .maybeSingle();

    if (clientByTenant?.id) return String(clientByTenant.id);
  }

  if (vapiCallId) {
    const { data: existingCall } = await supabase
      .from("calls")
      .select("client_id")
      .eq("vapi_call_id", vapiCallId)
      .maybeSingle();

    if (existingCall?.client_id) return String(existingCall.client_id);
  }

  const phoneNumberId =
    getString(callJson, ["phoneNumberId", "phone_number_id"]) ??
    getString(asJson(callJson.phoneNumber), ["id"]) ??
    getString(asJson(callJson.customer), ["phoneNumberId", "phone_number_id"]);
  if (phoneNumberId) {
    const { data: mappedNumber } = await supabase
      .from("phone_numbers")
      .select("client_id")
      .eq("vapi_phone_number_id", phoneNumberId)
      .eq("active", true)
      .maybeSingle();

    if (mappedNumber?.client_id) return String(mappedNumber.client_id);

    const { data: clientByNumber } = await supabase
      .from("clients")
      .select("id")
      .eq("vapi_phone_number_id", phoneNumberId)
      .maybeSingle();

    if (clientByNumber?.id) return String(clientByNumber.id);
  }

  const toNumber =
    normalizePhone(getString(callJson, ["to", "toNumber"])) ??
    normalizePhone(getString(asJson(callJson.customer), ["to", "toNumber"])) ??
    normalizePhone(getString(asJson(payload.customer), ["to", "toNumber"]));
  if (toNumber) {
    const { data: mappedNumber } = await supabase
      .from("phone_numbers")
      .select("client_id")
      .eq("number", toNumber)
      .eq("active", true)
      .maybeSingle();

    if (mappedNumber?.client_id) return String(mappedNumber.client_id);

    const { data: matchingClients } = await supabase
      .from("clients")
      .select("id")
      .or(`phone.eq.${toNumber},contact_phone.eq.${toNumber}`)
      .limit(1);

    const match = Array.isArray(matchingClients) ? matchingClients[0] : null;
    if (match?.id) return String(match.id);
  }

  return null;
}

async function getTenantMappedServices(
  supabase: ReturnType<typeof createClient>,
  tenantId: string | null,
): Promise<TenantMappedService[]> {
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from("tenant_services")
    .select("priority, service_catalog!inner(service_key, service_name, emergency_possible, active)")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .eq("service_catalog.active", true)
    .order("priority", { ascending: true });

  if (error || !Array.isArray(data)) return [];

  return data.flatMap((row) => {
    const catalog = row.service_catalog;
    if (!catalog || typeof catalog !== "object") return [];
    const catalogJson = catalog as Json;
    const serviceKey = getString(catalogJson, ["service_key"]);
    const serviceName = getString(catalogJson, ["service_name"]);
    if (!serviceKey || !serviceName) return [];
    return [{
      service_key: serviceKey,
      service_name: serviceName,
      emergency_possible: catalogJson.emergency_possible === true,
    }];
  });
}

async function getTenantMappedAreas(
  supabase: ReturnType<typeof createClient>,
  tenantId: string | null,
): Promise<TenantMappedArea[]> {
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from("tenant_service_areas")
    .select("county, city, zip_code")
    .eq("tenant_id", tenantId)
    .eq("active", true);

  if (error || !Array.isArray(data)) return [];

  return data.map((row) => ({
    county: getString(row as Json, ["county"]),
    city: getString(row as Json, ["city"]),
    zip_code: getString(row as Json, ["zip_code"]),
  }));
}

function dayKeyFromDate(date: Date): string {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][date.getDay()];
}

function parseHourToken(value: string): number | null {
  const token = value.trim().toLowerCase();
  if (!token) return null;
  const match = token.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3];
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour + (minute / 60);
}

function parseHoursWindow(value: unknown): { startHour: number; endHour: number } | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "closed") return null;
  const compact = normalized.replace(/\s+/g, "");
  const parts = compact.split("-");
  if (parts.length !== 2) return null;
  const startHour = parseHourToken(parts[0]);
  const endHour = parseHourToken(parts[1]);
  if (startHour === null || endHour === null || endHour <= startHour) return null;
  return { startHour, endHour };
}

function offsetForDate(dateString: string, timeZone: string): string {
  const probe = new Date(`${dateString}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(probe);
  const offsetPart = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return "Z";
  const sign = match[1];
  const hours = String(match[2]).padStart(2, "0");
  const minutes = String(match[3] ?? "00").padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function isoFromDateStringAndHour(dateString: string, hour: number, timeZone: string): string {
  const wholeHours = Math.floor(hour);
  const minutes = Math.round((hour - wholeHours) * 60);
  const offset = offsetForDate(dateString, timeZone);
  const hh = String(wholeHours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const iso = `${dateString}T${hh}:${mm}:00${offset}`;
  return new Date(iso).toISOString();
}

function addMinutes(iso: string, minutes: number): string {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function toDisplayTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

function intervalsOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB);
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
  const token = typeof json.access_token === "string" ? json.access_token : null;
  if (!token) throw new Error("Google OAuth refresh did not return an access token.");
  return token;
}

async function getCalendarConnection(
  supabase: ReturnType<typeof createClient>,
  tenantId: string | null,
): Promise<CalendarConnection | null> {
  if (!tenantId) return null;
  const { data } = await supabase
    .from("calendar_connections")
    .select("calendar_id, timezone, active")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();

  if (!data || data.active === false) return null;
  return {
    calendar_id: String(data.calendar_id),
    timezone: data.timezone ? String(data.timezone) : "America/Los_Angeles",
  };
}

async function getSheetRoute(
  supabase: ReturnType<typeof createClient>,
  clientId: string,
): Promise<SheetRoute | null> {
  const { data, error } = await supabase
    .from("client_sheet_routes")
    .select("webhook_url, webhook_bearer, spreadsheet_id, tab_name, active")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!error && data && data.active !== false) {
    return {
      webhook_url: String(data.webhook_url),
      webhook_bearer: data.webhook_bearer ? String(data.webhook_bearer) : null,
      spreadsheet_id: String(data.spreadsheet_id),
      default_tab_name: data.tab_name ? String(data.tab_name) : "New Leads",
    };
  }

  const webhookUrl = Deno.env.get("GOOGLE_SHEETS_WEBHOOK_URL");
  const spreadsheetId = Deno.env.get("GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID");
  if (!webhookUrl || !spreadsheetId) return null;

  return {
    webhook_url: webhookUrl,
    webhook_bearer: Deno.env.get("GOOGLE_SHEETS_WEBHOOK_BEARER"),
    spreadsheet_id: spreadsheetId,
    default_tab_name: Deno.env.get("GOOGLE_SHEETS_DEFAULT_TAB") ?? "New Leads",
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

async function queryBusyWindows(calendarId: string, timeMin: string, timeMax: string): Promise<Array<{ start: string; end: string }>> {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to query calendar availability (${response.status}): ${text}`);
  }

  const json = await response.json();
  const busy = json?.calendars?.[calendarId]?.busy;
  return Array.isArray(busy)
    ? busy.map((entry: Json) => ({ start: String(entry.start), end: String(entry.end) }))
    : [];
}

async function bookCalendarEvent(args: {
  calendarId: string;
  timeZone: string;
  businessName: string;
  callerName: string | null;
  callerPhone: string | null;
  serviceAddress: string | null;
  issueDescription: string | null;
  scheduledStart: string;
  scheduledEnd: string;
}): Promise<{ eventId: string; htmlLink: string | null }> {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: `${args.businessName} Service Call - ${args.callerName ?? "Customer"}`,
      description: [
        `Caller: ${args.callerName ?? "Unknown"}`,
        `Phone: ${args.callerPhone ?? "Unknown"}`,
        `Address: ${args.serviceAddress ?? "Unknown"}`,
        `Issue: ${args.issueDescription ?? "Unknown"}`,
      ].join("\n"),
      start: {
        dateTime: args.scheduledStart,
        timeZone: args.timeZone,
      },
      end: {
        dateTime: args.scheduledEnd,
        timeZone: args.timeZone,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to book calendar event (${response.status}): ${text}`);
  }

  const json = await response.json();
  return {
    eventId: String(json.id),
    htmlLink: typeof json.htmlLink === "string" ? json.htmlLink : null,
  };
}

async function handleCheckServiceability(
  supabase: ReturnType<typeof createClient>,
  args: Json,
): Promise<Record<string, unknown>> {
  const clientId = getString(args, ["client_id"]);
  const city = getString(args, ["city"]);
  const zip = getString(args, ["zip"]);
  const serviceType = getString(args, ["service_type"]);

  if (!clientId) {
    return {
      in_service_area: false,
      service_supported: false,
      recommended_action: "Missing client_id.",
    };
  }

  const { data: client, error } = await supabase
    .from("clients")
    .select("tenant_id, service_area_json, services_json")
    .eq("id", clientId)
    .single();

  if (error || !client) {
    return {
      in_service_area: false,
      service_supported: false,
      recommended_action: "Client not found.",
    };
  }

  const tenantId = client.tenant_id ? String(client.tenant_id) : null;
  const mappedAreas = await getTenantMappedAreas(supabase, tenantId);
  const mappedServices = await getTenantMappedServices(supabase, tenantId);
  const legacyServiceAreas = Array.isArray(client.service_area_json) ? client.service_area_json : [];
  const legacyServices = Array.isArray(client.services_json) ? client.services_json : [];
  const normalizedRequestedService = normalizeServiceToken(serviceType);

  const inServiceArea =
    mappedAreas.length > 0
      ? mappedAreas.some((area) => {
        const areaZip = area.zip_code;
        const areaCity = area.city?.toLowerCase();
        return (zip && areaZip === zip) || (city && areaCity === city.toLowerCase());
      })
      : legacyServiceAreas.length === 0 ||
        legacyServiceAreas.some((area) => {
          if (!area || typeof area !== "object") return false;
          const areaJson = area as Json;
          const areaZip = getString(areaJson, ["zip_code", "zip"]);
          const areaCity = getString(areaJson, ["city"]);
          return (zip && areaZip === zip) || (city && areaCity?.toLowerCase() === city.toLowerCase());
        });

  const serviceSupported =
    mappedServices.length > 0
      ? mappedServices.some((service) =>
        normalizeServiceToken(service.service_key) === normalizedRequestedService ||
        normalizeServiceToken(service.service_name) === normalizedRequestedService
      )
      : legacyServices.length === 0 ||
        legacyServices.some((service) => normalizeServiceToken(String(service)) === normalizedRequestedService);

  return {
    in_service_area: inServiceArea,
    service_supported: serviceSupported,
    matched_from: mappedServices.length > 0 || mappedAreas.length > 0 ? "tenant_mappings" : "legacy_client_json",
    recommended_action: !inServiceArea
      ? "Politely explain the company may not serve that area."
      : !serviceSupported
      ? "Politely explain that service is not currently offered."
      : "Proceed to availability check.",
  };
}

async function handleCheckAvailability(
  supabase: ReturnType<typeof createClient>,
  args: Json,
): Promise<Record<string, unknown>> {
  const clientId = getString(args, ["client_id"]);
  const urgency = normalizeUrgency(args.urgency);
  const requestedDate = getString(args, ["requested_date"]);
  const requestedTime = getString(args, ["requested_time"]);

  if (!clientId) {
    return {
      callback_required: true,
      available_slots: [],
      recommended_action: "Missing client_id.",
    };
  }

  const { data: client, error } = await supabase
    .from("clients")
    .select("tenant_id, booking_rules_json, emergency_enabled, booking_mode, feature_flags_json, hours_json")
    .eq("id", clientId)
    .single();

  if (error || !client) {
    return {
      callback_required: true,
      available_slots: [],
      recommended_action: "Client configuration not found.",
    };
  }

  const bookingRules = asJson(client.booking_rules_json);
  const featureFlags = asJson(client.feature_flags_json);
  const hoursJson = asJson(client.hours_json);
  const calendarEnabled = boolFlag(featureFlags, "calendar_enabled") && client.booking_mode === "calendar_direct";
  const calendarConnection = await getCalendarConnection(supabase, client.tenant_id ? String(client.tenant_id) : null);

  if (urgency === "emergency" && client.emergency_enabled) {
    return {
      callback_required: false,
      available_slots: [
        {
          label: "Emergency dispatch requested",
          date: requestedDate ?? "today",
          time: requestedTime ?? "ASAP",
        },
      ],
      recommended_action: "Tell the caller the request is being marked urgent.",
    };
  }

  if (calendarEnabled && calendarConnection) {
    const durationMinutes = Number(bookingRules.slot_duration_minutes ?? 120) || 120;
    const targetDateString = requestedDate ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const targetDate = new Date(`${targetDateString}T12:00:00Z`);
    const dayKey = dayKeyFromDate(targetDate);
    const window = parseHoursWindow(hoursJson[dayKey]) ?? { startHour: 8, endHour: 17 };
    const timeMin = isoFromDateStringAndHour(targetDateString, window.startHour, calendarConnection.timezone);
    const timeMax = isoFromDateStringAndHour(targetDateString, window.endHour, calendarConnection.timezone);
    const busyWindows = await queryBusyWindows(calendarConnection.calendar_id, timeMin, timeMax);

    const availableSlots: Array<Record<string, unknown>> = [];
    for (let hour = window.startHour; hour + (durationMinutes / 60) <= window.endHour; hour += durationMinutes / 60) {
      const start = isoFromDateStringAndHour(targetDateString, hour, calendarConnection.timezone);
      const end = addMinutes(start, durationMinutes);
      const blocked = busyWindows.some((busy) => intervalsOverlap(start, end, busy.start, busy.end));
      if (blocked) continue;
      availableSlots.push({
        label: `${toDisplayTime(start, calendarConnection.timezone)} start`,
        date: start.slice(0, 10),
        time: `${toDisplayTime(start, calendarConnection.timezone)} - ${toDisplayTime(end, calendarConnection.timezone)}`,
        start,
        end,
      });
      if (availableSlots.length >= 3) break;
    }

    return {
      callback_required: availableSlots.length === 0,
      available_slots: availableSlots,
      recommended_action: availableSlots.length
        ? "Offer the available slots and confirm the chosen start and end time."
        : "No direct calendar slots are open. Offer callback scheduling instead.",
      booking_mode: "calendar_direct",
      calendar_direct_active: true,
      calendar_connected: true,
    };
  }

  const defaultSlots = Array.isArray(bookingRules.default_slots)
    ? bookingRules.default_slots
    : [
        { label: "Tomorrow morning", date: "tomorrow", time: "8am-12pm" },
        { label: "Tomorrow afternoon", date: "tomorrow", time: "12pm-4pm" },
      ];

  return {
    callback_required: false,
    available_slots: defaultSlots,
    recommended_action: "Offer the available slots.",
    booking_mode: client.booking_mode ?? "request_only",
    calendar_direct_active: calendarEnabled,
    calendar_connected: Boolean(calendarConnection),
  };
}

async function handleCreateLeadOrBooking(
  supabase: ReturnType<typeof createClient>,
  args: Json,
  vapiCallId?: string,
): Promise<Record<string, unknown>> {
  const clientId = getString(args, ["client_id"]);
  const callerName = getString(args, ["caller_name"]);
  const callerPhone = getString(args, ["caller_phone"]);
  const serviceAddress = getString(args, ["service_address", "address"]);
  const issueDescription = getString(args, ["issue_description", "issue"]);
  const serviceType = getString(args, ["service_type"]);
  const urgency = normalizeUrgency(args.urgency);
  const preferredDate = getString(args, ["preferred_date"]);
  const preferredTime = getString(args, ["preferred_time"]);
  const bookingMode = getString(args, ["booking_mode"]);
  const scheduledStart = getString(args, ["scheduled_start", "selected_slot_start", "slot_start"]);
  let scheduledEnd = getString(args, ["scheduled_end", "selected_slot_end", "slot_end"]);
  const requestedTimeZone = getString(args, ["timezone"]);

  if (!clientId) return { ok: false, error: "Missing client_id." };

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("tenant_id, business_name, phone, booking_mode, feature_flags_json, booking_rules_json")
    .eq("id", clientId)
    .single();

  if (clientError || !client) return { ok: false, error: "Client not found." };

  const featureFlags = asJson(client.feature_flags_json);
  const bookingRules = asJson(client.booking_rules_json);
  const calendarEnabled = boolFlag(featureFlags, "calendar_enabled") && client.booking_mode === "calendar_direct";
  const calendarConnection = await getCalendarConnection(supabase, client.tenant_id ? String(client.tenant_id) : null);
  const timeZone = requestedTimeZone ?? calendarConnection?.timezone ?? "America/Los_Angeles";

  if (scheduledStart && !scheduledEnd) {
    const durationMinutes = Number(bookingRules.slot_duration_minutes ?? 120) || 120;
    scheduledEnd = addMinutes(scheduledStart, durationMinutes);
  }

  let callRowId: string | null = null;
  if (vapiCallId) {
    const { data: existingCall } = await supabase
      .from("calls")
      .select("id")
      .eq("vapi_call_id", vapiCallId)
      .maybeSingle();
    callRowId = existingCall?.id ? String(existingCall.id) : null;
  }

  const directBookingReady = bookingMode === "booked" && calendarEnabled && calendarConnection && scheduledStart && scheduledEnd;
  const status = bookingMode === "booked"
    ? (directBookingReady ? "booked" : "callback")
    : bookingMode === "pending_confirmation"
    ? "callback"
    : "new";

  const summary = `${callerName ?? "Unknown caller"} called about ${serviceType ?? "an unknown service"}. Urgency: ${urgency}. ${status}.`;

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({
      tenant_id: client.tenant_id,
      client_id: clientId,
      call_id: callRowId,
      caller_name: callerName,
      caller_phone: callerPhone,
      service_address: serviceAddress,
      issue_description: issueDescription,
      service_type: serviceType,
      urgency_level: urgency,
      preferred_date: preferredDate,
      preferred_time: preferredTime,
      status,
      disposition: bookingMode,
      summary,
    })
    .select("id, status, created_at")
    .single();

  if (leadError || !lead) {
    return { ok: false, error: leadError?.message ?? "Failed to create lead." };
  }

  let calendarBooking: { eventId: string; htmlLink: string | null } | null = null;
  let calendarWarning: string | null = null;

  if (directBookingReady) {
    try {
      calendarBooking = await bookCalendarEvent({
        calendarId: calendarConnection.calendar_id,
        timeZone,
        businessName: String(client.business_name ?? "Plumbing Service"),
        callerName,
        callerPhone,
        serviceAddress,
        issueDescription,
        scheduledStart,
        scheduledEnd,
      });
    } catch (error) {
      calendarWarning = error instanceof Error ? error.message : "Calendar booking failed.";
    }
  } else if (bookingMode === "booked" && calendarEnabled) {
    calendarWarning = "Missing scheduled_start and scheduled_end for calendar-direct booking. Lead saved for callback instead.";
  }

  let followupSeeded = 0;
  let followupWarning: string | null = null;

  if (status === "new" && boolFlag(featureFlags, "outbound_followups_enabled") && client.tenant_id) {
    const followupPayload = {
      customer_name: callerName,
      service_address: serviceAddress,
      issue_description: issueDescription,
      business_name: client.business_name,
      business_phone: client.phone,
    };
    const followupQueue = await supabase.rpc("queue_followups_for_lead", {
      p_tenant_id: client.tenant_id,
      p_lead_id: lead.id,
      p_trigger_reason: "unbooked_new_lead",
      p_payload_json: followupPayload,
      p_appointment_id: null,
    });
    if (followupQueue.error) {
      followupWarning = followupQueue.error.message;
    } else {
      followupSeeded = Number(followupQueue.data ?? 0);
    }
  }

  if (bookingMode === "booked" || bookingMode === "pending_confirmation") {
    const appointmentInsert = await supabase.from("appointments").insert({
      tenant_id: client.tenant_id,
      client_id: clientId,
      lead_id: lead.id,
      scheduled_date: preferredDate,
      booked_start: scheduledStart,
      booked_end: scheduledEnd,
      timezone: timeZone,
      external_event_id: calendarBooking?.eventId ?? null,
      confirmed: bookingMode === "booked" && !calendarWarning,
      status: calendarBooking?.eventId ? "booked" : "pending",
      notes: summary,
    }).select("id, booked_start").single();

    if (appointmentInsert.error) {
      calendarWarning = appointmentInsert.error.message;
    } else if (
      appointmentInsert.data?.id &&
      appointmentInsert.data.booked_start &&
      boolFlag(featureFlags, "reminders_enabled") &&
      maybePhone(callerPhone)
    ) {
      const reminderPayload = {
        customer_name: callerName,
        service_address: serviceAddress,
        business_name: client.business_name,
        business_phone: client.phone,
      };
      const reminderSeed = await supabase.rpc("seed_default_reminders", {
        p_tenant_id: client.tenant_id,
        p_appointment_id: appointmentInsert.data.id,
        p_booked_start: appointmentInsert.data.booked_start,
        p_payload_json: reminderPayload,
      });
      if (reminderSeed.error) {
        calendarWarning = reminderSeed.error.message;
      }
    }
  }

  const route = await getSheetRoute(supabase, clientId);
  if (route) {
    await appendSheetRow(route, route.default_tab_name, {
      Time: String(lead.created_at),
      Name: callerName ?? "",
      Phone: callerPhone ?? "",
      Address: serviceAddress ?? "",
      Issue: issueDescription ?? "",
      Urgency: urgency,
      Status: status,
    });

    if (bookingMode === "booked" || bookingMode === "pending_confirmation") {
      await appendSheetRow(route, "Booked Jobs", {
        Date: preferredDate ?? scheduledStart?.slice(0, 10) ?? "",
        Customer: callerName ?? "",
        Address: serviceAddress ?? "",
        "Job Type": serviceType ?? "",
        Notes: calendarBooking?.htmlLink ? `${summary} ${calendarBooking.htmlLink}` : summary,
      });
    }
  }

  return {
    ok: true,
    lead_id: lead.id,
    status: lead.status,
    plumber_summary: summary,
    calendar_event_id: calendarBooking?.eventId ?? null,
    calendar_warning: calendarWarning,
    followup_seeded: followupSeeded,
    followup_warning: followupWarning,
  };
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
    const authError = verifyVapiBearer(req);
    if (authError) return jsonResponse({ error: authError }, 401);

    const body = await req.json();
    const payload = body && typeof body === "object" ? body as Json : {};
    const requestContext = headerContext(req);
    const message = payload.message;

    if (!message || typeof message !== "object") {
      return jsonResponse({ error: "Expected tool-calls message." }, 400);
    }

    const messageJson = message as Json;
    if (getString(messageJson, ["type"]) !== "tool-calls") {
      return jsonResponse({ error: "Expected tool-calls message." }, 400);
    }

    const callJson = (messageJson.call ?? {}) as Json;
    const vapiCallId = getString(callJson, ["id"]);
    const toolCallList = Array.isArray(messageJson.toolCallList) ? messageJson.toolCallList as ToolCall[] : [];

    const results: Array<Record<string, unknown>> = [];

    for (const toolCall of toolCallList) {
      const args = { ...((toolCall.arguments ?? toolCall.parameters ?? {}) as Json) } as Json;
      const resolvedClientId = await resolveClientId(supabase, payload, messageJson, callJson, args, requestContext, vapiCallId);
      if (!getString(args, ["client_id"]) && resolvedClientId) {
        args.client_id = resolvedClientId;
      }
      if (!getString(args, ["tenant_id"])) {
        const requestTenantId = getString(requestContext, ["tenant_id"]);
        if (requestTenantId) args.tenant_id = requestTenantId;
      }
      let result: Record<string, unknown>;

      switch (toolCall.name) {
        case "check_serviceability":
          result = await handleCheckServiceability(supabase, args);
          break;
        case "check_availability":
          result = await handleCheckAvailability(supabase, args);
          break;
        case "create_lead_or_booking":
          result = await handleCreateLeadOrBooking(supabase, args, vapiCallId ?? undefined);
          break;
        default:
          result = { ok: false, error: `Unknown tool: ${toolCall.name}` };
      }

      results.push({
        name: toolCall.name,
        toolCallId: toolCall.id,
        result: JSON.stringify(result),
      });
    }

    return jsonResponse({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});












