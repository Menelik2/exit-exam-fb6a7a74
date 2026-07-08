import { defineConfig } from "@playwright/test";

/**
 * Smoke test config — validates the sign-in flow end-to-end against a locally
 * built preview server. Kept intentionally minimal so it runs in CI without
 * external dependencies (no real Google OAuth round-trip).
 */
const PORT = Number(process.env.SMOKE_PORT ?? 4173);
const BASE_URL = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : {
        command: `bun run preview --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
