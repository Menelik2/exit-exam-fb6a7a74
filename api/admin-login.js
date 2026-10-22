import { createHmac } from "node:crypto";

function getAdminPassword() {
  return (process.env.ADMIN_PASSWORD || "").trim() || "admin123";
}

function getSessionSecret() {
  return (process.env.ADMIN_SESSION_SECRET || "").trim() || getAdminPassword();
}

function createSessionToken() {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const payload = String(exp);
  const sig = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

async function readBody(req) {
  if (req.body != null) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body || "{}");
      } catch {
        return {};
      }
    }
    if (typeof req.body === "object") return req.body;
  }
  // Fallback: stream body (some runtimes)
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    const body = await readBody(req);
    const password = String(body.password ?? (body.data && body.data.password) ?? "").trim();
    const expected = getAdminPassword();
    const ok = password.length > 0 && password === expected;

    if (!ok) {
      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          ok: false,
          token: null,
          usingEnvPassword: Boolean((process.env.ADMIN_PASSWORD || "").trim()),
          error: "Incorrect password",
        }),
      );
    }

    res.statusCode = 200;
    return res.end(
      JSON.stringify({
        ok: true,
        token: createSessionToken(),
        usingEnvPassword: Boolean((process.env.ADMIN_PASSWORD || "").trim()),
      }),
    );
  } catch (e) {
    res.statusCode = 500;
    return res.end(
      JSON.stringify({
        ok: false,
        token: null,
        error: (e && e.message) || "Login failed",
      }),
    );
  }
}
