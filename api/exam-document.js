/**
 * POST /api/exam-document
 * Body: { title?, pdfUrl?, telegramFileId? }
 *
 * - DOCX/DOC/TXT → JSON { ok, kind:"text", text, filename, mimeType, size }
 * - PDF → raw binary body (application/pdf) so the browser can extract text with pdfjs
 * - Errors → JSON { ok:false, error }
 */

function driveFileIdFromUrl(url) {
  const a = /drive\.google\.com\/file\/d\/([^/]+)/i.exec(url)?.[1];
  if (a) return a;
  const b = /drive\.google\.com\/open\?[^#]*id=([^&]+)/i.exec(url)?.[1];
  if (b) return b;
  const c = /[?&]id=([0-9A-Za-z_-]+)/i.exec(url)?.[1];
  if (c) return c;
  return null;
}

function normalizeDocumentUrl(raw) {
  const url = String(raw || "").trim();
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

function sniffKind(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return "zip";
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0)
    return "doc";
  const head = buf.subarray(0, Math.min(512, buf.length)).toString("utf8").toLowerCase();
  if (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("google drive") ||
    head.includes("accounts.google.com") ||
    head.includes("virus scan warning")
  )
    return "html";
  const sample = buf.subarray(0, Math.min(200, buf.length)).toString("utf8");
  if (/^[\x09\x0a\x0d\x20-\x7e]{20,}/.test(sample)) return "text";
  return "unknown";
}

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_DOCUMENT_HOSTS = new Set(["drive.google.com","docs.google.com","drive.usercontent.google.com","dropbox.com","www.dropbox.com","dl.dropboxusercontent.com"]);
function validateDocumentUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("Invalid document URL."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Only public HTTPS document links are supported.");
  const host = url.hostname.toLowerCase().replace(/\\.$/, "");
  if (!ALLOWED_DOCUMENT_HOSTS.has(host) && !host.endsWith(".googleusercontent.com") && !host.endsWith(".dropboxusercontent.com")) {
    throw new Error("For security, use a public Google Drive, Google Docs, or Dropbox document link.");
  }
  return url;
}
async function readLimitedBody(res, maxBytes = MAX_DOCUMENT_BYTES) {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) { await res.body?.cancel(); throw new Error("File is larger than 15MB."); }
  if (!res.body) throw new Error("The document download returned an empty response.");
  const reader = res.body.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error("File is larger than 15MB."); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}
async function fetchOnce(rawUrl) {
  let url = validateDocumentUrl(rawUrl), res;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      res = await fetch(url, { cache: "no-store", redirect: "manual", signal: controller.signal,
        headers: { "User-Agent": "ExitExamDocumentFetcher/1.0", Accept: "application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/plain, */*" } });
    } finally { clearTimeout(timeout); }
    if (![301,302,303,307,308].includes(res.status)) break;
    const location = res.headers.get("location");
    await res.body?.cancel();
    if (!location || redirects === 5) throw new Error("Document link redirected too many times.");
    url = validateDocumentUrl(new URL(location, url).toString());
  }
  if (!res || !res.ok) throw new Error(`Could not download document (${res?.status || "network error"}). Check the link is public.`);
  const bytes = await readLimitedBody(res);
  let filename = "exam.bin";
  const cd = res.headers.get("content-disposition") || "";
  const m = /filename\\*?=(?:UTF-8'')?["']?([^"';\\n]+)/i.exec(cd);
  if (m?.[1]) { try { filename = decodeURIComponent(m[1].replace(/["']/g, "").trim()); } catch { filename = m[1].replace(/["']/g, "").trim(); } }
  return { bytes, filename, contentType: (res.headers.get("content-type") || "").toLowerCase(), finalUrl: url.toString() };
}

async function downloadUrl(url) {
  const normalized = normalizeDocumentUrl(url);
  let { bytes, filename, contentType, finalUrl } = await fetchOnce(normalized);

  if (sniffKind(bytes) === "html") {
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
        confirm ? `https://drive.google.com/uc?export=download&confirm=${confirm}&id=${id}` : null,
        `https://drive.google.com/uc?export=download&confirm=t&id=${id}`,
        `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
        `https://drive.google.com/uc?export=download&id=${id}`,
      ].filter(Boolean);

      for (const retry of candidates) {
        try {
          const again = await fetchOnce(retry);
          if (sniffKind(again.bytes) !== "html" && again.bytes.byteLength > 200) {
            bytes = again.bytes;
            contentType = again.contentType;
            if (again.filename && again.filename !== "exam.bin") filename = again.filename;
            break;
          }
        } catch {
          /* next */
        }
      }
    }
  }

  if (sniffKind(bytes) === "html") {
    throw new Error(
      'Google Drive returned a web page, not a file. Set sharing to “Anyone with the link → Viewer”, then try again.',
    );
  }

  return { bytes, filename, contentType };
}

async function extractDocxText(buf) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: buf });
  return (result.value || "").trim();
}

