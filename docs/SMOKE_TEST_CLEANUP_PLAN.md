# Smoke-Test Cleanup Plan

This plan is intentionally non-destructive. It identifies likely test records and the order we should review them before deleting or archiving anything.

## Current Live Client Records

### 1. Full Service Smoke Test Plumbing

- `client_id`: `91a56efe-85bd-41ac-b56c-0b22e9d33556`
- `tenant_id`: `79a5c359-bba9-4e51-ac97-56e346477c98`
- `package_tier`: `full_service`
- `booking_mode`: `calendar_direct`
- `vapi_assistant_id`: `48416bee-6032-495a-81ff-1db612097ab2`
- `google_sheet_id`: `1qsnw7Vjcmn-I3wpgyNeqyGpCVlbBJTLhq3MUQw_lfc0`

### 2. Template Copy Smoke Test Plumbing

- `client_id`: `317d4448-42d4-45bb-896c-2895a25e3f2e`
- `tenant_id`: `null`
- `package_tier`: `pilot`
- `booking_mode`: `request_only`
- `vapi_assistant_id`: `null`
- `google_sheet_id`: `null`

### 3. Codex Test Plumbing

- `client_id`: `6946465d-8ba5-4a76-9d23-b8b7fae4c5d3`
- `tenant_id`: `d138dee2-8805-43f5-a929-8aecd0000353`
- `package_tier`: `pilot`
- `booking_mode`: `request_only`
- `vapi_assistant_id`: `972f9266-8e32-41be-ab57-729fc7b23248`
- `google_sheet_id`: `null`

## Recommended Status

### Keep As Internal Sandbox

- `Codex Test Plumbing`
  - Good candidate for the stable internal sandbox unless a cleaner named test tenant replaces it

### Keep Temporarily For Feature Validation

- `Full Service Smoke Test Plumbing`
  - Still useful if we want a working full-service calendar test tenant while outbound and SMS remain paused

### Cleanup Candidate

- `Template Copy Smoke Test Plumbing`
  - Incomplete record
  - No tenant
  - No assistant
  - No sheet
  - Best first candidate for eventual removal

## Safe Cleanup Order

1. Decide which tenant becomes the permanent internal sandbox
2. Rename that tenant to a stable internal name if desired
3. Archive notes/IDs for any tenant being retired
4. Remove incomplete smoke-test records first
5. Remove extra Vapi assistants only after confirming no number or workflow still points at them
6. Remove related Google Sheets only after confirming they are not the active test dashboard

## Assistant Cleanup Guidance

Before deleting any assistant, verify:

1. it is not one of the shared assistants
2. no Vapi phone number is assigned to it
3. no current client row depends on it
4. it is not the active internal sandbox assistant

## Shared Assistants To Protect

- Pilot shared assistant:
  - `972f9266-8e32-41be-ab57-729fc7b23248`
- Full-service shared assistant:
  - `48416bee-6032-495a-81ff-1db612097ab2`

## Suggested Next Cleanup Pass

When ready, perform a review-only pass on:

1. Vapi phone number assignments
2. Vapi assistant list vs current client records
3. orphaned Google Sheets created during smoke tests
