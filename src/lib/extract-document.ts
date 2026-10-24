// Client-side document text extraction for TXT, MD, DOCX, DOC, PDF.
// Image-only / scanned PDFs fall back to canvas + Tesseract OCR.

const MIN_TEXT_CHARS = 40;
/** Below this avg chars/page → treat as image PDF and OCR. */
const MIN_CHARS_PER_PAGE = 40;
/** Cap OCR pages so admin stays responsive on very long scans. */
const MAX_OCR_PAGES = 80;
const OCR_SCALE = 1.75;
/** Per-page OCR timeout (ms). Long pages get one retry. */
const OCR_PAGE_TIMEOUT_MS = 45_000;

export type ExtractProgress = {
  phase: "download" | "text" | "ocr" | "done";
  page?: number;
  totalPages?: number;
  message: string;
};

export type ExtractOptions = {
  onProgress?: (p: ExtractProgress) => void;
};

/** Independent copy — never share an ArrayBuffer that pdf.js may detach. */
function cloneBuffer(src: ArrayBuffer): ArrayBuffer {
  const out = new ArrayBuffer(src.byteLength);
  new Uint8Array(out).set(new Uint8Array(src));
  return out;
}

/** Own Uint8Array for pdf.js getDocument (transfer-safe). */
function toPdfBytes(src: ArrayBuffer): Uint8Array {
  const u8 = new Uint8Array(src.byteLength);
  u8.set(new Uint8Array(src));
  return u8;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function setupPdfjs(pdfjs: typeof import("pdfjs-dist")) {
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    workerUrl;
}

async function extractPdfTextLayer(
  pdfjs: typeof import("pdfjs-dist"),
  data: ArrayBuffer,
): Promise<{ text: string; numPages: number }> {
  await setupPdfjs(pdfjs);
  const doc = await pdfjs.getDocument({ data: toPdfBytes(data) }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ");
    parts.push(pageText);
  }
  return { text: parts.join("\n\n").trim(), numPages: doc.numPages };
}

async function renderPageToCanvas(
  page: { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: never) => { promise: Promise<void> } },
  scale: number,
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas not available");
  await (page.render({ canvasContext: ctx, viewport } as never) as { promise: Promise<void> }).promise;
  return canvas;
}

