import { extractDocumentText, type ExtractProgress } from "@/lib/extract-document";
import type { ExamEntry, StoredQuestion } from "@/components/admin-types";

const CHUNK_SIZE = 5000;
const CHUNK_OVERLAP = 500;
/** Soft cap so catalog + UI stay usable (still covers long exams). */
const MAX_REQUESTED_QUESTIONS = 200;
const PER_CHUNK_MIN = 6;
const PER_CHUNK_MAX = 30;
// Keep each AI response small enough to avoid JSON/output-token truncation.
const AI_BATCH_SIZE = 8;
// Parallelize independent sections without flooding the model/quota.
const MAX_CONCURRENT_CHUNKS = 3;
const GENERATION_TIMEOUT_MS = 60_000;
const MAX_AUTO_COOLDOWN_MS = 60_000;
const CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type GenerationCheckpoint = {
  version: 1;
  source: string;
  text: string;
  results: StoredQuestion[][];
  completed: boolean[];
  updatedAt: number;
  serial?: boolean;
  cooldownUntil?: number;
};

const checkpoints = new Map<string, GenerationCheckpoint>();

function checkpointKey(exam: ExamEntry, numQuestions: number) {
  return `exam-generation:v1:${exam.id}:${numQuestions}`;
}

function sourceKey(exam: ExamEntry) {
  return JSON.stringify([exam.title, exam.pdfUrl, exam.telegramFileId]);
}

function readCheckpoint(exam: ExamEntry, numQuestions: number): GenerationCheckpoint | undefined {
  const key = checkpointKey(exam, numQuestions);
  let value = checkpoints.get(key);
  if (!value) {
    try {
      value = JSON.parse(sessionStorage.getItem(key) || "null") || undefined;
    } catch { /* In-memory resume still works when storage is unavailable. */ }
  }
  if (!value || value.version !== 1 || value.source !== sourceKey(exam) ||
      !Number.isFinite(value.updatedAt) ||
      Date.now() - value.updatedAt > CHECKPOINT_MAX_AGE_MS ||
      !Array.isArray(value.results) || !value.results.every((part) => Array.isArray(part) &&
        part.every((q) => q && typeof q.question === "string" && Array.isArray(q.options))) ||
      !Array.isArray(value.completed) || !value.completed.every((done) => typeof done === "boolean") ||
      typeof value.text !== "string") return;
  checkpoints.set(key, value);
  return value;
}

export function hasPendingExamGeneration(exam: ExamEntry, numQuestions = 0): boolean {
  return !!readCheckpoint(exam, numQuestions)?.results.some((part) => part.length > 0);
}

export function discardExamGenerationProgress(exam: ExamEntry, numQuestions = 0) {
  const key = checkpointKey(exam, numQuestions);
  checkpoints.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}

class GenerationError extends Error {
  readonly retryable: boolean;
  readonly status: number;
  readonly retryAfterMs: number;

