import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Fetch an exam PDF from a public URL or Telegram file_id (server-side),
 * return base64 so the client can extract text with pdfjs.
 */
export const fetchExamPdf = createServerFn({ method: "POST" })
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
    const pdfUrl = (data.pdfUrl || "").trim();
    const fileId = (data.telegramFileId || "").trim();

    let bytes: ArrayBuffer;
    let filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "exam"}.pdf`;

    if (pdfUrl) {
      if (!/^https?:\/\//i.test(pdfUrl)) {
        throw new Error("PDF URL must start with http:// or https://");
      }
      const res = await fetch(pdfUrl, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Could not download PDF (${res.status})`);
      }
      bytes = await res.arrayBuffer();
      const cd = res.headers.get("content-disposition") || "";
      const m = /filename="?([^";]+)"?/i.exec(cd);
      if (m?.[1]) filename = m[1];
    } else if (fileId) {
      const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
      if (!token) {
        throw new Error(
          "TELEGRAM_BOT_TOKEN is not set on the server. Add it in Vercel env to load Telegram PDFs, or add a public pdfUrl in Admin.",
        );
      }
      const metaRes = await fetch(
        `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
        { cache: "no-store" },
      );
      const meta = (await metaRes.json()) as {
        ok?: boolean;
        description?: string;
        result?: { file_path?: string; file_size?: number };
      };
      if (!meta.ok || !meta.result?.file_path) {
        throw new Error(meta.description || "Telegram getFile failed. Re-upload the PDF to the bot.");
      }
      const path = meta.result.file_path;
      if (path.toLowerCase().endsWith(".pdf")) {
        filename = path.split("/").pop() || filename;
      }
      const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
        cache: "no-store",
      });
      if (!fileRes.ok) {
        throw new Error(`Telegram file download failed (${fileRes.status})`);
      }
      bytes = await fileRes.arrayBuffer();
    } else {
      throw new Error("This exam has no PDF URL or Telegram file_id yet.");
    }

    if (!bytes || bytes.byteLength < 100) {
      throw new Error("Downloaded file is empty or too small.");
    }
    if (bytes.byteLength > 12 * 1024 * 1024) {
      throw new Error("PDF is larger than 12MB — use a smaller file.");
    }

    const base64 = Buffer.from(bytes).toString("base64");
    return {
      filename,
      mimeType: "application/pdf",
      base64,
      size: bytes.byteLength,
    };
  });
