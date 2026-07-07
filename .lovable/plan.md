# Deploy to Vercel — Step-by-Step Plan

This app currently targets **Cloudflare Workers** via `@lovable.dev/vite-tanstack-config` (which bundles the Cloudflare Vite plugin), `wrangler.jsonc`, and a Workers-style `fetch` export in `src/server.ts`. Vercel uses a different runtime (Node/Edge functions), so a real Vercel deploy requires swapping the build target and the server entry. Below is the minimum, safe path.

## Recommended approach: dual-deploy

Keep Lovable (Cloudflare) working as today AND add a Vercel deployment on the side. This avoids breaking the Lovable preview/publish flow.

---

## Step 1 — Prep the repo

1. Connect the GitHub repo to Vercel (New Project → Import Git Repository).
2. Framework preset: **Other** (do NOT pick "Vite" — TanStack Start needs its own build).
3. Build command: `bun run build` (already defined in `package.json`).
4. Output: leave default — the Vercel adapter writes it.

## Step 2 — Switch the build target for Vercel

TanStack Start supports a Vercel target, but our `vite.config.ts` currently hardcodes the Cloudflare path via `@lovable.dev/vite-tanstack-config` + `src/server.ts` (Workers `fetch`).

Add a Vercel-only config path using an env flag so Lovable's Cloudflare build stays untouched:

- Introduce `VERCEL=1` detection in `vite.config.ts`.
- When on Vercel: use TanStack Start's Vercel target and skip Cloudflare plugin.
- When on Lovable: keep current Cloudflare setup exactly as-is.

## Step 3 — Add a Vercel-compatible server entry

`src/server.ts` exports a Workers `fetch(request, env, ctx)`. Vercel Node/Edge functions use a different signature. Add `src/server.vercel.ts` that wraps `@tanstack/react-start/server-entry` for Vercel's handler shape, and route the Vercel build to it (the other file stays for Cloudflare).

## Step 4 — Environment variables in Vercel

Lovable Cloud auto-injects Supabase creds. Vercel does not. In **Vercel → Project → Settings → Environment Variables**, add (for Production + Preview):

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

Copy the values from the current `.env` in this project. Do **not** paste service-role keys — the app doesn't use them.

## Step 5 — Supabase auth allow-list

Add the Vercel URLs to Supabase Auth → URL Configuration:

- `https://<your-project>.vercel.app`
- Any preview URL pattern you want to allow (`https://*.vercel.app` optional).
- Google OAuth: add the same origins to Google Cloud Console → OAuth client → Authorized redirect URIs.

## Step 6 — First deploy + smoke test

1. Push to `main` → Vercel builds.
2. Open the Vercel URL, sign in with Google, generate one exam.
3. Watch the Vercel function logs for any `Missing Supabase environment variable` or `Unauthorized` errors.

## Step 7 — Custom domain (optional)

Vercel → Domains → add. Update Supabase + Google OAuth allow-lists with the final domain.

---

## What will change

| Area | Today (Lovable/Cloudflare) | After (Vercel) |
|---|---|---|
| Runtime | Cloudflare Workers (workerd) | Vercel Node/Edge functions |
| Server entry | `src/server.ts` (`fetch` export) | `src/server.vercel.ts` (Vercel handler) |
| Env vars | Auto-injected by Lovable Cloud | Manually set in Vercel dashboard |
| Preview URLs | `*.lovable.app` | `*.vercel.app` |
| Publish button | Publishes to Lovable | No effect on Vercel; Vercel deploys on git push |

## What will NOT change

- Supabase project (same DB, same auth, same keys).
- App code, routes, server functions, UI.
- Lovable preview keeps working — dual-deploy leaves `wrangler.jsonc` and the Cloudflare path intact.

## Known risks / caveats

- **Node-only npm packages**: none currently used, but if you add one later, Vercel's Node runtime handles it better than Workers.
- **`@lovable.dev/vite-tanstack-config` upgrades**: could re-introduce Cloudflare-only assumptions; pin the version once Vercel is green.
- **OAuth redirect**: if you forget Step 5, Google login will fail with `redirect_uri_mismatch` on Vercel only.
- **SSR error page**: the branded 500 page in `src/server.ts` needs porting to `server.vercel.ts` or Vercel will show its default error page.

## Technical details (for later implementation turns)

- `vite.config.ts` gate: `if (process.env.VERCEL)` → return TanStack Start config without `@lovable.dev/vite-tanstack-config` Cloudflare bits; else keep current export.
- `src/server.vercel.ts`: import `@tanstack/react-start/server-entry`, export `default async function handler(req, res)` that adapts Node req/res to Web `Request`/`Response`.
- Keep `wrangler.jsonc` and `src/server.ts` untouched.
- No changes to `src/integrations/supabase/*` (auto-generated).

---

Approve this plan and I'll implement Steps 2 and 3 (config + Vercel server entry). Steps 1, 4, 5, 6, 7 are dashboard actions you do in Vercel/Supabase/Google — I'll give exact click paths when you're ready.