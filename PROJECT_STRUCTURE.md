# Project Structure

This repo now has a single frontend source of truth and one generated deploy bundle.

## Source Of Truth

- `dashboard/`
  - Editable static frontend pages
  - If a page should change in production, change it here first

- `supabase/`
  - Database migrations
  - Edge Functions
  - Supabase config

- `scripts/`
  - Utility scripts for Vapi setup and local build helpers

## Generated Output

- `pages-deploy/`
  - Generated from `dashboard/`
  - This is the folder to upload to Cloudflare Pages
  - Rebuild it with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-pages-deploy.ps1
```

## Archived

- `archive/`
  - Older or superseded project artifacts that we are keeping for reference
  - Not part of the active deployment path

## Reference Materials

- `reference-materials/`
  - Non-code business/reference files such as spreadsheets and PDFs
  - Kept out of the project root to reduce deployment noise

- `docs/`
  - Planning, cleanup, support, and secret-handling notes

## Current Frontend Routing Rule

- Prefer editing these canonical pages:
  - `dashboard/index.html`
  - `dashboard/login.html`
  - `dashboard/admin_management.html`
  - `dashboard/client-dashboard.html`
  - `dashboard/new-plumbing-business-form.html`

- Short routes are handled only in `dashboard/_redirects`:
  - `/admin` -> `/admin_management`
  - `/client` -> `/client-dashboard`
  - `/onboarding` -> `/new-plumbing-business-form`

- `/login` is handled natively by Cloudflare Pages pretty URLs from `login.html`

## Notes

- `dashboard/onboarding.html` still exists for legacy compatibility and forwards to `new-plumbing-business-form.html`.
- `dashboard/new-plumbing-business-form.html` is the richer onboarding page we should carry forward.
- `dashboard/deploymernt` was archived because it contained outdated dashboard copies.
- Folder-based short-route mirrors were archived so routing lives in one place.
