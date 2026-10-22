/** Browser client for Vercel /api admin routes. */

export type AdminQuestion = {
  question_number: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
};

export type AdminExam = {
  id: string;
  title: string;
  year?: number | null;
  pdfUrl?: string | null;
  telegramFileId?: string | null;
  note?: string;
  questions?: AdminQuestion[];
};

export type AdminDepartment = {
  id: string;
  name: string;
  emoji?: string;
  exams: AdminExam[];
};

export type AdminCatalog = {
  departments: AdminDepartment[];
  updatedAt?: string;
  appUrl?: string;
  channelUrl?: string;
  channelUsername?: string;
};

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) {
    throw new Error(
      res.ok
        ? "Empty response from server"
        : `Server error (${res.status}). Try again in a minute.`,
    );
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      res.ok
        ? "Invalid JSON from server"
        : `Server error (${res.status}). Deploy may still be updating — try again in a minute.`,
    );
  }
}

export async function apiAdminLogin(password: string): Promise<{
  ok: boolean;
  token: string | null;
  usingEnvPassword?: boolean;
  error?: string;
}> {
  const res = await fetch("/api/admin-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    cache: "no-store",
  });
  const data = await parseJson(res);
  if (res.status >= 500) {
    throw new Error(String(data.error || `Login server error (${res.status})`));
  }
  return {
    ok: Boolean(data.ok),
    token: typeof data.token === "string" ? data.token : null,
    usingEnvPassword: Boolean(data.usingEnvPassword),
    error: typeof data.error === "string" ? data.error : undefined,
  };
}

export async function apiGetCatalog(): Promise<{
  catalog: AdminCatalog;
  storage: "github" | "github-readonly";
  path?: string;
}> {
  const res = await fetch("/api/admin-catalog", { method: "GET", cache: "no-store" });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(String(data.error || `Could not load catalog (${res.status})`));
  }
  const catalog = data.catalog as AdminCatalog | undefined;
  if (!catalog || typeof catalog !== "object") {
    throw new Error(String(data.error || "Could not load catalog"));
  }
  return {
    catalog: {
      ...catalog,
      departments: Array.isArray(catalog.departments) ? catalog.departments : [],
    },
    storage: data.storage === "github" ? "github" : "github-readonly",
    path: typeof data.path === "string" ? data.path : undefined,
  };
}

export async function apiSaveCatalog(
  token: string,
  catalog: AdminCatalog,
): Promise<{ ok: boolean; catalog: AdminCatalog }> {
  if (!token || token.length < 10) {
    throw new Error("Admin session expired. Please sign in again.");
  }
  const res = await fetch("/api/admin-catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, catalog }),
    cache: "no-store",
  });
  const data = await parseJson(res);
  if (!res.ok || !data.ok) {
    throw new Error(String(data.error || `Save failed (${res.status})`));
  }
  const next = data.catalog as AdminCatalog | undefined;
  if (!next || typeof next !== "object") {
    throw new Error("Save succeeded but server returned no catalog");
  }
  return {
    ok: true,
    catalog: {
      ...next,
      departments: Array.isArray(next.departments) ? next.departments : [],
    },
  };
}
