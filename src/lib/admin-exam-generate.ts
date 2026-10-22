import { extractDocumentText } from "@/lib/extract-document";
import type { ExamEntry, StoredQuestion } from "@/components/admin-types";

/** Download exam document + generate MCQs (admin-only pipeline). */
export async function generateAndStoreExamQuestions(
  exam: ExamEntry,
  numQuestions: number,
): Promise<StoredQuestion[]> {
  const res = await fetch("/api/exam-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: exam.title,
      pdfUrl: exam.pdfUrl ?? null,
      telegramFileId: exam.telegramFileId ?? null,
    }),
    cache: "no-store",
  });
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  let text = "";

  if (ctype.includes("application/json")) {
    const data = (await res.json()) as { ok?: boolean; text?: string; error?: string };
    if (!res.ok || data.ok === false) throw new Error(data.error || `Document error (${res.status})`);
    text = (data.text || "").trim();
  } else {
    if (!res.ok) throw new Error(`Document download failed (${res.status})`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 50) throw new Error("Downloaded file is empty");
    const header = new Uint8Array(buf.slice(0, 5));
    const magic = String.fromCharCode(...header);
    const nameHeader = res.headers.get("X-Exam-Filename");
    let filename = `${exam.title || "exam"}.pdf`;
    if (nameHeader) {
      try {
        filename = decodeURIComponent(nameHeader);
      } catch {
        filename = nameHeader;
      }
    }
    if (magic === "%PDF-" && !filename.toLowerCase().endsWith(".pdf")) filename += ".pdf";
    const mime = magic === "%PDF-" ? "application/pdf" : "application/octet-stream";
    const file = new File([buf], filename, { type: mime });
    text = (await extractDocumentText(file)).trim();
  }

  if (text.length < 40) {
    throw new Error("Could not read enough text from this file (use text PDF/DOCX).");
  }

  const genRes = await fetch("/api/generate-exam", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentName: exam.title,
      documentText: text.length > 180000 ? text.slice(0, 180000) : text,
      topic: exam.title,
      difficulty: "Intermediate",
      numQuestions,
      nonce: String(Date.now()),
    }),
    cache: "no-store",
  });
  const genData = (await genRes.json()) as {
    ok?: boolean;
    questions?: StoredQuestion[];
    error?: string;
  };
  if (!genRes.ok || genData.ok === false) {
    throw new Error(genData.error || `Generation failed (${genRes.status})`);
  }
  const questions = Array.isArray(genData.questions) ? genData.questions : [];
  if (questions.length === 0) throw new Error("No questions generated");
  return questions.map((q, i) => ({
    question_number: i + 1,
    question: q.question,
    options: q.options,
    correct_answer: q.correct_answer,
    explanation: q.explanation,
  }));
}
