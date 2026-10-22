const { createHmac } = require("crypto");

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

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        body = {};
      }
    }
    body = body || {};

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
};
