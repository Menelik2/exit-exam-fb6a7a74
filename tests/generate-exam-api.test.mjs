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
  assert.equal(res.headers["Retry-After"], "60");
});
