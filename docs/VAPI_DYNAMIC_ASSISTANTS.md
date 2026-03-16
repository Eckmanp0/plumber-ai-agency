# Vapi Dynamic Assistants

This project now treats Vapi shared assistants as the default operating model.

## Goal

Use one shared assistant per package tier:

- `pilot`
- `full_service`

Instead of creating a new assistant for every tenant, inject tenant-specific variables at runtime.

## Canonical Runtime Variables

When a phone number or inbound route points to a shared assistant, inject these values:

```json
{
  "tenant_id": "TENANT_UUID",
  "client_id": "CLIENT_UUID",
  "business_name": "Business Name",
  "hours_text": "Mon 8-5; Tue 8-5; Wed 8-5; Thu 8-5; Fri 8-5; Sat closed; Sun closed",
  "service_area_text": "Salem, Keizer, ZIP 97301, ZIP 97302",
  "services_text": "Drain Cleaning, Leak Repair, Water Heater Repair",
  "emergency_service_text": "enabled",
  "booking_rules_text": "same-day allowed; default windows: Tomorrow morning tomorrow 8am-12pm, Tomorrow afternoon tomorrow 12pm-4pm"
}
```

These values are returned by:

- [`onboard-client/index.ts`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/supabase/functions/onboard-client/index.ts)

under:

- `shared_assistant_runtime_variables`

## Prompt Variables

The shared assistant template expects:

- `{{business_name}}`
- `{{hours_text}}`
- `{{service_area_text}}`
- `{{services_text}}`
- `{{emergency_service_text}}`
- `{{booking_rules_text}}`

Do not inject raw database JSON blobs like `hours_json`, `service_area_json`, or raw table rows into the assistant prompt. The model performs more reliably when the variables are readable text built from tenant settings, `tenant_services`, and `tenant_service_areas`.

## First Message

```text
Thank you for calling {{business_name}}, how can I help you today?
```

## Shared Assistant Setup

Current shared assistant IDs:

- `pilot`: stored in `VAPI_SHARED_ASSISTANT_ID_PILOT`
- `full_service`: stored in `VAPI_SHARED_ASSISTANT_ID_FULL_SERVICE`

Onboarding defaults to the correct shared assistant by package tier unless:

- `provision_dedicated_assistant=true`

## Example Inbound Runtime Injection

If your inbound Vapi setup supports assistant overrides or variable injection, the payload should include:

```json
{
  "assistantOverrides": {
    "variableValues": {
      "tenant_id": "TENANT_UUID",
      "client_id": "CLIENT_UUID",
      "business_name": "Business Name",
      "hours_text": "Mon 8-5; Tue 8-5; Wed 8-5; Thu 8-5; Fri 8-5; Sat closed; Sun closed",
      "service_area_text": "Salem, Keizer, ZIP 97301, ZIP 97302",
      "services_text": "Drain Cleaning, Leak Repair, Water Heater Repair",
      "emergency_service_text": "enabled",
      "booking_rules_text": "same-day allowed; default windows: Tomorrow morning tomorrow 8am-12pm, Tomorrow afternoon tomorrow 12pm-4pm"
    }
  }
}
```

## Minimum Required Runtime Values

At minimum, shared assistants should receive:

- `tenant_id`
- `client_id`
- `business_name`

The backend is more forgiving than it used to be and can often resolve context from `tenant_id` alone, but `client_id` is still the most direct and reliable path.

## Current Resolution Paths

Current tool and event handlers can resolve tenant/client context from:

- explicit `client_id`
- explicit `tenant_id`
- assistant metadata
- `assistantOverrides.variableValues`
- prior `calls` rows
- `vapi_phone_number_id`
- phone-number fallback matching

Relevant files:

- [`vapi-tools/index.ts`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/supabase/functions/vapi-tools/index.ts)
- [`vapi-events/index.ts`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/supabase/functions/vapi-events/index.ts)

## Tenant Service Model

The backend now prefers normalized tenant data:

- `service_catalog`
- `tenant_services`
- `tenant_service_areas`
- `phone_numbers`

Runtime service checks use those tables first and fall back to legacy `clients.services_json` and `clients.service_area_json` only when normalized tenant mappings have not been populated yet.

## Recommended Production Rule

For every production inbound number:

1. bind the number to the correct shared assistant for the package tier
2. inject `shared_assistant_runtime_variables`
3. store the Vapi phone number id in `clients.vapi_phone_number_id`

That keeps the shared-assistant model stable and avoids creating unnecessary dedicated assistants.
