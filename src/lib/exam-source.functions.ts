import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function guessMime(filename: string): string {
  const n = filename.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (n.endsWith(".doc")) return "application/msword";
  if (n.endsWith(".txt") || n.endsWith(".md")) return "text/plain";
  return "application/octet-stream";
}

function extFromPath(path: string): string {
  const base = path.split("?")[0].split("/").pop() || "";
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i).toLowerCase() : "";
}

function driveFileIdFromUrl(url: string): string | null {
  const a = /drive\.google\.com\/file\/d\/([^/]+)/i.exec(url)?.[1];
  if (a) return a;
  const b = /drive\.google\.com\/open\?[^#]*id=([^&]+)/i.exec(url)?.[1];
  if (b) return b;
  const c = /drive\.google\.com\/uc\?[^#]*id=([^&]+)/i.exec(url)?.[1];
  if (c) return c;
  return null;
}

/** Turn share/view links into direct file downloads when possible. */
function normalizeDocumentUrl(raw: string): string {
  const url = raw.trim();

  const driveId = driveFileIdFromUrl(url);
  if (driveId) {
    return `https://drive.google.com/uc?export=download&confirm=t&id=${driveId}`;
  }

  const gdoc = /docs\.google\.com\/document\/d\/([^/]+)/i.exec(url);
  if (gdoc?.[1]) {
    return `https://docs.google.com/document/d/${gdoc[1]}/export?format=docx`;
  }

  if (/dropbox\.com\//i.test(url)) {
    try {
      const u = new URL(url);
      u.searchParams.set("dl", "1");
      return u.toString();
    } catch {
      return url.replace("?dl=0", "?dl=1").replace("&dl=0", "&dl=1");
    }
  }

  return url;
}

function sniffKind(buf: Buffer): "pdf" | "docx" | "doc" | "html" | "zip" | "text" | "unknown" {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return "zip";
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    return "doc";
  }
  const head = buf.subarray(0, Math.min(512, buf.length)).toString("utf8").toLowerCase();
  if (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("google drive") ||
    head.includes("accounts.google.com") ||
    head.includes("virus scan warning")
  ) {
    return "html";
  }
  const sample = buf.subarray(0, Math.min(200, buf.length)).toString("utf8");
  if (/^[\x09\x0a\x0d\x20-\x7e]{20,}/.test(sample)) return "text";
  return "unknown";
}

async function extractDocxText(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: buf });
  return (result.value || "").trim();
}

async function extractDocText(buf: Buffer): Promise<string> {
  try {
    const mod = await import("word-extractor");
    const WordExtractor =
      (mod as { default?: new () => { extract: (b: Buffer) => Promise<{ getBody: () => string }> } }).default ??
      (mod as unknown as new () => { extract: (b: Buffer) => Promise<{ getBody: () => string }> });
    const extractor = new WordExtractor();
    const extracted = await extractor.extract(buf);
    return (extracted.getBody() || "").trim();
  } catch {
    throw new Error(
      "Could not read this .doc file. Please re-save it as .docx or PDF and upload again.",
    );
  }
}

/** Server-side PDF text extraction (no base64 to the browser). */
async function extractPdfText(buf: Buffer): Promise<string> {
  if (buf.length < 5 || buf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(
      "Invalid PDF structure — file is not a real PDF (often a Google Drive HTML page). Set sharing to Anyone with the link, or upload via Telegram / Setup.",
    );
  }

  // Prefer legacy build for Node; fall back to main entry.
  let pdfjs: typeof import("pdfjs-dist");
  try {
    pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
  } catch {
    pdfjs = await import("pdfjs-dist");
  }

  // Disable worker in serverless — run on main thread.
  try {
    (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = "";
  } catch {
    /* ignore */
  }

  const data = new Uint8Array(buf);
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const maxPages = Math.min(doc.numPages, 80);
  const parts: string[] = [];
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it) => ("str" in it ? String((it as { str: string }).str) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) parts.push(pageText);
  }

  const text = parts.join("\n\n").trim();
  if (text.length < 40) {
    throw new Error(
      "Could not read enough text from this PDF (likely a scanned image). Use a text PDF, DOCX, or OCR the file first.",
    );
  }
  // Cap payload size for AI generation downstream
  return text.length > 190000 ? text.slice(0, 190000) : text;
}