function cleanOcrText(text: string): string {
  return (text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function ocrPdfPages(
  pdfjs: typeof import("pdfjs-dist"),
  data: ArrayBuffer,
  numPages: number,
  onProgress?: (p: ExtractProgress) => void,
): Promise<string> {
  await setupPdfjs(pdfjs);
  const doc = await pdfjs.getDocument({ data: toPdfBytes(data) }).promise;
  const pages = Math.min(numPages || doc.numPages, MAX_OCR_PAGES);

  onProgress?.({
    phase: "ocr",
    page: 0,
    totalPages: pages,
    message: `Starting OCR on ${pages} page(s)… (scanned PDFs can take several minutes)`,
  });

  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng", 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd.wasm.js",
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
    logger: () => {},
  });

  const parts: string[] = [];
  let failedPages = 0;

  try {
    for (let i = 1; i <= pages; i++) {
      onProgress?.({
        phase: "ocr",
        page: i,
        totalPages: pages,
        message: `OCR page ${i}/${pages}… keep this tab open`,
      });

      let pageOk = false;
      for (let attempt = 1; attempt <= 2 && !pageOk; attempt++) {
        try {
          const page = await doc.getPage(i);
          const scale = attempt === 1 ? OCR_SCALE : Math.max(1.25, OCR_SCALE - 0.25);
          const canvas = await withTimeout(
            renderPageToCanvas(page, scale),
            OCR_PAGE_TIMEOUT_MS,
            `Render page ${i}`,
          );
          const result = await withTimeout(
            worker.recognize(canvas),
            OCR_PAGE_TIMEOUT_MS,
            `OCR page ${i}`,
          );
          const cleaned = cleanOcrText(result.data?.text || "");
          if (cleaned) parts.push(cleaned);
          canvas.width = 0;
          canvas.height = 0;
          pageOk = true;
        } catch (err) {
          console.warn(`OCR page ${i} attempt ${attempt} failed`, err);
          if (attempt === 2) failedPages += 1;
        }
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  if (doc.numPages > MAX_OCR_PAGES) {
    parts.push(`\n[OCR note: only first ${MAX_OCR_PAGES} of ${doc.numPages} pages were read.]`);
  }
  if (failedPages > 0) {
    parts.push(`\n[OCR note: ${failedPages} page(s) failed and were skipped.]`);
  }

  const text = parts.join("\n\n").trim();
  if (!text) {
    throw new Error(
      failedPages > 0
        ? `OCR failed on all ${pages} page(s). Try a clearer scan, a smaller PDF, or a text-based PDF.`
        : "OCR produced no text. The scan may be too low quality.",
    );
  }
  return text;
}

export async function extractDocumentText(file: File, options?: ExtractOptions): Promise<string> {
  const onProgress = options?.onProgress;
  const name = file.name.toLowerCase();
  const type = file.type;

  if (name.endsWith(".txt") || name.endsWith(".md") || type.startsWith("text/")) {
    return await file.text();
  }

  if (name.endsWith(".docx") || type.includes("officedocument.wordprocessingml")) {
    // @ts-expect-error - mammoth browser bundle has no types
    const mammoth = await import("mammoth/mammoth.browser");
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return (result.value as string).trim();
  }

  if (name.endsWith(".doc") || type === "application/msword") {
    throw new Error(
      "Legacy .doc files can’t be read in the browser. Save as .docx or PDF, or link the file in Admin so the server can open it.",
    );
  }

  if (name.endsWith(".pdf") || type === "application/pdf") {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    const magic = String.fromCharCode(...head);
    if (magic !== "%PDF-") {
      throw new Error(
        "Invalid PDF structure — this file is not a real PDF (often a Google Drive preview page). Use a public direct link or Telegram upload.",
      );
    }
    try {
      const pdfjs = await import("pdfjs-dist");
      // Keep a master copy; every pdf.js call gets its own independent clone.
      const master = cloneBuffer(await file.arrayBuffer());
      onProgress?.({ phase: "text", message: "Reading PDF text layer…" });
      const { text, numPages } = await extractPdfTextLayer(pdfjs, cloneBuffer(master));
      const avg = numPages > 0 ? text.length / numPages : 0;

      if (text.length >= MIN_TEXT_CHARS && avg >= MIN_CHARS_PER_PAGE) {
        onProgress?.({ phase: "done", message: `Extracted text from ${numPages} page(s)` });
        return text;
      }

      // Scanned / screenshot PDF → OCR each page
      const ocrText = await ocrPdfPages(pdfjs, cloneBuffer(master), numPages, onProgress);
      if (ocrText.length >= MIN_TEXT_CHARS) {
        onProgress?.({ phase: "done", message: "OCR finished" });
        return ocrText;
      }

      throw new Error(
        "This PDF has almost no readable text (likely pure images). OCR could not recover enough content. Try a clearer scan or a text PDF.",
      );
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      if (/detached ArrayBuffer/i.test(msg)) {
        throw new Error(
          "PDF buffer error while reading. Close other tabs using this file and try Gen all Qs again.",
        );
      }
      if (/timed out/i.test(msg)) {
        throw new Error(
          `${msg} — try fewer pages (split the PDF) or a clearer scan, then Gen all Qs again.`,
        );
      }
      if (/invalid pdf/i.test(msg)) {
        throw new Error(
          "Invalid PDF structure. For Google Drive files: Share → Anyone with the link, then paste the link again (or use Telegram).",
        );
      }
      throw e;
    }
  }

  throw new Error("Unsupported file type. Please use PDF, DOCX, DOC, or TXT.");
}
