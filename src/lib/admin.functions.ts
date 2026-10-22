import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Admin password is server-side only.
 * Set ADMIN_PASSWORD in Vercel (or .env) — never change it in the browser.
 */
function getAdminPassword(): string {
  const fromEnv = (process.env.ADMIN_PASSWORD || "").trim();
  if (fromEnv) return fromEnv;
  // Fallback for local/dev when env is not set
  return "admin123";
}

export const verifyAdminPassword = createServerFn({ method: "POST" })
  .validator(z.object({ password: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const expected = getAdminPassword();
    const ok = data.password === expected;
    return {
      ok,
      // Tell client whether a real env password is configured (not the value)
      usingEnvPassword: Boolean((process.env.ADMIN_PASSWORD || "").trim()),
    };
  });
