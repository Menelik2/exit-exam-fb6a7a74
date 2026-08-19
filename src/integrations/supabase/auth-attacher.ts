// Optional Supabase auth attachment — not registered in src/start.ts.
// This app does not require Supabase; exam generation works with Gemini alone.
import { createMiddleware } from "@tanstack/react-start";

/** No-op client middleware (kept for optional future auth). */
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => next({ headers: {} }),
);
