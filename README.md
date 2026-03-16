# Plumber AI Agency

Multi-tenant plumbing intake platform built on Supabase, Vapi, Google Sheets, and Google Calendar.

## Active Project Areas

- [`dashboard`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/dashboard)
  - Static frontend source of truth
- [`pages-deploy`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/pages-deploy)
  - Generated Cloudflare Pages upload bundle
- [`supabase`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/supabase)
  - Migrations, config, Edge Functions
- [`scripts`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/scripts)
  - Utility scripts and deploy helpers
- [`reference-materials`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/reference-materials)
  - Non-code business/reference files
- [`archive`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/archive)
  - Superseded project artifacts kept for reference

## Current Frontend Canonical Pages

- [`index.html`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/dashboard/index.html)
- [`login.html`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/dashboard/login.html)
- [`admin_management.html`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/dashboard/admin_management.html)
- [`client-dashboard.html`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/dashboard/client-dashboard.html)
- [`new-plumbing-business-form.html`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/dashboard/new-plumbing-business-form.html)

Legacy onboarding paths now redirect to the richer onboarding form:

- `/onboarding`
- `/onboarding.html`

Short routes are handled in:

- [`dashboard/_redirects`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/dashboard/_redirects)

We are not using folder-backed route mirrors anymore.
`/login` is native via Cloudflare Pages pretty URLs from `login.html`, and `/admin`, `/admin-dashboard`, and `/admin-management` all resolve to `/admin_management` via redirects.

## Deploy Flow

1. Edit frontend files in [`dashboard`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/dashboard)
2. Rebuild the Pages bundle:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-pages-deploy.ps1
```

3. Upload [`pages-deploy`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/pages-deploy) to Cloudflare Pages

## Secret Handling

- Runtime/app secrets belong in local `.env`
- Personal operator credentials like `SUPABASE_ACCESS_TOKEN` should stay outside the repo
- See:
  - [`docs/SECRET_HANDLING.md`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/docs/SECRET_HANDLING.md)

## Backend Notes

- Shared assistants are the default onboarding mode
- Shared-assistant runtime variable contract is documented in:
  - [`docs/VAPI_DYNAMIC_ASSISTANTS.md`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/docs/VAPI_DYNAMIC_ASSISTANTS.md)
- Vapi number-to-tenant binding is documented in:
  - [`docs/VAPI_NUMBER_SETUP.md`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/docs/VAPI_NUMBER_SETUP.md)
- Supabase recording storage planning is documented in:
  - [`docs/CALL_RECORDING_STORAGE_PLAN.md`](C:/Users/eckma/OneDrive/Pictures/Documents/voice_agent/plumber-ai-agency/docs/CALL_RECORDING_STORAGE_PLAN.md)
- Follow-up engine foundation is live, but outbound delivery remains gated until providers are configured
- Reminder queue foundation is live, but SMS delivery is intentionally paused until needed

## Cleanup Rule

If a file is not the active source of truth, it should either:

- live in `archive/`, or
- be generated from a source folder, or
- be removed once it is no longer needed
