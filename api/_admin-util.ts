import { createHmac, timingSafeEqual } from "crypto";

export function getAdminPassword(): string {
  return (process.env.ADMIN_PASSWORD || "").trim() || "admin123";
}

export function getSessionSecret(): string {
  return (process.env.ADMIN_SESSION_SECRET || "").trim() || getAdminPassword();
}

export function createSessionToken(): string {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const payload = String(exp);
  const sig = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== "string") return false;
  const [payload, sig] = token.split(".");
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

export function getGithubConfig() {
  const token = (process.env.ADMIN_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  const owner = (process.env.GITHUB_OWNER || process.env.ADMIN_GITHUB_OWNER || "Menelik2").trim();
  const repo = (process.env.GITHUB_REPO || process.env.ADMIN_GITHUB_REPO || "exit-exam-fb6a7a74").trim();
  const branch = (process.env.GITHUB_BRANCH || process.env.ADMIN_GITHUB_BRANCH || "main").trim();
  return { token, owner, repo, branch };
}

export const CATALOG_PATH = "telegram-bot/departments.json";

export function defaultCatalog() {
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

export function normalizeCatalog(data: unknown) {
  try {
    const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const depts = Array.isArray(obj.departments) ? obj.departments : [];
    const cleaned = depts
      .map((d, i) => {
        if (!d || typeof d !== "object") return null;
        const row = d as Record<string, unknown>;
        const examsRaw = Array.isArray(row.exams) ? row.exams : [];
        const exams = examsRaw
          .map((e, j) => {
            if (!e || typeof e !== "object") return null;
            const ex = e as Record<string, unknown>;
            return {
              id: String(ex.id || `exam-${j}`).slice(0, 120),
              title: String(ex.title || "Untitled").slice(0, 400),
              year: typeof ex.year === "number" ? ex.year : null,
              pdfUrl: ex.pdfUrl == null ? null : String(ex.pdfUrl).slice(0, 2000),
              telegramFileId:
                ex.telegramFileId == null ? null : String(ex.telegramFileId).slice(0, 500),
              note: ex.note == null ? undefined : String(ex.note).slice(0, 1000),
            };
          })
          .filter(Boolean);
        return {
          id: String(row.id || `dept-${i}`).slice(0, 120),
          name: String(row.name || row.id || `Department ${i}`).slice(0, 200),
          emoji: String(row.emoji || "📘").slice(0, 16),
          exams,
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
  } catch {
    return defaultCatalog();
  }
}

export async function githubGetCatalog(): Promise<{
  catalog: ReturnType<typeof defaultCatalog>;
  sha: string | null;
  storage: "github" | "github-readonly";
}> {
  const { token, owner, repo, branch } = getGithubConfig();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${CATALOG_PATH}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(apiUrl, { headers, cache: "no-store" });

  if (res.status === 404) {
    return { catalog: defaultCatalog(), sha: null, storage: token ? "github" : "github-readonly" };
  }

  if (res.ok) {
    const json = (await res.json()) as { content?: string; sha?: string };
    const raw = Buffer.from(json.content || "", "base64").toString("utf8");
    return {
      catalog: normalizeCatalog(JSON.parse(raw)),
      sha: json.sha ?? null,
      storage: token ? "github" : "github-readonly",
    };
  }

  const bust = Date.now();
  const rawRes = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${CATALOG_PATH}?t=${bust}`,
    { headers: { Accept: "application/json", "Cache-Control": "no-cache" }, cache: "no-store" },
  );
  if (!rawRes.ok) {
    return { catalog: defaultCatalog(), sha: null, storage: token ? "github" : "github-readonly" };
  }
  return {
    catalog: normalizeCatalog(await rawRes.json()),
    sha: null,
    storage: token ? "github" : "github-readonly",
  };
}

export async function githubPutCatalog(
  catalog: ReturnType<typeof defaultCatalog>,
  sha: string | null,
): Promise<void> {
  const { token, owner, repo, branch } = getGithubConfig();
  if (!token) {
    throw new Error(
      "ADMIN_GITHUB_TOKEN is not set on Vercel. Add a GitHub token with Contents: Read & Write, then redeploy.",
    );
  }
  const body = {
    message: `chore(admin): update departments catalog ${new Date().toISOString()}`,
    content: Buffer.from(JSON.stringify(catalog, null, 2) + "\n", "utf8").toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${CATALOG_PATH}`, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409) {
      const again = await githubGetCatalog();
      return githubPutCatalog(catalog, again.sha);
    }
    throw new Error(`GitHub save failed (${res.status}): ${text.slice(0, 300)}`);
  }
}
