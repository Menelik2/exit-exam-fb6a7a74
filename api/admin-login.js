import { createHmac, timingSafeEqual } from "node:crypto";

function getAdminPassword() { return (process.env.ADMIN_PASSWORD || "").trim(); }
function getSessionSecret() { return (process.env.ADMIN_SESSION_SECRET || "").trim(); }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map();
function getClientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "");
  return forwarded.split(",").map((part) => part.trim()).filter(Boolean).pop() || String(req.headers["x-real-ip"] || "unknown");
}
function isRateLimited(key) {
  const now = Date.now(), current = loginAttempts.get(key);
  if (!current || now - current.startedAt >= LOGIN_WINDOW_MS) { loginAttempts.set(key, { startedAt: now, count: 0 }); return false; }
  return current.count >= LOGIN_MAX_ATTEMPTS;
}
function recordFailedAttempt(key) {
  const now = Date.now(), current = loginAttempts.get(key);
  if (!current || now - current.startedAt >= LOGIN_WINDOW_MS) loginAttempts.set(key, { startedAt: now, count: 1 });
  else current.count += 1;
  if (loginAttempts.size > 1000) for (const [k, v] of loginAttempts) if (now - v.startedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(k);
}

function createSessionToken() {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const payload = String(exp);
  const sig = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function safeEqualString(a, b) {
  try {
    const ba = Buffer.from(String(a), "utf8");
    const bb = Buffer.from(String(b), "utf8");
    if (ba.length !== bb.length) {
      // still compare to avoid leaking length timing of password match path
      const pad = Buffer.alloc(ba.length);
      timingSafeEqual(ba, pad);
      return false;
    }
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
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

  const adminPassword = getAdminPassword();
  const sessionSecret = getSessionSecret();
  if (adminPassword.length < 12 || sessionSecret.length < 32) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ ok: false, token: null, error: "Admin authentication is not configured. Set ADMIN_PASSWORD (12+ characters) and ADMIN_SESSION_SECRET (32+ characters), then redeploy." }));
  }
  const clientKey = getClientKey(req);
  if (isRateLimited(clientKey)) {
    res.setHeader("Retry-After", String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
    res.statusCode = 429;
    return res.end(JSON.stringify({ ok: false, token: null, error: "Too many login attempts. Try again in 15 minutes." }));
  }
  try {
    const body = await readBody(req);
    const password = String(body.password ?? (body.data && body.data.password) ?? "");
    if (!password || !safeEqualString(password, adminPassword)) {
      recordFailedAttempt(clientKey);
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, token: null, error: "Incorrect password" }));
    }
    loginAttempts.delete(clientKey);
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, token: createSessionToken(), usingEnvPassword: true }));
  } catch {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, token: null, error: "Login failed" }));
  }
}
