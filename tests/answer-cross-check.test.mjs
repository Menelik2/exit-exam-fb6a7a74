import assert from "node:assert/strict";
import { test } from "node:test";
process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
const { default: handler } = await import("../api/generate-exam.js");
const q = { question_number: 1, question: "What is 2 + 2?", options: ["3", "4", "5", "6"], correct_answer: "4" };
const model = (questions) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions }) }] } }] });
const goodReview = { question_number: 1, verdict: "supported", correct_option: 1,
  explanation: "Adding two and two gives four.", option_explanations: ["One less.", "The sum.", "One more.", "Two more."] };
const response = () => ({ statusCode: 0, setHeader() {}, end(body) { this.body = JSON.parse(body); } });

test("uses a blind second pass and returns detailed reviewed explanations", async (t) => {
  const signals = [];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    signals.push(options.signal);
    const body = JSON.parse(options.body);
    if (calls === 1) return model([q]);
    const input = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(input.questions, [{ question_number: 1, question: q.question, options: q.options }]);
    assert.equal(input.questions[0].correct_answer, undefined);
    assert.equal(input.questions[0].explanation, undefined);
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: "MEDIUM" });
    return model([goodReview]);
  });
  const res = response();
  await handler({ method: "POST", body: { apiKey: "test-key", topic: "Arithmetic", numQuestions: 1 } }, res);
  assert.equal(calls, 2);
  assert.equal(signals[0], signals[1], "drafting and review share one deadline");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.quality_check, "ai_cross_checked");
  assert.match(res.body.questions[0].explanation, /B\. The sum/);
});

for (const [label, verdict, index] of [["disagreement", "supported", 2], ["ambiguity", "ambiguous", 1], ["missing context", "insufficient_context", null]]) {
  test(`does not return questions when review finds ${label}`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? model([q]) : model([{ ...goodReview, verdict, correct_option: index }]));
    const res = response();
    await handler({ method: "POST", body: { apiKey: "test-key", topic: "Arithmetic", numQuestions: 1 } }, res);
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.retryable, false);
    assert.equal(res.body.code, "ANSWER_REVIEW_REQUIRED");
    assert.equal(res.body.questions, undefined);
  });
}
test("checks marked source answers independently and blocks a wrong source key", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.match(body.system_instruction.parts[0].text, /Independently solve/);
    const input = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(input.questions[0].correct_answer, undefined);
    return model([goodReview]);
  });
  const res = response();
  await handler({ method: "POST", body: { apiKey: "test-key", sourceQuestions: [{ ...q, correct_answer: "5" }] } }, res);
  assert.equal(calls, 1, "source answers skip drafting, never checking");
  assert.equal(res.statusCode, 422);
});
test("blocks malformed draft answers before spending a review request", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return model([{ ...q, correct_answer: "unknown" }]); });
  const res = response();
  await handler({ method: "POST", body: { apiKey: "test-key", topic: "Arithmetic", numQuestions: 1 } }, res);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.questions, undefined);
});

test("does not publish the draft when the checking pass hits a quota limit", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? model([q]) :
    Response.json({ error: { message: "Quota exceeded: requests per day" } }, { status: 429 }));
  const res = response();
  await handler({ method: "POST", body: { apiKey: "test-key", topic: "Arithmetic", numQuestions: 1 } }, res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.questions, undefined);
  assert.equal(res.body.code, "QUOTA_EXHAUSTED");
});
