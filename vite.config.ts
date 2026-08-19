// @lovable.dev/vite-tanstack-config already includes tanstackStart, react, tailwind, etc.
// Do NOT add those plugins manually or the app will break with duplicates.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Lovable defaults to Cloudflare Workers output (cloudflare-module).
// That artifact is not a Vercel serverless function → production shows
// platform "404: NOT_FOUND" even when the build is marked Ready.
//
// Fix for Vercel:
// 1) cloudflare: false  — do not inject @cloudflare/vite-plugin on build
// 2) nitro.preset: "vercel" — emit Build Output API under .vercel/output
//
// Vercel sets VERCEL=1 (and often NITRO_PRESET via vercel.json).
const isVercel = !!process.env.VERCEL || process.env.NITRO_PRESET === "vercel";

export default defineConfig({
  // Critical: turn off Lovable's Cloudflare Workers adapter on Vercel builds.
  cloudflare: isVercel ? false : undefined,

  nitro: isVercel
    ? {
        preset: "vercel",
      }
    : process.env.NITRO_PRESET
      ? { preset: process.env.NITRO_PRESET }
      : true,

  tanstackStart: {
    // Use src/server.ts (SSR error wrapper) as the server entry.
    server: { entry: "server" },
  },
});
