import type { StoredQuestion } from "../components/admin-types";

export type SourceMcq = Omit<StoredQuestion, "correct_answer"> & { correct_answer?: string };

/**
 * Conservative fast path for numbered exam papers. Every numbered item must
 * have a complete ordered option list; otherwise leave the document to AI.
 */
export function parseSourceMcqs(text: string): SourceMcq[] | null {
  const normalized = text.replace(/\r\n?/g, "\n");
  const keyHeading = /^\s*(?:answer\s+key|correct\s+answers)\s*:?[ \t]*$/im.exec(normalized);
  const body = keyHeading ? normalized.slice(0, keyHeading.index) : normalized;
  const keyText = keyHeading ? normalized.slice(keyHeading.index + keyHeading[0].length) : "";
  const answers = new Map<number, string>();
  for (const match of keyText.matchAll(/\b(\d{1,3})\s*[.):=-]\s*\(?([A-F])\)?\b/gi)) {
    const id = Number(match[1]);
    const answer = match[2].toUpperCase();
    if (answers.has(id) && answers.get(id) !== answer) return null;
    answers.set(id, answer);
  }
  const starts = [...body.matchAll(/^[ \t]*(?:question\s+)?(\d{1,3})[.)][ \t]+\S/gim)];
  if (starts.length < 2) return null;
  const questions: SourceMcq[] = [];
  for (let i = 0; i < starts.length; i++) {
    const number = Number(starts[i][1]);
    // Gaps, repeated numbering and numbered prose need the general pipeline.
    if (number !== i + 1) return null;
    let block = body.slice(starts[i].index!, starts[i + 1]?.index ?? body.length).trim();
    block = block.replace(/^(?:question\s+)?\d{1,3}[.)][ \t]+/i, "");
    let answer = answers.get(number);
    const marked = /(?:^|\n)[ \t]*(?:correct\s+)?answer\s*:[ \t]*\(?([A-F])\)?[.)]?[ \t]*(?:\n|$)/i.exec(block);
    if (marked) {
      if (answer && answer !== marked[1].toUpperCase()) return null;
      answer = marked[1].toUpperCase();
      block = block.slice(0, marked.index).trim() + "\n" + block.slice(marked.index + marked[0].length).trim();
    }
    const explanationMatch = /(?:^|\n)[ \t]*explanation\s*:[ \t]*([\s\S]*)$/i.exec(block);
    const explanation = explanationMatch?.[1].trim() || "";
    if (explanationMatch) block = block.slice(0, explanationMatch.index).trim();
    if (/^[ \t]*(?:ans(?:wer)?|correct\s+answer|solution)\s*[:=-]/im.test(block)) return null;
    const options = [...block.matchAll(/^[ \t]*\(?([A-F])[.)][ \t]+\S/gim)];
    // Accept the common four-option layout only. Ambiguous/incomplete lists
    // stay on the general path rather than silently losing an option.
    if (options.length !== 4) return null;
    if (options.some((option, index) => option[1].toUpperCase().charCodeAt(0) !== 65 + index)) return null;
    const stem = block.slice(0, options[0].index).trim();
    if (stem.length < 5 || stem.length > 10000) return null;
    const optionTexts = options.map((option, index) =>
      block.slice(option.index!, options[index + 1]?.index ?? block.length)
        .replace(/^[ \t]*\(?[A-F][.)][ \t]+/i, "").trim());
    if (optionTexts.some((option) => !option || option.length > 5000) ||
        new Set(optionTexts).size !== optionTexts.length) return null;
    if (answer && answer.charCodeAt(0) - 65 >= optionTexts.length) return null;
    questions.push({
      question_number: number, question: stem, options: optionTexts,
      correct_answer: answer ? optionTexts[answer.charCodeAt(0) - 65] : undefined,
      explanation,
    });
  }
  if ([...answers.keys()].some((number) => number < 1 || number > questions.length)) return null;
  return questions;
}