  constructor(message: string, retryable: boolean, status = 0, retryAfterMs = 0) {
    super(message);
    this.retryable = retryable;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

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
  if (len < 3000) return 10;
  if (len < 5000) return 20;
  return PER_CHUNK_MAX;
}

/** Detect numbered MCQs in the source so "Gen all" targets the paper's actual count. */
function detectSourceQuestionCount(text: string): number {
  const numbers = new Set<number>();
  const pattern = /^\s*(?:question\s*)?(\d{1,3})\s*[.)\-:]\s+\S/gim;
  for (const match of text.matchAll(pattern)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= 300) numbers.add(n);
  }
  // Numbered exams commonly start at 1 and end at the total question count.
  if (!numbers.has(1) || numbers.size < 10) return 0;
  const max = Math.max(...numbers);
  return max >= numbers.size - 3 ? max : numbers.size;
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
  // Never silently truncate an exam: doing so would make "Gen all Qs" incomplete.
  if (text.length > 1_500_000) {
    throw new Error(
      `This document is too large to process safely (${text.length.toLocaleString()} characters). Split it into smaller exam files and generate each part separately. No questions were saved.`,
    );
  }
  return text;
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
    signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    body: JSON.stringify({
      documentName: `${documentName} (${partLabel})`,
      documentText: chunkTextContent,
      numQuestions,
      avoid,
    }),
  });
  const genData = (await genRes.json().catch(() => ({}))) as {
    ok?: boolean;
    questions?: StoredQuestion[];
    error?: string;
    retryable?: boolean;
    retryAfterSeconds?: number;
  };
  if (!genRes.ok || genData.ok === false) {
    const serviceError = genRes.status === 429 || genRes.status === 503;
    const retrySeconds = Number(genData.retryAfterSeconds || genRes.headers.get("Retry-After"));
    const retryAfterMs = Number.isFinite(retrySeconds) && retrySeconds > 0
      ? retrySeconds * 1000 : genRes.status === 429 ? 30_000 : 5_000;
    const retryable = genData.retryable !== false && (
      genRes.status === 408 || genRes.status === 429 || genRes.status >= 500
    ) && (!serviceError || retryAfterMs <= MAX_AUTO_COOLDOWN_MS);
    throw new GenerationError(
      genData.error || `Generation failed (${genRes.status})`,
      retryable,
      genRes.status,
      retryAfterMs,
    );
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

  onProgress?.({
    phase: "done",
    message: `Text ready (${fullText.length.toLocaleString()} chars, ${chunks.length} part(s)). Generating questions…`,
  });

  const wantAll = !numQuestions || numQuestions <= 0;
  const sourceQuestionCount = wantAll ? detectSourceQuestionCount(fullText) : 0;
  const estimatedCount = chunks.reduce((total, chunk) => total + questionsForChunk(chunk.length), 0);
  const target = wantAll
    ? (sourceQuestionCount || estimatedCount)
    : Math.min(MAX_REQUESTED_QUESTIONS, Math.max(5, Math.round(numQuestions)));

  const totalChunkChars = chunks.reduce((total, chunk) => total + chunk.length, 0);
  let charsAllocated = 0;
  let budgetAllocated = 0;
  const budgets = chunks.map((chunk) => {
    charsAllocated += chunk.length;
    const cumulativeBudget = Math.round(target * charsAllocated / totalChunkChars);
    const budget = cumulativeBudget - budgetAllocated;
    budgetAllocated = cumulativeBudget;
    return budget;
  });

  // Each worker owns a section and its avoid list. Keep results indexed by
  // section so a faster response cannot reorder questions from the document.
  const checkpoint = readCheckpoint(exam, numQuestions);
  const canResume = checkpoint?.text === fullText &&
    checkpoint.results.length === chunks.length && checkpoint.completed.length === chunks.length;
  if (!canResume) discardExamGenerationProgress(exam, numQuestions);
  const results: StoredQuestion[][] = canResume
    ? checkpoint.results.map((part, i) => part.slice(0, budgets[i]))
    : chunks.map(() => []);
  const completed = canResume ? [...checkpoint.completed] : chunks.map(() => false);
  let nextChunk = 0;
  let generatedCount = results.reduce((total, part) => total + part.length, 0);
  let failure: Error | undefined;
  let rateLimited = canResume && checkpoint.serial === true;
  let cooldownUntil = canResume && Number.isFinite(checkpoint.cooldownUntil)
    ? Math.min(checkpoint.cooldownUntil!, Date.now() + MAX_AUTO_COOLDOWN_MS) : 0;
  let recoveryQueue = Promise.resolve();

  const saveCheckpoint = () => {
    const value: GenerationCheckpoint = {
      version: 1, source: sourceKey(exam), text: fullText,
      results: results.map((part) => [...part]), completed: [...completed], updatedAt: Date.now(),
      serial: rateLimited, cooldownUntil,
    };
    const key = checkpointKey(exam, numQuestions);
    checkpoints.set(key, value);
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep in memory. */ }
  };

  if (generatedCount > 0) {
    onProgress?.({ phase: "done", questionsSoFar: generatedCount,
      message: `Resuming with ${generatedCount} questions already generated…` });
  }

  const requestBatch = async (...args: Parameters<typeof generateBatch>) => {
    // After a quota/service rejection, serialize subsequent requests across
    // ALL section workers and share one cooldown. Avoid a synchronized retry burst.
    let release: (() => void) | undefined;
    if (rateLimited) {
      const previous = recoveryQueue;
      recoveryQueue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
    }
    try {
      while (!failure && Date.now() < cooldownUntil) {
        const remainingMs = cooldownUntil - Date.now();
        onProgress?.({ phase: "done", questionsSoFar: generatedCount,
          message: `AI service busy. Keeping ${generatedCount} questions; retrying in ${Math.ceil(remainingMs / 1000)}s…` });
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000, remainingMs)));
      }
      if (failure) return [];
      try {
        return await generateBatch(...args);
      } catch (error) {
        if (error instanceof GenerationError && error.retryable &&
            (error.status === 429 || error.status === 503)) {
          rateLimited = true;
          cooldownUntil = Math.max(cooldownUntil, Date.now() + error.retryAfterMs);
        }
        throw error;
      }
    } finally { release?.(); }
  };

  const generateChunk = async (i: number) => {
    const chunk = chunks[i];
    const chunkBudget = budgets[i];
    const partLabel = chunks.length === 1 ? "full document" : `part ${i + 1}/${chunks.length}`;
    const collected = results[i];
    const seen = new Set(collected.map((q) => normKey(q.question)));
    let stalledBatches = 0;

    while (collected.length < chunkBudget && stalledBatches < 2 && !failure) {
      const requested = Math.min(AI_BATCH_SIZE, chunkBudget - collected.length);
      // Include this section's questions first, including ones from earlier
      // batches, to avoid paying for repeated questions as the section fills.
      const avoid = [
        ...collected.map((q) => q.question),
        ...results.flatMap((qs, index) => index === i ? [] : qs.map((q) => q.question)).slice(-25),
      ].slice(0, 80);
      onProgress?.({
        phase: "done",
        chunk: i + 1,
        totalChunks: chunks.length,
        questionsSoFar: generatedCount,
        message: `Generating ${partLabel}: ${generatedCount}/${target} questions ready…`,
      });

      let batch: StoredQuestion[] = [];
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3 && !failure; attempt++) {
        try {
          batch = await requestBatch(
            exam.title,
            chunk,
            requested,
            avoid,
            partLabel,
          );
          if (batch.length > 0) break;
          lastError = new Error(`No questions returned for ${partLabel}`);
        } catch (error) {
          lastError = error;
          if (error instanceof GenerationError && !error.retryable) break;
          if (error instanceof Error && /TimeoutError|AbortError/.test(error.name)) break;
        }
        if (attempt < 3 && !failure) {
          onProgress?.({
            phase: "done",
            chunk: i + 1,
            totalChunks: chunks.length,
            questionsSoFar: generatedCount,
            message: `${partLabel} failed; retrying (${attempt}/2)…`,
          });
          if (!(lastError instanceof GenerationError &&
              (lastError.status === 429 || lastError.status === 503))) {
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
      }
      if (failure && batch.length === 0) return;
      if (batch.length === 0) {
        const detail = lastError instanceof Error ? lastError.message : "";
        throw new Error(`Could not generate questions for ${partLabel}. ${detail}`.trim());
      }

      let addedThisBatch = 0;
      for (const q of batch) {
        const key = normKey(q.question || "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        collected.push(q);
        addedThisBatch += 1;
        generatedCount += 1;
        if (collected.length >= chunkBudget) break;
      }
      stalledBatches = addedThisBatch === 0 ? stalledBatches + 1 : 0;
      saveCheckpoint();
      onProgress?.({
        phase: "done",
        chunk: i + 1,
        totalChunks: chunks.length,
        questionsSoFar: generatedCount,
        message: `Generated ${generatedCount}/${target} questions…`,
      });
    }
    if (collected.length >= chunkBudget || stalledBatches >= 2) {
      completed[i] = true;
      saveCheckpoint();
    }
  };

  const worker = async () => {
    while (nextChunk < chunks.length && !failure) {
      const i = nextChunk++;
      if (budgets[i] === 0 || completed[i]) continue;
      try {
        await generateChunk(i);
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error(String(error));
      }
    }
  };
  // Drain active workers before rejecting so no old generation continues after
  // the UI re-enables its button. A failed section must not overwrite a quiz.
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_CHUNKS, chunks.length) }, worker));
  if (failure) {
    saveCheckpoint();
    const retained = results.reduce((total, part) => total + part.length, 0);
    throw new Error(`${failure.message} ${retained > 0
      ? `${retained} questions kept in this tab. Click Resume generation to continue.`
      : "No questions generated yet. Please try again."}`);
  }

  const seen = new Set<string>();
  const collected = results.flat().filter((q) => {
    const key = normKey(q.question || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (collected.length === 0) {
    throw new Error(
      "No questions generated. For scanned PDFs: keep the tab open during OCR, then try Gen all Qs again. Or import questions via JSON.",
    );
  }

  return collected.map((q, i) => ({ ...q, question_number: i + 1 }));
}