async function fetchOnce(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<{ bytes: Buffer; filename: string; contentType: string; finalUrl: string }> {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ExitExamPractice/1.0; +https://yeniexams.vercel.app)",
      Accept:
        "application/pdf,application/octet-stream,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,*/*",
      ...extraHeaders,
    },
  });

  if (!res.ok) {
    throw new Error(`Could not download document (${res.status}). Check the link is public.`);
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  let filename = "exam.bin";
  const cd = res.headers.get("content-disposition") || "";
  const m = /filename\*?=(?:UTF-8'')?["']?([^-";\n]+)/i.exec(cd);
  if (m?.[1]) {
    try {
      filename = decodeURIComponent(m[1].replace(/["']/g, "").trim());
    } catch {
      filename = m[1].replace(/["']/g, "").trim();
    }
  } else {
    const fromUrl = extFromPath(url);
    if (fromUrl && fromUrl.length <= 8) filename = `exam${fromUrl}`;
  }

  return {
    bytes,
    filename,
    contentType: (res.headers.get("content-type") || "").toLowerCase(),
    finalUrl: res.url || url,
  };
}

async function downloadUrl(url: string): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
  const normalized = normalizeDocumentUrl(url);
  let { bytes, filename, contentType, finalUrl } = await fetchOnce(normalized);

  // Google Drive virus-scan / confirm interstitial
  let kind = sniffKind(bytes);
  if (kind === "html") {
    const html = bytes.toString("utf8");
    const confirm =
      /confirm=([0-9A-Za-z_-]+)/.exec(html)?.[1] ||
      /name="confirm"\s+value="([^"]+)"/.exec(html)?.[1];
    const id =
      driveFileIdFromUrl(normalized) ||
      driveFileIdFromUrl(finalUrl) ||
      /[?&]id=([0-9A-Za-z_-]+)/.exec(normalized)?.[1] ||
      /name="id"\s+value="([^"]+)"/.exec(html)?.[1];

    if (id) {
      const candidates = [
        confirm
          ? `https://drive.google.com/uc?export=download&confirm=${confirm}&id=${id}`
          : null,
        `https://drive.google.com/uc?export=download&confirm=t&id=${id}`,
        `https://drive.google.com/uc?export=download&id=${id}`,
        // older large-file path
        `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
      ].filter(Boolean) as string[];

      for (const retry of candidates) {
        try {
          const again = await fetchOnce(retry);
          if (sniffKind(again.bytes) !== "html" && again.bytes.byteLength > 200) {
            bytes = again.bytes;
            contentType = again.contentType;
            if (again.filename && again.filename !== "exam.bin") filename = again.filename;
            kind = sniffKind(bytes);
            break;
          }
        } catch {
          /* try next */
        }
      }
    }
  }

  if (sniffKind(bytes) === "html") {
    throw new Error(
      "This Google Drive / web link returned a page, not a file. Set the file to “Anyone with the link → Viewer”, wait a minute, and try again — or paste a direct download URL / use Telegram file_id / upload in Setup.",
    );
  }

  return { bytes, filename, contentType };
}

export type ExamDocResult = {
  kind: "text";
  filename: string;
  mimeType: string;
  text: string;
  size: number;
};

export const fetchExamDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        title: z.string().min(1).max(400),
        pdfUrl: z.string().max(2000).nullable().optional(),
        telegramFileId: z.string().max(500).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<ExamDocResult> => {
    const title = data.title.trim();
    const fileUrl = (data.pdfUrl || "").trim();
    const fileId = (data.telegramFileId || "").trim();

    let bytes: Buffer;
    let filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "exam"}.pdf`;
    let contentType = "";

    if (fileUrl) {
      if (!/^https?:\/\//i.test(fileUrl)) {
        throw new Error("Document URL must start with http:// or https://");
      }
      const dl = await downloadUrl(fileUrl);
      bytes = dl.bytes;
      contentType = dl.contentType;
      if (dl.filename && dl.filename !== "exam.bin") filename = dl.filename;

      const kind = sniffKind(bytes);
      if (!extFromPath(filename) || filename.endsWith(".bin")) {
        if (kind === "pdf") filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "exam"}.pdf`;
        else if (kind === "zip") filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "exam"}.docx`;
        else if (kind === "doc") filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "exam"}.doc`;
        else if (kind === "text") filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "exam"}.txt`;
        else if (contentType.includes("pdf")) filename = filename.replace(/\.\w+$/, "") + ".pdf";
        else if (contentType.includes("wordprocessingml"))
          filename = filename.replace(/\.\w+$/, "") + ".docx";
      }
    } else if (fileId) {
      const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
      if (!token) {
        throw new Error(
          "TELEGRAM_BOT_TOKEN is not set on the server. Add it in Vercel env to load Telegram files, or set a public document URL in Admin.",
        );
      }
      const metaRes = await fetch(
        `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
        { cache: "no-store" },
      );
      const meta = (await metaRes.json()) as {
        ok?: boolean;
        description?: string;
        result?: { file_path?: string };
      };
      if (!meta.ok || !meta.result?.file_path) {
        throw new Error(meta.description || "Telegram getFile failed. Re-upload the file to the bot.");
      }
      const path = meta.result.file_path;
      const leaf = path.split("/").pop() || "";
      if (leaf) filename = leaf;
      const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
        cache: "no-store",
      });
      if (!fileRes.ok) {
        throw new Error(`Telegram file download failed (${fileRes.status})`);
      }
      bytes = Buffer.from(await fileRes.arrayBuffer());
    } else {
      throw new Error("This exam has no document URL or Telegram file_id yet.");
    }

    if (!bytes || bytes.byteLength < 50) {
      throw new Error("Downloaded file is empty or too small.");
    }
    if (bytes.byteLength > 12 * 1024 * 1024) {
      throw new Error("File is larger than 12MB — use a smaller file.");
    }

    const kind = sniffKind(bytes);
    let lower = filename.toLowerCase();

    if (kind === "pdf" && !lower.endsWith(".pdf")) {
      filename = filename.replace(/\.\w+$/, "") + ".pdf";
      lower = filename.toLowerCase();
    }
    if (kind === "zip" && !lower.endsWith(".docx")) {
      filename = filename.replace(/\.\w+$/, "") + ".docx";
      lower = filename.toLowerCase();
    }
    if (kind === "doc" && !lower.endsWith(".doc")) {
      filename = filename.replace(/\.\w+$/, "") + ".doc";
      lower = filename.toLowerCase();
    }

    const mimeType = guessMime(filename);

    if (kind === "html") {
      throw new Error(
        "Download looked like a web page (not a PDF/DOCX). Use a public direct file link or Telegram upload.",
      );
    }

    // Always return extracted text — never ship multi‑MB base64 through the SPA RPC.
    if (lower.endsWith(".docx") || (kind === "zip" && lower.endsWith(".docx"))) {
      const text = await extractDocxText(bytes);
      if (text.length < 40) throw new Error("Could not read enough text from this DOCX file.");
      return {
        kind: "text",
        filename,
        mimeType,
        text: text.length > 190000 ? text.slice(0, 190000) : text,
        size: bytes.byteLength,
      };
    }

    if (lower.endsWith(".doc") || kind === "doc") {
      const text = await extractDocText(bytes);
      if (text.length < 40) {
        throw new Error("Could not read enough text from this DOC file. Try saving as .docx.");
      }
      return {
        kind: "text",
        filename,
        mimeType,
        text: text.length > 190000 ? text.slice(0, 190000) : text,
        size: bytes.byteLength,
      };
    }

    if (lower.endsWith(".txt") || lower.endsWith(".md") || kind === "text") {
      const text = bytes.toString("utf8").trim();
      if (text.length < 40) throw new Error("Text file is too short.");
      return {
        kind: "text",
        filename,
        mimeType: "text/plain",
        text: text.length > 190000 ? text.slice(0, 190000) : text,
        size: bytes.byteLength,
      };
    }

    if (kind === "pdf" || lower.endsWith(".pdf") || contentType.includes("pdf")) {
      const text = await extractPdfText(bytes);
      return {
        kind: "text",
        filename: lower.endsWith(".pdf") ? filename : `${filename}.pdf`,
        mimeType: "application/pdf",
        text,
        size: bytes.byteLength,
      };
    }

    throw new Error(
      "Unsupported or unreadable file. Use PDF, DOCX, or DOC with a public direct link (or Telegram file_id).",
    );
  });

/** @deprecated use fetchExamDocument */
export const fetchExamPdf = fetchExamDocument;
