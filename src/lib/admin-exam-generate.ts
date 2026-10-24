import { extractDocumentText, type ExtractProgress } from "@/lib/extract-document";
import type { ExamEntry, StoredQuestion } from "@/components/admin-types";

const CHUNK_SIZE = 10000;
const CHUNK_OVERLAP = 400;
/** Soft cap so catalog + UI stay usable (still covers long exams). */
const HARD_MAX_QUESTIONS = 200;
const PER_CHUNK_MIN = 6;
const PER_CHUNK_MAX = 20;

function chunkText(text: string): string[] {
  const t = text.trim();
  if (t.length <= CHUNK_SIZE) return [t];
  const chunks: string[] = [];
  let start = 0;
  while (start < t.length) {
    const end = Math.min(start + CHUNK_SIZE, t.length);
    chunks.push(t.slice(start, end));
    if (end >= t.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function questionsForChunk(len: number): number {
  if (len < 1500) return PER_CHUNK_MIN;
  if (len < 4000) return 10;
  if (len < 7000) return 14;
  return PER_CHUNK_MAX;
}

function normKey(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadDocumentText(
  exam: ExamEntry,
  onProgress?: (p: ExtractProgress) => void,
): Promise<string> {
  onProgress?.({ phase: "download", message: "Downloading exam document…" });
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
    // Independent copy so pdf.js cannot detach the buffer we still need
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(new Uint8Array(buf));
    const header = new Uint8Array(copy, 0, 5);
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
    const file = new File([copy], filename, { type: mime });
    text = (await extractDocumentText(file, { onProgress })).trim();
  }

  if (text.length < 40) {
    throw new Error(
      "Could not read enough text from this file. For scanned/image PDFs, wait for OCR to finish (keep the tab open) or use a clearer scan.",
    );
  }
  return text.length > 400000 ? text.slice(0, 400000) : text;
}

async function generateBatch(
  documentName: string,
  chunkTextContent: string,
  numQuestions: number,
  avoid: string[],
  partLabel: string,
): Promise<StoredQuestion[]> {
  const genRes = await fetch("/api/generate-exam", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentName: `${documentName} (${partLabel})`,
      documentText: chunkTextContent,
      numQuestions,
      avoidQuestions: avoid,
    }),
  });
  const genData = (await genRes.json()) as {
    ok?: boolean;
    questions?: StoredQuestion[];
    error?: string;
  };
  if (!genRes.ok || genData.ok === false) {
    throw new Error(genData.error || `Generation failed (${genRes.status})`);
  }
  return Array.isArray(genData.questions) ? genData.questions : [];
}

/**
 * Admin pipeline: read whole PDF/DOCX, generate questions across all sections,
 * dedupe, and return one complete set for storage.
 *
 * Pass numQuestions = 0 (or omit) for automatic full-document coverage.
 * Pass a positive number to request that many (still chunked for long docs).
 */
export type GenerateProgress = ExtractProgress & {
  questionsSoFar?: number;
  chunk?: number;
  totalChunks?: number;
};

export async function generateAndStoreExamQuestions(
  exam: ExamEntry,
  numQuestions: number = 0,
  onProgress?: (p: GenerateProgress) => void,
): Promise<StoredQuestion[]> {
  const fullText = await loadDocumentText(exam, onProgress);
  const chunks = chunkText(fullText);

  onProgress?({
    phase: "done",
    message: `Text ready (${fullText.length.toLocaleString()} chars, ${chunks.length} part(s)). Generating questions…`,
  });

  const wantAll = !numQuestions || numQuestions <= 0;
  let remaining = wantAll
    ? HARD_MAX_QUESTIONS
    : Math.min(HARD_MAX_QUESTIONS, Math.max(5, numQuestions));

  const collected: StoredQuestion[] = [];
  const seen = new Set<string>();
  let consecutiveFails = 0;

  for (let i = 0; i < chunks.length && remaining > 0; i++) {
    const chunk = chunks[i];
    const autoN = questionsForChunk(chunk.length);
    const perChunk = wantAll
      ? Math.min(autoN, remaining)
      : Math.min(
          autoN,
          Math.max(PER_CHUNK_MIN, Math.ceil(remaining / (chunks.length - i))),
          remaining,
        );

    const avoid = collected.map((q) => q.question).slice(-50);
    const partLabel = chunks.length === 1 ? "full document" : `part ${i + 1}/${chunks.length}`;

    onProgress?({
      phase: "done",
      chunk: i + 1,
      totalChunks: chunks.length,
      questionsSoFar: collected.length,
      message: `Generating questions ${partLabel}… (${collected.length} stored so far)`,
    });

    let batch: StoredQuestion[] = [];
    try {
      batch = await generateBatch(exam.title, chunk, perChunk, avoid, partLabel);
      consecutiveFails = 0;
    } catch (e) {
      consecutiveFails += 1;
      console.warn(`Chunk ${i + 1} failed`, e);
      if (collected.length === 0 && consecutiveFails >= 2) throw e;
      if (collected.length === 0 && i === chunks.length - 1) throw e;
      // retry once on first fail of this chunk
      if (consecutiveFails === 1) {
        try {
          batch = await generateBatch(exam.title, chunk, Math.max(5, Math.floor(perChunk / 2)), avoid, partLabel);
          consecutiveFails = 0;
        } catch (e2) {
          if (collected.length === 0 && i === chunks.length - 1) throw e2;
          continue;
        }
      } else {
        continue;
      }
    }

    for (const q of batch) {
      const key = normKey(q.question || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      collected.push({
        question_number: collected.length + 1,
        question: q.question,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
      });
      remaining -= 1;
      if (remaining <= 0) break;
    }
  }

  if (collected.length === 0) {
    throw new Error(
      "No questions generated. For scanned PDFs: keep the tab open during OCR, then try Gen all Qs again. Or import questions via JSON.",
    );
  }

  return collected.map((q, i) => ({ ...q, question_number: i + 1 }));
}
