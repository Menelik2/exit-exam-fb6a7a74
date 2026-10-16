import type { ExamQuestion } from "@/lib/exam.functions";
import { downloadExamPdf } from "@/lib/exam-pdf";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export type ExportMeta = {
  title: string;
  difficulty: string;
};

/** Download improved PDF (delegates to existing jsPDF helper). */
export async function exportPdf(questions: ExamQuestion[], meta: ExportMeta) {
  await downloadExamPdf(questions, meta);
}

/** Plain-text / Word-friendly export (.txt that opens cleanly in Word). */
export function exportText(questions: ExamQuestion[], meta: ExportMeta) {
  const lines: string[] = [];
  lines.push("EXIT EXAM PRACTICE");
  lines.push("=".repeat(40));
  lines.push(`${meta.title} · ${meta.difficulty} · ${questions.length} questions`);
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push("");
  lines.push("SECTION 1 — QUESTIONS");
  lines.push("-"
    .repeat(40));
  questions.forEach((q, i) => {
    lines.push("");
    lines.push(`${i + 1}. ${q.question}`);
    q.options.forEach((opt, oi) => {
      lines.push(`   ${LETTERS[oi] ?? oi + 1}. ${opt}`);
    });
  });
  lines.push("");
  lines.push("");
  lines.push("SECTION 2 — ANSWER KEY");
  lines.push("-"
    .repeat(40));
  questions.forEach((q, i) => {
    const idx = q.options.findIndex((o) => o === q.correct_answer);
    const letter = idx >= 0 ? (LETTERS[idx] ?? String(idx + 1)) : "-";
    lines.push("");
    lines.push(`${i + 1}. ${letter}. ${q.correct_answer}`);
    if (q.explanation) lines.push(`   ${q.explanation}`);
  });
  lines.push("");

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug =
    meta.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "exam";
  a.href = url;
  a.download = `${slug}-exam.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Compact share payload (questions only — no answers required for practice). */
type SharePayload = {
  v: 1;
  title: string;
  difficulty: string;
  questions: ExamQuestion[];
};

export function buildShareCode(questions: ExamQuestion[], meta: ExportMeta): string {
  const payload: SharePayload = {
    v: 1,
    title: meta.title,
    difficulty: meta.difficulty,
    questions: questions.map((q, i) => ({
      ...q,
      question_number: i + 1,
    })),
  };
  const json = JSON.stringify(payload);
  // base64url
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return b64;
}

export function parseShareCode(code: string): SharePayload | null {
  try {
    let b64 = code.trim().replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = decodeURIComponent(escape(atob(b64)));
    const data = JSON.parse(json) as SharePayload;
    if (data?.v !== 1 || !Array.isArray(data.questions) || data.questions.length === 0) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function buildShareUrl(questions: ExamQuestion[], meta: ExportMeta): string {
  const code = buildShareCode(questions, meta);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  // Keep URL manageable — long quizzes use clipboard code instead
  if (code.length > 1800) return "";
  return `${origin}${path}?quiz=${code}`;
}

export async function copyShareLink(questions: ExamQuestion[], meta: ExportMeta): Promise<{
  ok: boolean;
  mode: "url" | "code";
  value: string;
}> {
  const url = buildShareUrl(questions, meta);
  if (url) {
    try {
      await navigator.clipboard.writeText(url);
      return { ok: true, mode: "url", value: url };
    } catch {
      /* fall through */
    }
  }
  const code = buildShareCode(questions, meta);
  try {
    await navigator.clipboard.writeText(code);
    return { ok: true, mode: "code", value: code };
  } catch {
    return { ok: false, mode: "code", value: code };
  }
}
