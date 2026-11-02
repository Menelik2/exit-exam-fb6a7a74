import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// These tests exercise the orchestration with text documents. PDF/OCR is
// unrelated to request scheduling and needs browser-only dependencies.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/extract-document") {
      return {
        url: "data:text/javascript,export async function extractDocumentText() { throw new Error('Unexpected OCR'); }",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
const { generateAndStoreExamQuestions } = await import("../src/lib/admin-exam-generate.ts");
const exam = { id: "exam", title: "Test paper", year: 2026, pdfUrl: "https://example.com/paper.txt", telegramFileId: null };
const text = "Study material. ".repeat(934).slice(0, 14000);
const question = (stem) => ({
  question: stem,
  options: ["First", "Second", "Third", "Fourth"],
  correct_answer: "First",
  explanation: "Explanation",
});
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json" },
});
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("generates three sections concurrently and preserves document order", async (t) => {
  const pending = [];
  let active = 0;
  let peak = 0;
  const progress = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === "/api/exam-document") return json({ ok: true, text });
    const body = JSON.parse(options.body);
    active++;
    peak = Math.max(peak, active);
    return new Promise((resolve) => pending.push(() => {
      active--;
      resolve(json({ ok: true, questions: Array.from({ length: body.numQuestions }, (_, i) =>
        question(body.documentName + " question " + i)) }));
    }));
  });
  const result = generateAndStoreExamQuestions(exam, 24, (p) => progress.push(p));
  await nextTurn();
  assert.equal(pending.length, 3, "all three independent requests should start before any finishes");
  pending.reverse().forEach((finish) => finish());
  const questions = await result;
  assert.equal(peak, 3);
  assert.equal(questions.length, 24);
  assert.match(questions[0].question, /part 1\/3/);
  assert.match(questions[8].question, /part 2\/3/);
  assert.match(questions[16].question, /part 3\/3/);
  assert.deepEqual(questions.map((q) => q.question_number), Array.from({ length: 24 }, (_, i) => i + 1));
  assert.equal(progress.at(-1).questionsSoFar, 24);
});

test("allocates the entire detected source count without rounding it away", async (t) => {
  const numberedText = Array.from({ length: 10 }, (_, i) => `${i + 1}. Source question\n`).join("") + text;
  let requested = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === "/api/exam-document") return json({ ok: true, text: numberedText });
    const body = JSON.parse(options.body);
    requested += body.numQuestions;
    return json({ ok: true, questions: Array.from({ length: body.numQuestions }, (_, i) => question(body.documentName + i)) });
  });
  const questions = await generateAndStoreExamQuestions(exam);
  assert.equal(requested, 10);
  assert.equal(questions.length, 10);
});

test("deduplicates overlapping sections after ordering the results", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === "/api/exam-document") return json({ ok: true, text });
    const body = JSON.parse(options.body);
    return json({ ok: true, questions: [
      question("Shared question"),
      ...Array.from({ length: body.numQuestions - 1 }, (_, i) => question(body.documentName + i)),
    ] });
  });
  const questions = await generateAndStoreExamQuestions(exam, 24);
  assert.equal(questions.length, 22);
  assert.equal(questions.filter((q) => q.question === "Shared question").length, 1);
  assert.match(questions[1].question, /part 1\/3/);
  assert.equal(questions.at(-1).question_number, 22);
});

for (const status of [400, 401, 403, 429, 503]) {
  test(`fails without browser retries for HTTP ${status} and drains active workers`, async (t) => {
    let calls = 0;
    const pending = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      if (url === "/api/exam-document") return json({ ok: true, text: text + text });
      calls++;
      return new Promise((resolve) => pending.push(resolve));
    });
    let settled = false;
    const result = generateAndStoreExamQuestions(exam, 24);
    const rejected = assert.rejects(result, /Nothing was saved.*Service unavailable/);
    result.then(() => { settled = true; }, () => { settled = true; });
    await nextTurn();
    assert.equal(calls, 3);
    pending[0](json({ ok: false, error: "Service unavailable" }, status));
    await nextTurn();
    assert.equal(settled, false, "must wait for active workers before re-enabling the button");
    pending.slice(1).forEach((resolve) => resolve(json({ ok: true, questions: [question("Other")] })));
    await rejected;
    assert.equal(calls, 3, "must not retry or schedule more sections");
  });
}

test("keeps batch size small and sends previous section questions in the avoid list", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === "/api/exam-document") return json({ ok: true, text: text.slice(0, 4000) });
    const body = JSON.parse(options.body);
    requests.push(body);
    return json({ ok: true, questions: Array.from({ length: body.numQuestions }, (_, i) =>
      question(`Batch ${requests.length} question ${i}`)) });
  });
  const questions = await generateAndStoreExamQuestions(exam, 17);
  assert.deepEqual(requests.map((r) => r.numQuestions), [8, 8, 1]);
  assert.equal(requests[2].avoid.length, 16);
  assert.equal(questions.length, 17);
});
