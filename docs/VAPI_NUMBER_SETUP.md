# Vapi Number Setup

Use this checklist for every production tenant number.

## Goal

Each tenant gets:

1. one Vapi inbound number
2. the correct shared assistant by package tier
3. a trusted bearer token on requests
4. tenant and client context passed in request headers

That allows Supabase to resolve the right tenant even before prior call history exists.

## Canonical Number Setup

Use this exact order in the Vapi phone number UI:

1. `PHONE_NUMBER_LABEL`
2. `SERVER_URL`
3. `CREDENTIAL`
4. `HTTP_HEADERS`
5. `ASSISTANT`
6. `FALLBACK_DESTINATION`

### 1. PHONE_NUMBER_LABEL

Set this to the tenant business name.

Example:

- `Evergreen Plumbing Services`

### 2. SERVER_URL

Use the Supabase event endpoint:

- `https://lxkfjannfjfetfjfwuaf.supabase.co/functions/v1/vapi-events`

Do not invent separate tenant-specific URLs unless there is a clear routing reason.

### 3. CREDENTIAL

Use a Vapi custom credential of type:

- `Bearer token`

Recommended credential label:

- `supabase-vapi-webhook-bearer`

Store the same secret in Supabase function secrets as:

- `VAPI_WEBHOOK_BEARER`

Both handlers now verify this bearer token when the secret is present:

- [`vapi-tools/index.ts`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/supabase/functions/vapi-tools/index.ts)
- [`vapi-events/index.ts`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/supabase/functions/vapi-events/index.ts)

### 4. HTTP_HEADERS

Per number, set static tenant headers:

- `x-vapi-tenant-id: TENANT_UUID`
- `x-vapi-client-id: CLIENT_UUID`
- `x-vapi-business-name: Business Name`

The most important headers are:

- `x-vapi-tenant-id`
- `x-vapi-client-id`

### 5. ASSISTANT

Assign the shared assistant that matches the tenant package:

- `pilot` -> `VAPI_SHARED_ASSISTANT_ID_PILOT`
- `full_service` -> `VAPI_SHARED_ASSISTANT_ID_FULL_SERVICE`

### 6. FALLBACK_DESTINATION

Use the business number or operator line where overflow or unavailable calls should transfer.

## Supabase Binding

After creating the Vapi number, store the Vapi phone number id in:

- `clients.vapi_phone_number_id`

This remains a strong fallback resolution path even if headers are missing.

## Resolution Order

The backend now resolves tenant/client context in roughly this order:

1. explicit request headers
2. assistant override variables
3. assistant metadata
4. prior `calls` row
5. `clients.vapi_phone_number_id`
6. fallback phone matching

## Evergreen Example

Tenant:

- `tenant_id`: `ab04da8f-e572-4032-90ab-69a13b60bd7d`
- `client_id`: `b2c77895-fe86-40ed-bcc2-ecefd2986bea`

Recommended static headers:

```text
x-vapi-tenant-id: ab04da8f-e572-4032-90ab-69a13b60bd7d
x-vapi-client-id: b2c77895-fe86-40ed-bcc2-ecefd2986bea
x-vapi-business-name: Evergreen Plumbing Services
```

Evergreen number setup summary:

1. `PHONE_NUMBER_LABEL`
   - `Evergreen Plumbing Services`
2. `SERVER_URL`
   - `https://lxkfjannfjfetfjfwuaf.supabase.co/functions/v1/vapi-events`
3. `CREDENTIAL`
   - bearer token credential using `VAPI_WEBHOOK_BEARER`
4. `HTTP_HEADERS`
   - `x-vapi-tenant-id: ab04da8f-e572-4032-90ab-69a13b60bd7d`
   - `x-vapi-client-id: b2c77895-fe86-40ed-bcc2-ecefd2986bea`
   - `x-vapi-business-name: Evergreen Plumbing Services`
5. `ASSISTANT`
   - shared `pilot`
6. `FALLBACK_DESTINATION`
   - `541-220-0731`

## Why This Matters

Forwarding a tenant's missed calls into a Vapi number is not enough by itself. The backend still needs a trustworthy way to know which tenant the forwarded call belongs to.

The clean production answer is:

1. unique Vapi number per tenant
2. shared assistant per package tier
3. bearer-authenticated requests
4. tenant/client headers
5. phone-number id stored in Supabase

## Future Outbound Setup

When outbound calling is enabled later, use a separate outbound assistant rather than reusing the inbound receptionist assistant.

Why:

1. outbound confirmation calls need a different tone and script
2. voicemail behavior differs
3. retry and no-answer handling differ
4. confirmation and follow-up flows are operationally distinct

Recommended future model:

- shared inbound `pilot`
- shared inbound `full_service`
- shared outbound confirmation / follow-up assistant
