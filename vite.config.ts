// @lovable.dev/vite-tanstack-config already includes tanstackStart, react, tailwind, etc.
// Do NOT add those plugins manually or the app will break with duplicates.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/**
 * Deploy target: Vercel only.
 *
 * Lovable's wrapper injects @cloudflare/vite-plugin on build by default
 * (cloudflare-module). That produces Workers output Vercel cannot serve,
 * which shows platform "404: NOT_FOUND" even when the deploy is Ready.
 *
 * Always disable Cloudflare and force Nitro's vercel preset so every CI
 * build (VERCEL=1 or local) emits .vercel/output Functions correctly.
 */
export default defineConfig({
  cloudflare: false,
  nitro: {
    preset: "vercel",
  },
  tanstackStart: {
    // src/server.ts — SSR error wrapper around TanStack server entry
    server: { entry: "server" },
  },
});
