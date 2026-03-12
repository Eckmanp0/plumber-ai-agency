# Dashboard Hosting Notes

## Active Static Host

Cloudflare Pages preview/live host:
- `https://plumbing-ai-receptionist.pages.dev/`

Recommended final custom domain:
- `https://returnfromtheveil.online/`

## Publish Directory

Deploy the contents of `pages-deploy/` as the Cloudflare Pages output directory.

Source files live in `dashboard/`.

Deploy bundle includes:
- `index.html`
- `login.html`
- `admin-dashboard.html`
- `client-dashboard.html`
- `new-plumbing-business-form.html`
- `_redirects`

## Clean Routes

Cloudflare Pages should now support these friendly routes through `_redirects`:
- `/`
- `/login`
- `/admin`
- `/client`
- `/onboarding`
  - redirects to `new-plumbing-business-form`

They map to:
- `/index.html`
- `/login`
- `/admin-dashboard`
- `/client-dashboard`
- `/new-plumbing-business-form`

Rebuild the Pages bundle with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-pages-deploy.ps1
```

## Supabase Auth Redirect URLs

Add all of these in Supabase Dashboard -> Authentication -> URL Configuration.

Production/custom domain:
- `https://returnfromtheveil.online/login.html`
- `https://returnfromtheveil.online/admin-dashboard.html`
- `https://returnfromtheveil.online/client-dashboard.html`
- `https://returnfromtheveil.online/login`
- `https://returnfromtheveil.online/admin`
- `https://returnfromtheveil.online/client`
- `https://returnfromtheveil.online/admin-dashboard`
- `https://returnfromtheveil.online/client-dashboard`
- `https://returnfromtheveil.online/new-plumbing-business-form`

Cloudflare Pages domain:
- `https://plumbing-ai-receptionist.pages.dev/login.html`
- `https://plumbing-ai-receptionist.pages.dev/admin-dashboard.html`
- `https://plumbing-ai-receptionist.pages.dev/client-dashboard.html`
- `https://plumbing-ai-receptionist.pages.dev/login`
- `https://plumbing-ai-receptionist.pages.dev/admin`
- `https://plumbing-ai-receptionist.pages.dev/client`
- `https://plumbing-ai-receptionist.pages.dev/admin-dashboard`
- `https://plumbing-ai-receptionist.pages.dev/client-dashboard`
- `https://plumbing-ai-receptionist.pages.dev/new-plumbing-business-form`

Local development:
- `http://localhost:5500/dashboard/login.html`
- `http://localhost:5500/dashboard/admin-dashboard.html`
- `http://localhost:5500/dashboard/client-dashboard.html`

## Cloudflare Domain Step

In Cloudflare Pages:
- add `returnfromtheveil.online` as a custom domain
- let Cloudflare create the DNS records it requests
- wait for SSL to issue

## Practical Login URLs

Use these once deployed:
- Agency admin: `https://plumbing-ai-receptionist.pages.dev/login?dest=admin`
- Client login: `https://plumbing-ai-receptionist.pages.dev/login?dest=client`

After custom domain is attached:
- Agency admin: `https://returnfromtheveil.online/login?dest=admin`
- Client login: `https://returnfromtheveil.online/login?dest=client`
