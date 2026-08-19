// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Vercel sets VERCEL=1 during build. Use Nitro (Node) there so routes don't 404.
// Lovable / local default keeps Cloudflare Workers target.
const isVercel = !!process.env.VERCEL;

export default defineConfig({
  // Emit a Vercel-compatible server when deploying on Vercel
  nitro: isVercel ? true : false,
  // Disable Cloudflare adapter on Vercel (otherwise output doesn't match the host → 404)
  cloudflare: isVercel ? false : undefined,
  tanstackStart: {
    server: { entry: "server" },
  },
});
