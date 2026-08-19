// @lovable.dev/vite-tanstack-config already includes tanstackStart, react, tailwind, etc.
// Do NOT add tanstackStart / react / tailwind again or plugins will duplicate.
import { defineConfig as defineLovableConfig } from "@lovable.dev/vite-tanstack-config";
import { defineConfig as defineViteConfig, type UserConfig } from "vite";
import { nitro } from "nitro/vite";

/**
 * Vercel deploy fix for Lovable + TanStack Start.
 *
 * Problem: Lovable's wrapper defaults Nitro to cloudflare-module and may also
 * inject @cloudflare/vite-plugin. That output is not a Vercel Function, so
 * production shows platform 404: NOT_FOUND.
 *
 * Solution:
 * 1) cloudflare: false — no Workers adapter
 * 2) nitro: false — disable the wrapper's own Nitro invocation
 * 3) Register nitro/vite ourselves with preset: "vercel"
 */
export default defineViteConfig(async (env) => {
  const base = (await defineLovableConfig({
    cloudflare: false,
    nitro: false,
    tanstackStart: {
      server: { entry: "server" },
    },
  })(env)) as UserConfig;

  if (env.command === "build") {
    base.plugins = [
      ...(base.plugins ?? []),
      nitro({
        preset: "vercel",
      }),
    ];
  }

  return base;
});
