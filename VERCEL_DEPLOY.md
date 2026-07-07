# Deploying to Vercel

Dual-deploy: Lovable (Cloudflare Workers) stays as-is, Vercel gets its own build path.

## One-time setup

1. **Vercel → New Project → Import Git Repository** (this repo).
2. Framework Preset: **Other**. Build Command: `bun run build` (already set in `vercel.json`).
3. **Settings → Environment Variables** (Production + Preview) — copy from `.env`:
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_ID`
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
4. **Supabase Auth → URL Configuration**: add `https://<your-app>.vercel.app` to Site URL + Redirect URLs.
5. **Google Cloud Console → OAuth client**: add the same origins to Authorized JavaScript origins + redirect URIs.
6. Push to `main` → Vercel deploys.

## How the build differs

- `vite.config.ts` detects `process.env.VERCEL` and swaps the TanStack Start server entry to `src/server.vercel.ts` (standard Web `fetch`).
- Locally / on Lovable, `VERCEL` is unset → falls back to `src/server.ts` (Workers signature). Lovable preview is untouched.

## Troubleshooting

- **500 in logs**: check all `SUPABASE_*` env vars are set.
- **Google `redirect_uri_mismatch`**: you skipped step 5.
- **Cloudflare-plugin error on Vercel build**: pin `@lovable.dev/vite-tanstack-config` to the current version in `package.json`.
