import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    // Order matters: tanstackStart first, then React, then Nitro
    tanstackStart({
      // Use the project's existing server entry (src/server.ts)
      server: {
        entry: "./src/server.ts",
      },
    }),
    viteReact(),
    tailwindcss(),
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    nitro({
      preset: "vercel",
    }),
  ],
});
