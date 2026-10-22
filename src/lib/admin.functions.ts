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

async function githubGetFile(): Promise<{ content: ServerCatalog; sha: string | null }> {
  const { token, owner, repo, branch } = getGithubConfig();

  if (token) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${CATALOG_PATH}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (res.status === 404) return { content: defaultCatalog(), sha: null };
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub read failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { content?: string; encoding?: string; sha?: string };
    const raw = Buffer.from(json.content || "", "base64").toString("utf8");
    const parsed = CatalogSchema.parse(JSON.parse(raw));
    return { content: parsed, sha: json.sha ?? null };
  }

  const rawRes = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${CATALOG_PATH}`,
    { headers: { Accept: "application/json" } },
  );
  if (!rawRes.ok) return { content: defaultCatalog(), sha: null };
  const parsed = CatalogSchema.parse(await rawRes.json());
  return { content: parsed, sha: null };
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
    throw new Error(`GitHub save failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

export const verifyAdminPassword = createServerFn({ method: "POST" })
  .validator(z.object({ password: z.string().min(1).max(200) }))
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
  const { content } = await githubGetFile();
  const { token } = getGithubConfig();
  return {
    catalog: content,
    storage: token ? ("github" as const) : ("github-readonly" as const),
    path: CATALOG_PATH,
  };
});

export const saveAdminCatalog = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string().min(10).max(500),
      catalog: CatalogSchema,
    }),
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
