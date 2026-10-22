import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";

const ExamSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(400),
  year: z.number().int().nullable().optional(),
  pdfUrl: z.string().max(2000).nullable().optional(),
  telegramFileId: z.string().max(500).nullable().optional(),
  note: z.string().max(1000).optional(),
});

const DepartmentSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  emoji: z.string().max(16).optional().default("📘"),
  exams: z.array(ExamSchema).max(500),
});

const CatalogSchema = z.object({
  departments: z.array(DepartmentSchema).max(500),
  updatedAt: z.string().optional(),
  appUrl: z.string().optional(),
  channelUrl: z.string().optional(),
  channelUsername: z.string().optional(),
});

export type ServerCatalog = z.infer<typeof CatalogSchema>;

const CATALOG_PATH = "telegram-bot/departments.json";

function getAdminPassword(): string {
  const fromEnv = (process.env.ADMIN_PASSWORD || "").trim();
  if (fromEnv) return fromEnv;
  return "admin123";
}

function getSessionSecret(): string {
  return (process.env.ADMIN_SESSION_SECRET || "").trim() || getAdminPassword();
}

function getGithubConfig() {
  const token = (process.env.ADMIN_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  const owner = (process.env.GITHUB_OWNER || process.env.ADMIN_GITHUB_OWNER || "Menelik2").trim();
  const repo = (process.env.GITHUB_REPO || process.env.ADMIN_GITHUB_REPO || "exit-exam-fb6a7a74").trim();
  const branch = (process.env.GITHUB_BRANCH || process.env.ADMIN_GITHUB_BRANCH || "main").trim();
  return { token, owner, repo, branch };
}

function createSessionToken(): string {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const payload = String(exp);
  const sig = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string | undefined | null): boolean {
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

function defaultCatalog(): ServerCatalog {
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

const noStore = { cache: "no-store" as RequestCache };

function normalizeCatalogJson(raw: string): ServerCatalog {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const result = CatalogSchema.safeParse(data);
    if (result.success) return result.data;
    const depts = Array.isArray((data as { departments?: unknown })?.departments)
      ? (data as { departments: unknown[] }).departments
      : [];
    const cleaned = depts
      .map((d, i) => {
        if (!d || typeof d !== "object") return null;
        const row = d as Record<string, unknown>;
        const id = String(row.id || `dept-${i}`).slice(0, 120);
        const name = String(row.name || id).slice(0, 200);
        const emoji = String(row.emoji || "📘").slice(0, 16);
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
          .filter(Boolean) as ServerCatalog["departments"][number]["exams"];
        return { id, name, emoji, exams };
      })
      .filter(Boolean) as ServerCatalog["departments"];
    return {
      appUrl: String((data as { appUrl?: string })?.appUrl || "https://yeniexams.vercel.app"),
      channelUrl: String((data as { channelUrl?: string })?.channelUrl || "https://t.me/exitexamto"),
      channelUsername: String(
        (data as { channelUsername?: string })?.channelUsername || "@exitexamto",
      ),
      updatedAt: String((data as { updatedAt?: string })?.updatedAt || new Date().toISOString()),
      departments: cleaned.length ? cleaned : defaultCatalog().departments,
    };
  } catch (e) {
    console.error("normalizeCatalogJson failed", e);
    return defaultCatalog();
  }
}

async function githubGetFile(): Promise<{ content: ServerCatalog; sha: string | null }> {
  const { token, owner, repo, branch } = getGithubConfig();

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${CATALOG_PATH}?ref=${encodeURIComponent(branch)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(apiUrl, { headers, ...noStore });

  if (res.status === 404) {
    return { content: defaultCatalog(), sha: null };
  }

  if (res.ok) {
    const json = (await res.json()) as { content?: string; sha?: string };
    const raw = Buffer.from(json.content || "", "base64").toString("utf8");
    return { content: normalizeCatalogJson(raw), sha: json.sha ?? null };
  }

  const bust = Date.now();
  const rawRes = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${CATALOG_PATH}?t=${bust}`,
    { headers: { Accept: "application/json", "Cache-Control": "no-cache" }, ...noStore },
  );
  if (!rawRes.ok) {
    console.error(`Catalog read failed (${res.status}); using default catalog`);
    return { content: defaultCatalog(), sha: null };
  }
  const text = await rawRes.text();
  return { content: normalizeCatalogJson(text), sha: null };
}

async function githubPutFile(catalog: ServerCatalog, sha: string | null): Promise<void> {
  const { token, owner, repo, branch } = getGithubConfig();
  if (!token) {
    throw new Error(
      "Server storage not configured. Add ADMIN_GITHUB_TOKEN (repo Contents: Read & Write) in Vercel env, then redeploy.",
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
      const again = await githubGetFile();
      return githubPutFile(catalog, again.sha);
    }
    throw new Error(`GitHub save failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

export const verifyAdminPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ password: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const expected = getAdminPassword();
    const ok = data.password === expected;
    if (!ok) {
      return {
        ok: false as const,
        token: null as string | null,
        usingEnvPassword: Boolean((process.env.ADMIN_PASSWORD || "").trim()),
      };
    }
    return {
      ok: true as const,
      token: createSessionToken(),
      usingEnvPassword: Boolean((process.env.ADMIN_PASSWORD || "").trim()),
    };
  });

export const getAdminCatalog = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { content } = await githubGetFile();
    const { token } = getGithubConfig();
    const catalog = {
      ...content,
      departments: Array.isArray(content?.departments) ? content.departments : [],
    };
    return {
      catalog,
      storage: token ? ("github" as const) : ("github-readonly" as const),
      path: CATALOG_PATH,
    };
  } catch (e) {
    console.error("getAdminCatalog failed", e);
    const { token } = getGithubConfig();
    return {
      catalog: defaultCatalog(),
      storage: token ? ("github" as const) : ("github-readonly" as const),
      path: CATALOG_PATH,
    };
  }
});

export const saveAdminCatalog = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: z.string().min(10).max(500),
        catalog: CatalogSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (!verifySessionToken(data.token)) {
      throw new Error("Admin session expired. Please sign in again.");
    }

    const { sha } = await githubGetFile();
    const next: ServerCatalog = {
      appUrl: data.catalog.appUrl || "https://yeniexams.vercel.app",
      channelUrl: data.catalog.channelUrl || "https://t.me/exitexamto",
      channelUsername: data.catalog.channelUsername || "@exitexamto",
      updatedAt: new Date().toISOString(),
      departments: data.catalog.departments.map((d) => ({
        ...d,
        emoji: d.emoji || "📘",
        exams: d.exams.map((e) => ({
          ...e,
          year: e.year ?? null,
          pdfUrl: e.pdfUrl ?? null,
          telegramFileId: e.telegramFileId ?? null,
        })),
      })),
    };

    await githubPutFile(next, sha);
    return { ok: true as const, catalog: next };
  });
