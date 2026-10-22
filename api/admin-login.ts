import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSessionToken, getAdminPassword } from "./_admin-util";

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const password = String(body.password ?? body?.data?.password ?? "").trim();
    const expected = getAdminPassword();
    const ok = password.length > 0 && password === expected;

    if (!ok) {
      return res.status(200).json({
        ok: false,
        token: null,
        usingEnvPassword: Boolean((process.env.ADMIN_PASSWORD || "").trim()),
        error: "Incorrect password",
      });
    }

    return res.status(200).json({
      ok: true,
      token: createSessionToken(),
      usingEnvPassword: Boolean((process.env.ADMIN_PASSWORD || "").trim()),
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      token: null,
      error: (e as Error).message || "Login failed",
    });
  }
}
