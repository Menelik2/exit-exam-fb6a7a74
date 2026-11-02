import assert from "node:assert/strict";
import { test } from "node:test";

process.env.GEMINI_MODEL = "gemini-2.5-flash";
const { default: handler } = await import("../api/generate-exam.js");
const request = { method: "POST", body: { apiKey: "test-key", documentText: "Source document", numQuestions: 1 } };
const response = () => ({
  statusCode: 0,
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  end(body) { this.body = JSON.parse(body); },
});

test("uses the Flash latency setting and applies a deadline to upstream fetch", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const config = JSON.parse(options.body).generationConfig;
    assert.deepEqual(config.thinkingConfig, { thinkingBudget: 0 });
    assert.equal(config.maxOutputTokens, 8192);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [{
      question: "Question", options: ["A", "B", "C", "D"], correct_answer: "B",
    }] }) }] } }] });
  });
  const res = response();
  await handler(request, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.questions[0].correct_answer, "B");
});

test("returns quota errors immediately instead of trying every model again", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: { message: "Quota exceeded" } }, { status: 429 });
  });
  const res = response();
  await handler(request, res);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 429);
});

test("preserves configuration errors so the browser will not retry them", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: { message: "Invalid API key" } }, { status: 400 });
  });
  const res = response();
  await handler(request, res);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "Invalid API key");
});

test("stops all fallback attempts when the shared deadline expires", async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", (ms) => {
    assert.equal(ms, 50_000);
    return controller.signal;
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    controller.abort();
    options.signal.throwIfAborted();
  });
  const res = response();
  await handler(request, res);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["Retry-After"], "5");
  assert.equal(res.body.code, "SERVICE_TIMEOUT");
  assert.equal(res.body.retryable, true);
});

test("forwards Gemini cooldown metadata for temporary rate limits", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    error: {
      message: "Requests per minute exceeded",
      details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "12.5s" }],
    },
  }, { status: 429 }));
  const res = response();
  await handler(request, res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.retryable, true);
  assert.equal(res.body.retryAfterSeconds, 13);
  assert.equal(res.headers["Retry-After"], "13");
  assert.equal(res.body.code, "RATE_LIMITED");
});

for (const message of ["Quota exceeded: requests per day", "Quota exceeded, limit: 0"]) {
  test(`does not automatically retry exhausted quota: ${message}`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message } }, { status: 429 }));
    const res = response();
    await handler(request, res);
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.retryable, false);
    assert.equal(res.body.code, "QUOTA_EXHAUSTED");
    assert.match(res.body.error, /Check your API plan/);
  });
}

const sourceQuestions = [
  { question_number: 25, question: "Original question 25", options: ["Original A", "Original B", "Original C", "Original D"] },
  { question_number: 26, question: "Original question 26", options: ["Other A", "Other B", "Other C", "Other D"] },
];
const modelResponse = (questions) => Response.json({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ questions }) }] } }],
});

test("maps compact answers to original IDs, stems, and options without rewriting", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.system_instruction.parts[0].text, /zero-based index/);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), sourceQuestions);
    return modelResponse([
      { question_number: 26, correct_option: 3, explanation: "Reason 26", question: "Rewritten stem" },
      { question_number: 25, correct_option: 1, explanation: "Reason 25" },
    ]);
  });
  const res = response();
  await handler({ method: "POST", body: { apiKey: "test-key", sourceQuestions } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.questions[0].question_number, 25);
  assert.equal(res.body.questions[0].question, "Original question 25");
  assert.deepEqual(res.body.questions[0].options, sourceQuestions[0].options);
  assert.equal(res.body.questions[0].correct_answer, "Original B");
  assert.equal(res.body.questions[1].correct_answer, "Other D");
});

for (const [label, answers] of [
  ["missing answer", [{ question_number: 25, correct_option: 0 }]],
  ["invalid option", [{ question_number: 25, correct_option: 4 }, { question_number: 26, correct_option: 0 }]],
  ["duplicate IDs", [{ question_number: 25, correct_option: 0 }, { question_number: 25, correct_option: 1 }]],
]) {
  test(`rejects ${label} instead of defaulting to the first option`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => modelResponse(answers));
    const res = response();
    await handler({ method: "POST", body: { apiKey: "test-key", sourceQuestions } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.questions, undefined);
  });
}

test("rejects invalid source batches before contacting the AI provider", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Unexpected request"); });
  for (const sources of [[], [sourceQuestions[0], sourceQuestions[0]], Array(25).fill(sourceQuestions[0])]) {
    const res = response();
    await handler({ method: "POST", body: { apiKey: "test-key", sourceQuestions: sources } }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
});
