/** Browser client for Vercel /api admin routes (works when SPA has no TanStack server fns). */

export type AdminCatalog = {
  departments: Array<{
    id: string;
    name: string;
    emoji?: string;
    exams: Array<{
      id: string;
      title: string;
      year?: number | null;
      pdfUrl?: string | null;
      telegramFileId?: string | null;
      note?: string;
    }>;
  }>;
  updatedAt?: string;
  appUrl?: string;
  channelUrl?: string;
  channelUsername?: string;
};

async function parseJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
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
  return parseJson(res);
}

export async function apiGetCatalog(): Promise<{
  catalog: AdminCatalog;
  storage: "github" | "github-readonly";
  path?: string;
}> {
  const res = await fetch("/api/admin-catalog", { method: "GET", cache: "no-store" });
  const data = await parseJson(res);
  if (!data?.catalog) {
    throw new Error(data?.error || "Could not load catalog");
  }
  return data;
}

export async function apiSaveCatalog(token: string, catalog: AdminCatalog): Promise<{
  ok: boolean;
  catalog: AdminCatalog;
}> {
  const res = await fetch("/api/admin-catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, catalog }),
    cache: "no-store",
  });
  const data = await parseJson(res);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Save failed (${res.status})`);
  }
  return data;
}
