// Client-side document text extraction for TXT, MD, DOCX, DOC, PDF.

export async function extractDocumentText(file: File): Promise<string> {
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
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
        workerUrl;
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      const parts: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((it) => ("str" in it ? (it as { str: string }).str : ""))
          .join(" ");
        parts.push(pageText);
      }
      return parts.join("\n\n").trim();
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
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
