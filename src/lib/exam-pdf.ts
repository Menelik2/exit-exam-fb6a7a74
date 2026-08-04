import type { ExamQuestion } from "@/lib/exam.functions";

type Meta = {
  title: string;
  difficulty: string;
};

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export async function downloadExamPdf(questions: ExamQuestion[], meta: Meta) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeBlock = (
    text: string,
    opts: { size?: number; style?: "normal" | "bold" | "italic"; indent?: number; gap?: number } = {}
  ) => {
    const size = opts.size ?? 11;
    const style = opts.style ?? "normal";
    const indent = opts.indent ?? 0;
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, contentW - indent) as string[];
    const lh = size * 1.35;
    for (const line of lines) {
      ensureSpace(lh);
      doc.text(line, margin + indent, y);
      y += lh;
    }
    y += opts.gap ?? 0;
  };

  // ---- Header ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Exam Paper", margin, y);
  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(
    `${meta.title} · ${meta.difficulty} · ${questions.length} question${questions.length === 1 ? "" : "s"}`,
    margin,
    y
  );
  y += 14;
  doc.text(
    `Generated ${new Date().toLocaleString()} · Answer key on the final page(s)`,
    margin,
    y
  );
  y += 12;
  doc.setTextColor(0);
  doc.setDrawColor(180);
  doc.line(margin, y, pageW - margin, y);
  y += 20;

  // ---- Section 1: questions + options only ----
  writeBlock("SECTION 1 — QUESTIONS", { size: 12, style: "bold", gap: 10 });

  questions.forEach((q, i) => {
    ensureSpace(70);
    writeBlock(`${i + 1}. ${q.question}`, { size: 11, style: "normal", gap: 4 });
    q.options.forEach((opt, oi) => {
      writeBlock(`${LETTERS[oi] ?? oi + 1}. ${opt}`, { size: 10.5, indent: 18 });
    });
    y += 10;
  });

  // ---- Section 2: answer key ----
  doc.addPage();
  y = margin;
  writeBlock("SECTION 2 — ANSWER KEY", { size: 12, style: "bold", gap: 6 });
  writeBlock("Correct answers for all questions, with explanations.", {
    size: 9.5,
    style: "italic",
    gap: 12,
  });

  questions.forEach((q, i) => {
    const idx = q.options.findIndex((o) => o === q.correct_answer);
    const letter = idx >= 0 ? (LETTERS[idx] ?? String(idx + 1)) : "-";
    ensureSpace(50);
    writeBlock(`${i + 1}. ${letter}. ${q.correct_answer}`, { size: 11, style: "bold", gap: 2 });
    if (q.explanation) {
      writeBlock(q.explanation, { size: 9.5, indent: 14, gap: 8 });
    } else {
      y += 8;
    }
  });

  // ---- Page numbers ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(130);
    doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 24, { align: "right" });
  }

  const slug =
    meta.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "exam";
  doc.save(`${slug}-exam.pdf`);
}
