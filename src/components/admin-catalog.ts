import type { Catalog, Department, ExamEntry } from "./admin-types";

export const ADMIN_SESSION_KEY = "exit-exam-admin-session-v1";
export const CATALOG_KEY = "exit-exam-admin-catalog-v1";
export const PIN_KEY = "exit-exam-admin-pin";
export const DEFAULT_PIN = "admin123";

export function createSeed(): Catalog {
  return {
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

/** @deprecated use createSeed() */
export const SEED: Catalog = createSeed();

function isExam(x: unknown): x is ExamEntry {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return typeof e.id === "string" && typeof e.title === "string";
}

function isDept(x: unknown): x is Department {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    typeof d.name === "string" &&
    Array.isArray(d.exams) &&
    d.exams.every(isExam)
  );
}

export function normalizeCatalog(raw: unknown): Catalog | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  let list: unknown[] | null = null;
  if (Array.isArray(o.departments)) list = o.departments;
  else if (Array.isArray(raw)) list = raw as unknown[];
  if (!list) return null;

  const departments: Department[] = [];
  for (const item of list) {
    if (!isDept(item)) continue;
    departments.push({
      id: item.id,
      name: item.name.trim() || item.id,
      emoji: typeof item.emoji === "string" && item.emoji ? item.emoji : "📘",
      exams: item.exams.map((e) => ({
        id: e.id,
        title: (e.title || "Untitled exam").trim(),
        year: typeof e.year === "number" ? e.year : e.year == null ? null : Number(e.year) || null,
        pdfUrl: e.pdfUrl ? String(e.pdfUrl) : null,
        telegramFileId: e.telegramFileId ? String(e.telegramFileId) : null,
        note: e.note ? String(e.note) : undefined,
      })),
    });
  }
  if (!departments.length && list.length > 0) return null;
  return {
    departments,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
  };
}

export function loadCatalog(): Catalog {
  if (typeof window === "undefined") return createSeed();
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (raw) {
      const parsed = normalizeCatalog(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    /* ignore */
  }
  return createSeed();
}

export function saveCatalog(c: Catalog): Catalog {
  const next: Catalog = {
    departments: c.departments,
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(CATALOG_KEY, JSON.stringify(next));
    } catch (err) {
      console.error("Failed to save catalog", err);
      throw new Error("Could not save — browser storage may be full or blocked.");
    }
  }
  return next;
}

export function getPin(): string {
  if (typeof window === "undefined") return DEFAULT_PIN;
  try {
    return localStorage.getItem(PIN_KEY) || DEFAULT_PIN;
  } catch {
    return DEFAULT_PIN;
  }
}

export function setPin(pin: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PIN_KEY, pin);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "item"
  );
}

export function uniqueDeptId(name: string, existing: Department[]): string {
  let id = slugify(name);
  if (!existing.some((d) => d.id === id)) return id;
  let n = 2;
  while (existing.some((d) => d.id === `${id}-${n}`)) n += 1;
  return `${id}-${n}`;
}

export function exportDepartmentsJson(catalog: Catalog): void {
  const payload = {
    appUrl: "https://yeniexams.vercel.app",
    channelUrl: "https://t.me/exitexamto",
    channelUsername: "@exitexamto",
    updatedAt: catalog.updatedAt,
    departments: catalog.departments,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "departments.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importCatalogFromText(text: string): Catalog {
  const parsed = JSON.parse(text) as unknown;
  const normalized = normalizeCatalog(parsed);
  if (!normalized) throw new Error("Invalid JSON — expected a departments list.");
  return saveCatalog(normalized);
}
