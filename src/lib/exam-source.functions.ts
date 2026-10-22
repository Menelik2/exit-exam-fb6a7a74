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
      const res = await fetch(fileUrl, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Could not download document (${res.status})`);
      }
      bytes = Buffer.from(await res.arrayBuffer());
      const cd = res.headers.get("content-disposition") || "";
      const m = /filename\*?=(?:UTF-8'')?["']?([^-";]+)/i.exec(cd);
      if (m?.[1]) {
        try {
          filename = decodeURIComponent(m[1].replace(/["']/g, ""));
        } catch {
          filename = m[1].replace(/["']/g, "");
        }
      } else {
        const fromUrl = extFromPath(fileUrl);
        if (fromUrl) {
          filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "exam"}${fromUrl}`;
        }
      }
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!extFromPath(filename)) {
        if (ct.includes("pdf")) filename = filename.replace(/\.\w+$/, "") + ".pdf";
        else if (ct.includes("wordprocessingml") || ct.includes("docx"))
          filename = filename.replace(/\.\w+$/, "") + ".docx";
        else if (ct.includes("msword")) filename = filename.replace(/\.\w+$/, "") + ".doc";
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

    const lower = filename.toLowerCase();
    const mimeType = guessMime(filename);

    if (lower.endsWith(".docx")) {
      const text = await extractDocxText(bytes);
      if (text.length < 40) {
        throw new Error("Could not read enough text from this DOCX file.");
      }
      return { kind: "text" as const, filename, mimeType, text, size: bytes.byteLength };
    }

    if (lower.endsWith(".doc")) {
      const text = await extractDocText(bytes);
      if (text.length < 40) {
        throw new Error("Could not read enough text from this DOC file. Try saving as .docx.");
      }
      return { kind: "text" as const, filename, mimeType, text, size: bytes.byteLength };
    }

    if (lower.endsWith(".txt") || lower.endsWith(".md")) {
      const text = bytes.toString("utf8").trim();
      if (text.length < 40) throw new Error("Text file is too short.");
      return { kind: "text" as const, filename, mimeType: "text/plain", text, size: bytes.byteLength };
    }

    return {
      kind: "binary" as const,
      filename,
      mimeType,
      base64: bytes.toString("base64"),
      size: bytes.byteLength,
    };
  });

/** @deprecated use fetchExamDocument */
export const fetchExamPdf = fetchExamDocument;
