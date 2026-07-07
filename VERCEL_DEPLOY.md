# Deploying to Vercel

Dual-deploy: Lovable (Cloudflare Workers) stays as-is, Vercel gets its own build path.

## One-time setup

1. **Vercel → New Project → Import Git Repository** (this repo).
2. Framework Preset: **Other**. Build Command: `bun run build` (already set in `vercel.json`).
3. Add environment variables (see checklist below).
4. **Supabase Auth → URL Configuration**: add `https://<your-app>.vercel.app` to Site URL + Redirect URLs.
5. **Google Cloud Console → OAuth client**: add the same origins to Authorized JavaScript origins + redirect URIs.
6. Push to `main` → GitHub Actions runs `build:verify` (Workers + Vercel entries) and deploys.

## Environment variable checklist

Set every variable in **Vercel → Project → Settings → Environment Variables** for **Production** *and* **Preview**. Copy values from this project's `.env`.

### Supabase — required

| Variable | Scope | Where it's used | Notes |
|---|---|---|---|
| `SUPABASE_URL` | Server | `src/integrations/supabase/auth-middleware.ts`, `src/integrations/supabase/client.server.ts` | Server-only. Cloud URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Server | `src/integrations/supabase/auth-middleware.ts` | Server-only. Publishable key. |
| `SUPABASE_PROJECT_ID` | Server | Build tooling / type generation | Match Cloud project id. |
| `VITE_SUPABASE_URL` | Client + Server | `src/integrations/supabase/client.ts` (browser) | Same value as `SUPABASE_URL`. `VITE_` prefix exposes it to the browser bundle. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client + Server | `src/integrations/supabase/client.ts` (browser) | Same value as `SUPABASE_PUBLISHABLE_KEY`. Safe to ship — publishable, not service-role. |
| `VITE_SUPABASE_PROJECT_ID` | Client | Build tooling | Same value as `SUPABASE_PROJECT_ID`. |

### Auth / OAuth — configured outside Vercel

These are **not Vercel env vars**. Configure them where noted:

| Setting | Where | Value |
|---|---|---|
| Supabase Site URL | Supabase Auth → URL Configuration | `https://<your-app>.vercel.app` |
| Supabase Redirect URLs | Supabase Auth → URL Configuration | `https://<your-app>.vercel.app/**` (plus custom domain if any) |
| Google OAuth JS origins | Google Cloud Console → OAuth client | `https://<your-app>.vercel.app` |
| Google OAuth redirect URIs | Google Cloud Console → OAuth client | Callback URL shown in Lovable Cloud → Auth → Google provider |

### Do NOT set on Vercel

- `SUPABASE_SERVICE_ROLE_KEY` — the app doesn't use it; never expose service-role keys.
- `LOVABLE_API_KEY` — Lovable-managed, only meaningful on Lovable Cloud.
- `GEMINI_API_KEY` — this app reads per-user Gemini keys from the `user_gemini_keys` table, not an env var.

### GitHub Actions secrets (for auto-deploy from CI)

Set in **GitHub → repo → Settings → Secrets and variables → Actions**:

| Secret | Where to get it |
|---|---|
| `VERCEL_TOKEN` | https://vercel.com/account/tokens |
| `VERCEL_ORG_ID` | Run `vercel link` locally → read `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Same `.vercel/project.json` |

## Build validation

Two npm scripts confirm both server entries compile before deploy:

```bash
bun run build:workers   # src/server.ts (Cloudflare Workers)
bun run build:vercel    # src/server.vercel.ts (Vercel Web fetch)
bun run build:verify    # runs both back-to-back
```

CI runs `build:verify` on every push and PR (see `.github/workflows/ci-deploy.yml`). Deploy step only runs after it passes on `main`.

## How the build differs

- `vite.config.ts` detects `process.env.VERCEL` and swaps the TanStack Start server entry to `src/server.vercel.ts` (standard Web `fetch`).
- Locally / on Lovable, `VERCEL` is unset → falls back to `src/server.ts` (Workers signature). Lovable preview is untouched.

## Troubleshooting

- **500 in logs** → a required `SUPABASE_*` var is missing in Vercel.
- **Google `redirect_uri_mismatch`** → you skipped Supabase/Google URL setup.
- **Cloudflare-plugin error on Vercel build** → pin `@lovable.dev/vite-tanstack-config` to the current version.
- **"NO_GEMINI_KEY" in app** → expected; each user pastes their own Gemini key in the sidebar. Not an env var.
