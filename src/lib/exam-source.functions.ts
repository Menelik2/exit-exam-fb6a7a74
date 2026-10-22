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

/** Turn share/view links into direct file downloads when possible. */
function normalizeDocumentUrl(raw: string): string {
  const url = raw.trim();

  const driveFile = /drive\.google\.com\/file\/d\/([^/]+)/i.exec(url);
  if (driveFile?.[1]) {
    return `https://drive.google.com/uc?export=download&confirm=t&id=${driveFile[1]}`;
  }
  const driveOpen = /drive\.google\.com\/open\?[^#]*id=([^&]+)/i.exec(url);
  if (driveOpen?.[1]) {
    return `https://drive.google.com/uc?export=download&confirm=t&id=${driveOpen[1]}`;
  }
  const driveUc = /drive\.google\.com\/uc\?/i.test(url);
  if (driveUc && !/[?&]export=download/i.test(url)) {
    const id = /[?&]id=([^&]+)/i.exec(url)?.[1];
    if (id) return `https://drive.google.com/uc?export=download&confirm=t&id=${id}`;
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
  const head = buf.subarray(0, Math.min(256, buf.length)).toString("utf8").toLowerCase();
  if (head.includes("<!doctype html") || head.includes("<html") || head.includes("google drive")) {
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

async function downloadUrl(url: string): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
  const normalized = normalizeDocumentUrl(url);
  const res = await fetch(normalized, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      "User-Agent": "ExitExamPractice/1.0 (document-fetch)",
      Accept:
        "application/pdf,application/octet-stream,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,*/*",
    },
  });

  if (!res.ok) {
    throw new Error(`Could not download document (${res.status}). Check the link is public.`);
  }

  let bytes = Buffer.from(await res.arrayBuffer());
  let filename = "exam.bin";
  const cd = res.headers.get("content-disposition") || "";
  const m = /filename\*?=(?:UTF-8'')?["']?([^-";]+)/i.exec(cd);
  if (m?.[1]) {
    try {
      filename = decodeURIComponent(m[1].replace(/["']/g, ""));
    } catch {
      filename = m[1].replace(/["']/g, "");
    }
  } else {
    const fromUrl = extFromPath(normalized);
    if (fromUrl && fromUrl.length <= 8) filename = `exam${fromUrl}`;
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();

  // Google Drive virus-scan interstitial for larger files
  const kind = sniffKind(bytes);
  if (kind === "html") {
    const html = bytes.toString("utf8");
    const confirm = /confirm=([0-9A-Za-z_-]+)/.exec(html);
    const id =
      /[?&]id=([0-9A-Za-z_-]+)/.exec(normalized)?.[1] ||
      /name="id"\s+value="([^"]+)"/.exec(html)?.[1];
    if (confirm && id) {
      const retry = `https://drive.google.com/uc?export=download&confirm=${confirm[1]}&id=${id}`;
      const res2 = await fetch(retry, {
        cache: "no-store",
        redirect: "follow",
        headers: { "User-Agent": "ExitExamPractice/1.0 (document-fetch)" },
      });
      if (res2.ok) {
        bytes = Buffer.from(await res2.arrayBuffer());
        const cd2 = res2.headers.get("content-disposition") || "";
        const m2 = /filename\*?=(?:UTF-8'')?["']?([^-";]+)/i.exec(cd2);
        if (m2?.[1]) filename = m2[1].replace(/["']/g, "");
      }
    }
  }

  return { bytes, filename, contentType };
}

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
  .handler(async ({ data }) => {
    const title = data.title.trim();
    const fileUrl = (data.pdfUrl || "").trim();
    const fileId = (data.telegramFileId || "").trim();

    let bytes: Buffer;
    let filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "exam"}.pdf`;

    if (fileUrl) {
      if (!/^https?:\/\//i.test(fileUrl)) {
        throw new Error("Document URL must start with http:// or https://");
      }
      const dl = await downloadUrl(fileUrl);
      bytes = dl.bytes;
      if (dl.filename && dl.filename !== "exam.bin") filename = dl.filename;

      const kind = sniffKind(bytes);
      if (kind === "html") {
        throw new Error(
          "This link returned a web page, not a file. For Google Drive: set sharing to “Anyone with the link”, or paste a direct download URL (or use Telegram file_id).",
        );
      }
      if (!extFromPath(filename) || filename.endsWith(".bin")) {
        if (kind === "pdf") filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "exam"}.pdf`;
        else if (kind === "zip") filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "exam"}.docx`;
        else if (kind === "doc") filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "exam"}.doc`;
        else if (kind === "text") filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "exam"}.txt`;
        else if (dl.contentType.includes("pdf")) filename = filename.replace(/\.\w+$/, "") + ".pdf";
        else if (dl.contentType.includes("wordprocessingml"))
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

    if (lower.endsWith(".docx") || (kind === "zip" && lower.endsWith(".docx"))) {
      const text = await extractDocxText(bytes);
      if (text.length < 40) {
        throw new Error("Could not read enough text from this DOCX file.");
      }
      return { kind: "text" as const, filename, mimeType, text, size: bytes.byteLength };
    }

    if (lower.endsWith(".doc") || kind === "doc") {
      const text = await extractDocText(bytes);
      if (text.length < 40) {
        throw new Error("Could not read enough text from this DOC file. Try saving as .docx.");
      }
      return { kind: "text" as const, filename, mimeType, text, size: bytes.byteLength };
    }

    if (lower.endsWith(".txt") || lower.endsWith(".md") || kind === "text") {
      const text = bytes.toString("utf8").trim();
      if (text.length < 40) throw new Error("Text file is too short.");
      return { kind: "text" as const, filename, mimeType: "text/plain", text, size: bytes.byteLength };
    }

    if (kind !== "pdf" && lower.endsWith(".pdf")) {
      throw new Error(
        "Invalid PDF structure — the file is not a real PDF. If you used Google Drive, set the file to “Anyone with the link” and try again, or upload via Telegram.",
      );
    }

    if (kind === "pdf" || lower.endsWith(".pdf")) {
      return {
        kind: "binary" as const,
        filename: lower.endsWith(".pdf") ? filename : filename + ".pdf",
        mimeType: "application/pdf",
        base64: bytes.toString("base64"),
        size: bytes.byteLength,
      };
    }

    throw new Error(
      "Unsupported or unreadable file. Use PDF, DOCX, or DOC with a public direct link (or Telegram file_id).",
    );
  });

/** @deprecated use fetchExamDocument */
export const fetchExamPdf = fetchExamDocument;
