// @lovable.dev/vite-tanstack-config already includes tanstackStart, react, tailwind, etc.
// Do NOT add those plugins manually or the app will break with duplicates.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Vercel sets VERCEL=1 during build.
// Lovable's default Nitro preset is "cloudflare-module" which causes 404 on Vercel.
// Force the "vercel" preset so routes and server functions deploy correctly.
const isVercel = !!process.env.VERCEL;

export default defineConfig({
  nitro: isVercel
    ? { preset: "vercel" }
    : process.env.NITRO_PRESET
      ? { preset: process.env.NITRO_PRESET }
      : true,
  tanstackStart: {
    server: { entry: "server" },
  },
});
