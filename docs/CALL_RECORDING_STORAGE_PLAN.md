# Supabase Call Recording Storage Plan

This plan covers how to store, secure, and reference call recordings from Vapi inside Supabase.

## Goal

For each completed call, we want:

1. the recording file stored in Supabase Storage
2. a durable path recorded in the `calls` table
3. tenant-aware access control
4. a clean retention and troubleshooting model

## Recommended Architecture

### 1. Supabase Storage Bucket

Create a private bucket:

- `call-recordings`

Reason:

- recordings are sensitive
- they should never be public URLs by default

### 2. Storage Path Convention

Store files using a tenant/client/date layout:

```text
call-recordings/{tenant_id}/{client_id}/{yyyy}/{mm}/{vapi_call_id}.mp3
```

Example:

```text
call-recordings/ab04da8f-e572-4032-90ab-69a13b60bd7d/b2c77895-fe86-40ed-bcc2-ecefd2986bea/2026/03/call_123.mp3
```

This keeps:

- tenant isolation clear
- client grouping easy
- deletion and retention simpler

## Database Fields

Current `calls` table already includes:

- `recording_url`

Recommended additions later if needed:

- `recording_storage_path text`
- `recording_synced_at timestamptz`
- `recording_source text`
- `recording_status text`

Suggested `recording_status` values:

- `pending`
- `synced`
- `failed`
- `expired`

## Ingestion Flow

### Option A: Store Vapi URL only

Simplest:

1. Vapi sends `recording_url` in `end-of-call-report`
2. Supabase stores the external recording URL in `calls.recording_url`

Pros:

- very easy

Cons:

- depends on Vapi as long-term system of record
- weaker tenant-controlled retention

### Option B: Copy recording into Supabase Storage

Recommended:

1. `vapi-events` receives `recording_url`
2. queue or trigger a recording-sync function
3. function downloads the recording from Vapi
4. uploads it to `call-recordings`
5. updates the `calls` row with storage path and status

Pros:

- recordings live under your own infrastructure
- better long-term control
- easier to support secure tenant playback later

Cons:

- one more processing step

## Recommended Build Order

### Phase 1

Keep current:

- store `recording_url` from Vapi in `calls.recording_url`

### Phase 2

Add:

- `recording-sync` Edge Function

Responsibilities:

1. accept `call_id` or `vapi_call_id`
2. fetch the Vapi recording file
3. upload to Supabase Storage
4. update the `calls` row

### Phase 3

Add secure playback to dashboards:

1. generate signed storage URLs
2. only for authorized tenant members
3. optional download vs stream controls

## Security Model

### Storage bucket

- bucket should be private

### Access

- only `agency_admin`, `client_admin`, and approved roles should be able to request signed URLs

### Recommended rule

Never expose raw storage paths directly to the frontend without a signed URL step.

## Troubleshooting Fields

When we build recording sync later, log:

- `call_id`
- `vapi_call_id`
- source URL
- destination path
- sync status
- sync error message
- last retry time

This will make support easier when a recording is missing or broken.

## Operational Notes

### Retention

Decide per package tier:

- `pilot`: shorter retention
- `full_service`: longer retention

### Compliance

If call recording consent rules apply, prompt and workflow may need a consent disclosure before recording is retained long term.

### Reporting

Later, dashboards can link:

- transcript
- structured output
- summary
- recording playback

from the same `calls` row.

## Recommended Future Function Set

Later additions:

1. `recording-sync`
2. `recording-signed-url`
3. optional `recording-retention-run`

## Current Status

Right now the system stores:

- `calls.recording_url`

It does not yet:

- copy recordings into Supabase Storage
- generate signed playback URLs
- enforce storage-level recording retention
