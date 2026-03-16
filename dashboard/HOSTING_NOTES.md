# Dashboard Hosting Notes

## Active Static Host

Cloudflare Pages preview/live host:
- `https://plumbing-ai-receptionist.pages.dev/`

Recommended final custom domain:
- `https://pipescheduler.com/`

## Publish Directory

Deploy the contents of `pages-deploy/` as the Cloudflare Pages output directory.

Source files live in `dashboard/`.

Deploy bundle includes:
- `index.html`
- `login.html`
- `admin_management.html`
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
- `/admin_management`
- `/client-dashboard`
- `/new-plumbing-business-form`

Rebuild the Pages bundle with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-pages-deploy.ps1
```

## Supabase Auth Redirect URLs

Add all of these in Supabase Dashboard -> Authentication -> URL Configuration.

Production/custom domain:
- `https://pipescheduler.com/login.html`
- `https://pipescheduler.com/admin_management.html`
- `https://pipescheduler.com/client-dashboard.html`
- `https://pipescheduler.com/login`
- `https://pipescheduler.com/admin`
- `https://pipescheduler.com/client`
- `https://pipescheduler.com/admin_management`
- `https://pipescheduler.com/client-dashboard`
- `https://pipescheduler.com/new-plumbing-business-form`

Cloudflare Pages domain:
- `https://plumbing-ai-receptionist.pages.dev/login.html`
- `https://plumbing-ai-receptionist.pages.dev/admin_management.html`
- `https://plumbing-ai-receptionist.pages.dev/client-dashboard.html`
- `https://plumbing-ai-receptionist.pages.dev/login`
- `https://plumbing-ai-receptionist.pages.dev/admin`
- `https://plumbing-ai-receptionist.pages.dev/client`
- `https://plumbing-ai-receptionist.pages.dev/admin_management`
- `https://plumbing-ai-receptionist.pages.dev/client-dashboard`
- `https://plumbing-ai-receptionist.pages.dev/new-plumbing-business-form`

Local development:
- `http://localhost:5500/dashboard/login.html`
- `http://localhost:5500/dashboard/admin_management.html`
- `http://localhost:5500/dashboard/client-dashboard.html`

## Cloudflare Domain Step

In Cloudflare Pages:
- add `pipescheduler.com` as a custom domain
- let Cloudflare create the DNS records it requests
- wait for SSL to issue

## Practical Login URLs

Use these once deployed:
- Agency admin: `https://plumbing-ai-receptionist.pages.dev/login?dest=admin`
- Client login: `https://plumbing-ai-receptionist.pages.dev/login?dest=client`

After custom domain is attached:
- Agency admin: `https://pipescheduler.com/login?dest=admin`
- Client login: `https://pipescheduler.com/login?dest=client`
