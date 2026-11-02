import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCandidates, applyIndependentReview } from "../server/answer-quality.js";

const q = { question_number: 1, question: "What is 2 + 2?", options: ["3", "4", "5", "6"], correct_answer: "4" };
const goodReview = {
  question_number: 1, verdict: "supported", correct_option: 1,
  explanation: "Adding two to two gives four.",
  option_explanations: ["Three is one too small.", "Four is the sum.", "Five is one too large.", "Six is two too large."],
};
test("accepts a supported independent answer with reasoning for every option", () => {
  const [checked] = applyIndependentReview([q], [goodReview]);
  assert.equal(checked.correct_answer, "4");
  assert.equal(checked.answer_check, "ai_cross_checked");
  assert.match(checked.explanation, /A\. Three/);
  assert.match(checked.explanation, /D\. Six/);
});
for (const [name, raw] of [
  ["missing answer", { ...q, correct_answer: "" }],
  ["unknown answer", { ...q, correct_answer: "7" }],
  ["out-of-range letter", { ...q, correct_answer: "F" }],
  ["duplicate options", { ...q, options: ["4", "4", "5", "6"] }],
]) {
  test(`never guesses the first option for ${name}`, () => {
    assert.throws(() => normalizeCandidates([raw], 1), (e) => e.status === 422 && e.retryable === false);
  });
}
test("resolves a valid letter without changing the option wording", () => {
  assert.equal(normalizeCandidates([{ ...q, correct_answer: "B" }], 1)[0].correct_answer, "4");
});
test("does not silently truncate detailed explanations during catalog storage", () => {
  assert.throws(() => applyIndependentReview([q], [{
    ...goodReview, explanation: "x".repeat(1800),
    option_explanations: q.options.map(() => "y".repeat(100)),
  }]), (e) => e.code === "ANSWER_REVIEW_REQUIRED");
});
for (const [name, reviews] of [
  ["disagreement", [{ ...goodReview, correct_option: 2 }]],
  ["ambiguity", [{ ...goodReview, verdict: "ambiguous" }]],
  ["missing context", [{ ...goodReview, verdict: "insufficient_context", correct_option: null }]],
  ["missing option reasons", [{ ...goodReview, option_explanations: ["One reason"] }]],
  ["empty explanation", [{ ...goodReview, explanation: "" }]],
  ["unknown IDs", [{ ...goodReview, question_number: 7 }]],
  ["missing review", []],
]) {
  test(`blocks publication for ${name}`, () => {
    assert.throws(() => applyIndependentReview([q], reviews),
      (e) => e.code === "ANSWER_REVIEW_REQUIRED" && e.status === 422 && e.retryable === false);
  });
}
