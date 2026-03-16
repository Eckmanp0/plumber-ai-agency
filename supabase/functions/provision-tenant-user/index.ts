import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

type TenantRole = "agency_admin" | "client_admin" | "dispatcher" | "tech_viewer";

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

function getRole(value: unknown): TenantRole {
  return ["agency_admin", "client_admin", "dispatcher", "tech_viewer"].includes(String(value))
    ? value as TenantRole
    : "client_admin";
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  return value.trim().replace(/\/+$/, "");
}

function buildInviteRedirectUrl(body: Json): string | undefined {
  const explicitRedirect = normalizeUrl(getString(body.invite_redirect_to));
  if (explicitRedirect) return explicitRedirect;

  const explicitAppBase = normalizeUrl(
    getString(body.app_base_url) ??
    Deno.env.get("APP_BASE_URL") ??
    Deno.env.get("PUBLIC_APP_URL") ??
    Deno.env.get("SITE_URL") ??
    Deno.env.get("SUPABASE_INVITE_BASE_URL") ??
    null,
  );

  if (!explicitAppBase) return undefined;
  return `${explicitAppBase}/login?dest=client`;
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

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  const email = getString(body.email);
  const tenantId = getString(body.tenant_id);
  const role = getRole(body.role);
  const fullName = getString(body.full_name);
  const password = getString(body.password);
  const sendInvite = body.send_invite !== false;
  const inviteRedirectTo = buildInviteRedirectUrl(body);

  if (!email || !tenantId) {
    return jsonResponse({ error: "email and tenant_id are required" }, 400);
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("id", tenantId)
    .single();

  if (tenantError || !tenant) {
    return jsonResponse({ error: "Tenant not found" }, 404);
  }

  let page = 1;
  let matchedUser: { id: string; email?: string } | null = null;

  while (!matchedUser) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return jsonResponse({ error: error.message }, 500);

    const users = data?.users ?? [];
    matchedUser = users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
    if (matchedUser || users.length < 200) break;
    page += 1;
  }

  if (!matchedUser) {
    if (sendInvite) {
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: inviteRedirectTo,
        data: {
          full_name: fullName,
          tenant_id: tenantId,
          role,
        },
      });
      if (error) return jsonResponse({ error: error.message }, 500);
      matchedUser = { id: data.user.id, email: data.user.email ?? email };
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: password ?? crypto.randomUUID(),
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          tenant_id: tenantId,
          role,
        },
      });
      if (error || !data.user) return jsonResponse({ error: error?.message ?? "Failed to create user" }, 500);
      matchedUser = { id: data.user.id, email: data.user.email ?? email };
    }
  }

  const { error: membershipError } = await supabase
    .from("tenant_users")
    .upsert({
      tenant_id: tenantId,
      user_id: matchedUser.id,
      role,
    }, { onConflict: "tenant_id,user_id" });

  if (membershipError) {
    return jsonResponse({ error: membershipError.message }, 500);
  }

  return jsonResponse({
    ok: true,
    tenant_id: tenantId,
    tenant_name: tenant.name,
    user_id: matchedUser.id,
    email: matchedUser.email ?? email,
    role,
    invited: sendInvite,
    invite_redirect_to: inviteRedirectTo ?? null,
  });
});
