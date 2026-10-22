import { createHmac, timingSafeEqual } from "node:crypto";

const CATALOG_PATH = "telegram-bot/departments.json";

function getAdminPassword() {
  return (process.env.ADMIN_PASSWORD || "").trim() || "admin123";
}

function getSessionSecret() {
  return (process.env.ADMIN_SESSION_SECRET || "").trim() || getAdminPassword();
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  const payload = parts[0];
  const sig = parts[1];
  if (!payload || !sig) return false;
  const exp = Number(payload);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function getGithubConfig() {
  const token = (process.env.ADMIN_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  const owner = (process.env.GITHUB_OWNER || process.env.ADMIN_GITHUB_OWNER || "Menelik2").trim();
  const repo = (process.env.GITHUB_REPO || process.env.ADMIN_GITHUB_REPO || "exit-exam-fb6a7a74").trim();
  const branch = (process.env.GITHUB_BRANCH || process.env.ADMIN_GITHUB_BRANCH || "main").trim();
  return { token, owner, repo, branch };
}

function defaultCatalog() {
  return {
    appUrl: "https://yeniexams.vercel.app",
    channelUrl: "https://t.me/exitexamto",
    channelUsername: "@exitexamto",
    updatedAt: new Date().toISOString(),
    departments: [
      {
        id: "computer-science",
        name: "Computer Science",
        emoji: "💻",
        exams: [
          {
            id: "cs-sample",
            title: "CS Exit Exam (sample)",
            year: 2024,
            pdfUrl: null,
            telegramFileId: null,
            note: "Add PDF URL or Telegram file_id",
          },
        ],
      },
      { id: "nursing", name: "Nursing", emoji: "🩺", exams: [] },
      { id: "accounting", name: "Accounting", emoji: "📊", exams: [] },
      { id: "law", name: "Law", emoji: "⚖️", exams: [] },
      { id: "management", name: "Management", emoji: "📁", exams: [] },
    ],
  };
}

function normalizeCatalog(data) {
  try {
    const obj = data && typeof data === "object" ? data : {};
    const depts = Array.isArray(obj.departments) ? obj.departments : [];
    const cleaned = depts
      .map(function (d, i) {
        if (!d || typeof d !== "object") return null;
        const examsRaw = Array.isArray(d.exams) ? d.exams : [];
        const exams = examsRaw
          .map(function (e, j) {
            if (!e || typeof e !== "object") return null;
            return {
              id: String(e.id || "exam-" + j).slice(0, 120),
              title: String(e.title || "Untitled").slice(0, 400),
              year: typeof e.year === "number" ? e.year : null,
              pdfUrl: e.pdfUrl == null ? null : String(e.pdfUrl).slice(0, 2000),
              telegramFileId: e.telegramFileId == null ? null : String(e.telegramFileId).slice(0, 500),
              note: e.note == null ? undefined : String(e.note).slice(0, 1000),
            };
          })
          .filter(Boolean);
        return {
          id: String(d.id || "dept-" + i).slice(0, 120),
          name: String(d.name || d.id || "Department " + i).slice(0, 200),
          emoji: String(d.emoji || "📘").slice(0, 16),
          exams: exams,
        };
      })
      .filter(Boolean);
    return {
      appUrl: String(obj.appUrl || "https://yeniexams.vercel.app"),
      channelUrl: String(obj.channelUrl || "https://t.me/exitexamto"),
      channelUsername: String(obj.channelUsername || "@exitexamto"),
      updatedAt: String(obj.updatedAt || new Date().toISOString()),
      departments: cleaned.length ? cleaned : defaultCatalog().departments,
    };
  } catch (e) {
    return defaultCatalog();
  }
}

async function githubGetCatalog() {
  const cfg = getGithubConfig();
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "exit-exam-admin",
  };
  if (cfg.token) headers.Authorization = "Bearer " + cfg.token;

  const apiUrl =
    "https://api.github.com/repos/" +
    cfg.owner +
    "/" +
    cfg.repo +
    "/contents/" +
    CATALOG_PATH +
    "?ref=" +
    encodeURIComponent(cfg.branch);

  const res = await fetch(apiUrl, { headers, cache: "no-store" });

  if (res.status === 404) {
    return { catalog: defaultCatalog(), sha: null, storage: cfg.token ? "github" : "github-readonly" };
  }

  if (res.ok) {
    const json = await res.json();
    const raw = Buffer.from(json.content || "", "base64").toString("utf8");
    return {
      catalog: normalizeCatalog(JSON.parse(raw)),
      sha: json.sha || null,
      storage: cfg.token ? "github" : "github-readonly",
    };
  }

  const bust = Date.now();
  const rawUrl =
    "https://raw.githubusercontent.com/" +
    cfg.owner +
    "/" +
    cfg.repo +
    "/" +
    cfg.branch +
    "/" +
    CATALOG_PATH +
    "?t=" +
    bust;
  const rawRes = await fetch(rawUrl, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache", "User-Agent": "exit-exam-admin" },
    cache: "no-store",
  });
  if (!rawRes.ok) {
    return { catalog: defaultCatalog(), sha: null, storage: cfg.token ? "github" : "github-readonly" };
  }
  return {
    catalog: normalizeCatalog(await rawRes.json()),
    sha: null,
    storage: cfg.token ? "github" : "github-readonly",
  };
}

async function githubPutCatalog(catalog, sha) {
  const cfg = getGithubConfig();
  if (!cfg.token) {
    throw new Error(
      "ADMIN_GITHUB_TOKEN is not set on Vercel. Add a GitHub token with Contents: Read & Write, then redeploy.",
    );
  }
  const body = {
    message: "chore(admin): update departments catalog " + new Date().toISOString(),
    content: Buffer.from(JSON.stringify(catalog, null, 2) + "\n", "utf8").toString("base64"),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + CATALOG_PATH,
    {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + cfg.token,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "exit-exam-admin",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409) {
      const again = await githubGetCatalog();
      return githubPutCatalog(catalog, again.sha);
    }
    throw new Error("GitHub save failed (" + res.status + "): " + text.slice(0, 300));
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

  try {
    if (req.method === "GET") {
      const result = await githubGetCatalog();
      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          catalog: result.catalog,
          storage: result.storage,
          path: CATALOG_PATH,
        }),
      );
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const token = String(body.token ?? (body.data && body.data.token) ?? "");
      if (!verifySessionToken(token)) {
        res.statusCode = 401;
        return res.end(
          JSON.stringify({ ok: false, error: "Admin session expired. Please sign in again." }),
        );
      }
      const incoming = body.catalog ?? (body.data && body.data.catalog) ?? {};
      const current = await githubGetCatalog();
      const next = normalizeCatalog(
        Object.assign({}, incoming, { updatedAt: new Date().toISOString() }),
      );
      await githubPutCatalog(next, current.sha);
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, catalog: next }));
    }

    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  } catch (e) {
    res.statusCode = 500;
    return res.end(
      JSON.stringify({
        ok: false,
        error: (e && e.message) || "Catalog request failed",
      }),
    );
  }
}
