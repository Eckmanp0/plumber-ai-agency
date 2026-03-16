# Secret Handling

## Rule Of Thumb

- Project `.env` files are for runtime/application secrets the code actually uses
- Personal operator credentials should stay outside the repo

## Keep Out Of The Repo

Do not store these in the project tree unless you intentionally understand the risk:

- Supabase personal access tokens (`sbp_...`)
- GitHub personal access tokens
- temporary one-off deploy tokens
- copied vendor dashboard secrets you only need during rotation

## Recommended Personal Secret File

Keep a separate private file on your machine, outside normal project usage, for operator credentials.

Example names already ignored by git:

- `keys-private.txt`
- `keys-private.md`
- `secrets-private.txt`
- `.env.local`

## Safe Repo Files

These are appropriate in local-only project config, but should never be committed:

- `.env`
- `.env.local`

Use `.env.example` as the committed template:

- `C:\Users\eckma\OneDrive\Pictures\Documents\voice_agent\plumber-ai-agency\.env.example`

## Current Recommended Split

### In `.env`

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `VAPI_API_KEY`
- Google OAuth app/runtime values
- Twilio values when enabled

### Outside The Repo

- `SUPABASE_ACCESS_TOKEN`
- GitHub PAT
- temporary migration/deploy credentials

## Deploy Pattern

Use personal deploy tokens only as temporary shell variables.

Example:

```powershell
$env:SUPABASE_ACCESS_TOKEN='your_new_sbp_token'
npx supabase functions deploy onboard-client --project-ref lxkfjannfjfetfjfwuaf
```

Then close the shell or clear the variable.
