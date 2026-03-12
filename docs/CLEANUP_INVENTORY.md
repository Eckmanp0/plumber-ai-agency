# Cleanup Inventory

## Source Of Truth

- Frontend source: `dashboard/`
- Backend source: `supabase/`
- Utility scripts: `scripts/`

## Generated Or Derived

- `pages-deploy/`
  - Generated from `dashboard/`
  - Safe to rebuild any time with `scripts/build-pages-deploy.ps1`
  - Should not be treated as the long-term editable source

## Archived

- `archive/2026-03-12-frontend-cleanup/dashboard-deploymernt/`
  - Archived because it contained older frontend copies, including outdated dashboard queries
- `archive/2026-03-12-routing-cleanup/`
  - Archived former folder-based route mirrors after standardizing on `_redirects`

## Reference Materials

- `reference-materials/`
  - Non-code business and onboarding reference files

## Function Inventory

### Active Operational Functions

- `vapi-tools`
- `vapi-events`
- `onboard-client`
- `provision-tenant-user`
- `calendar-provision`
- `monthly-report-sync`

### Active Foundation Functions

- `sms-send`
- `reminder-worker`
- `followup-run`

These are intentionally present even if delivery providers are not fully enabled yet.

## Script Inventory

### Keep

- `build-pages-deploy.ps1`
  - Rebuilds the Cloudflare Pages bundle from `dashboard/`

### Legacy Setup Scaffolding

- `create-vapi-tools.sh`
- `create-structured-output.sh`
- `create-assistant-template.sh`
- `assistant-template.json`
- `check_serviceability.json`
- `check_availability.json`
- `create_lead.json`
- `plumbing-call-schema.json`

These are still useful as setup/reference artifacts, but they are not part of the day-to-day runtime path.

## Cleanup Guidance

- Prefer archiving stale copies rather than deleting them if there is any chance they still carry context
- Avoid editing generated output directly
- If a file is operationally inactive, label it as reference, archive it, or remove it after confirmation
