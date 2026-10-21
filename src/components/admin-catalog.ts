import type { Catalog } from "./admin-types";

export const ADMIN_SESSION_KEY = "exit-exam-admin-session-v1";
export const CATALOG_KEY = "exit-exam-admin-catalog-v1";
export const DEFAULT_PIN = "admin123";

export const SEED: Catalog = {
  updatedAt: new Date().toISOString(),
  departments: [
    { id: "computer-science", name: "Computer Science", emoji: "💻", exams: [{ id: "cs-sample", title: "CS Exit Exam (sample)", year: 2024, pdfUrl: null, telegramFileId: null, note: "Add PDF URL or Telegram file_id" }] },
    { id: "nursing", name: "Nursing", emoji: "🩺", exams: [] },
    { id: "accounting", name: "Accounting", emoji: "📊", exams: [] },
    { id: "law", name: "Law", emoji: "⚖️", exams: [] },
    { id: "management", name: "Management", emoji: "📁", exams: [] },
  ],
};

export function loadCatalog(): Catalog {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Catalog;
      if (Array.isArray(parsed.departments)) return parsed;
    }
  } catch { /* ignore */ }
  return structuredClone(SEED);
}

export function saveCatalog(c: Catalog) {
  const next = { ...c, updatedAt: new Date().toISOString() };
  localStorage.setItem(CATALOG_KEY, JSON.stringify(next));
  return next;
}

export function getPin() {
  try { return localStorage.getItem("exit-exam-admin-pin") || DEFAULT_PIN; } catch { return DEFAULT_PIN; }
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "item";
}

export function exportDepartmentsJson(catalog: Catalog) {
  const blob = new Blob([JSON.stringify({
    appUrl: "https://yeniexams.vercel.app",
    channelUrl: "https://t.me/exitexamto",
    channelUsername: "@exitexamto",
    departments: catalog.departments,
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "departments.json";
  a.click();
  URL.revokeObjectURL(url);
}