async function readBody(req) {
  if (req.body != null) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body || "{}");
      } catch {
        return {};
      }
    }
    if (typeof req.body === "object") return req.body;
  }
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += Buffer.byteLength(chunk);
      if (total > 1024 * 1024) throw new Error("Request body too large");
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = await readBody(req);
    const title = String(body.title || "exam").trim().slice(0, 200) || "exam";
    const fileUrl = String(body.pdfUrl || "").trim();
    const fileId = String(body.telegramFileId || "").trim();

    let bytes;
    let filename = `${title.replace(/[^\w.-]+/g, "_").slice(0, 80)}.pdf`;
    let contentType = "";

    if (fileUrl) {
      if (!/^https?:\/\//i.test(fileUrl)) {
        return json(res, 400, { ok: false, error: "Document URL must start with http:// or https://" });
      }
      const dl = await downloadUrl(fileUrl);
      bytes = dl.bytes;
      contentType = dl.contentType;
      if (dl.filename && dl.filename !== "exam.bin") filename = dl.filename;
    } else if (fileId) {
      const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
      if (!token) {
        return json(res, 500, {
          ok: false,
          error:
            "TELEGRAM_BOT_TOKEN is not set. Add it on Vercel, or use a public document URL in Admin.",
        });
      }
      const metaRes = await fetch(
        `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
        { cache: "no-store" },
      );
      const meta = await metaRes.json();
      if (!meta.ok || !meta.result?.file_path) {
        return json(res, 400, {
          ok: false,
          error: meta.description || "Telegram getFile failed",
        });
      }
      const path = meta.result.file_path;
      const leaf = path.split("/").pop();
      if (leaf) filename = leaf;
      const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
        cache: "no-store",
      });
      if (!fileRes.ok) {
        return json(res, 502, { ok: false, error: `Telegram download failed (${fileRes.status})` });
      }
      bytes = await readLimitedBody(fileRes);
    } else {
      return json(res, 400, { ok: false, error: "No document URL or Telegram file_id" });
    }

    if (!bytes || bytes.byteLength < 50) {
      return json(res, 400, { ok: false, error: "Downloaded file is empty or too small" });
    }
    if (bytes.byteLength > 15 * 1024 * 1024) {
      return json(res, 400, { ok: false, error: "File is larger than 15MB" });
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

    // Text-like formats: extract on server and return JSON
    if (lower.endsWith(".docx") || (kind === "zip" && lower.endsWith(".docx"))) {
      const text = await extractDocxText(bytes);
      if (text.length < 40) {
        return json(res, 422, { ok: false, error: "Could not read enough text from this DOCX" });
      }
      return json(res, 200, {
        ok: true,
        kind: "text",
        filename,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        text: text.length > 190000 ? text.slice(0, 190000) : text,
        size: bytes.byteLength,
      });
    }

    if (lower.endsWith(".txt") || lower.endsWith(".md") || kind === "text") {
      const text = bytes.toString("utf8").trim();
      if (text.length < 40) {
        return json(res, 422, { ok: false, error: "Text file is too short" });
      }
      return json(res, 200, {
        ok: true,
        kind: "text",
        filename,
        mimeType: "text/plain",
        text: text.length > 190000 ? text.slice(0, 190000) : text,
        size: bytes.byteLength,
      });
    }

    // PDF (and unknown binary that looks like PDF): stream bytes to browser
    if (kind === "pdf" || lower.endsWith(".pdf") || contentType.includes("pdf")) {
      const safeName = (filename || "exam.pdf").replace(/["\r\n]/g, "_");
      res.statusCode = 200;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
      res.setHeader("X-Exam-Filename", encodeURIComponent(safeName));
      res.setHeader("X-Exam-Size", String(bytes.byteLength));
      res.end(bytes);
      return;
    }

    if (kind === "doc" || lower.endsWith(".doc")) {
      return json(res, 422, {
        ok: false,
        error: "Legacy .doc is hard to read on the server. Re-save as .docx or PDF.",
      });
    }

    return json(res, 422, {
      ok: false,
      error: "Unsupported file type. Use PDF, DOCX, or TXT with a public link.",
    });
  } catch (e) {
    const message = String(e && e.message || "");
    const clientError = /larger than 15MB|Only public HTTPS|Invalid document URL|For security|redirected too many|returned an empty response/i.test(message);
    return json(res, clientError ? 400 : 502, {
      ok: false,
      error: clientError ? message : "Document fetch failed. Check that the link is public and try again.",
    });
  }
}
