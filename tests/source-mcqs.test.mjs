import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSourceMcqs } from "../src/lib/source-mcqs.ts";

const paper = (firstAnswer = "", secondAnswer = "") => `1. Which option is first?
A. First option
B. Second option
C. Third option
D. Fourth option
${firstAnswer}
2. Which option is second?
a) Another first
b) Another second
c) Another third
d) Another fourth
${secondAnswer}`;

test("extracts stems and options without inventing answers", () => {
  const questions = parseSourceMcqs(paper());
  assert.equal(questions.length, 2);
  assert.equal(questions[0].question, "Which option is first?");
  assert.deepEqual(questions[0].options, ["First option", "Second option", "Third option", "Fourth option"]);
  assert.equal(questions[0].correct_answer, undefined);
});

test("reads explicit inline answers and explanations", () => {
  const questions = parseSourceMcqs(paper("Answer: B\nExplanation: Reason from source.", "Correct answer: (d)"));
  assert.equal(questions[0].correct_answer, "Second option");
  assert.equal(questions[0].explanation, "Reason from source.");
  assert.equal(questions[1].correct_answer, "Another fourth");
  assert.equal(questions[1].options[3], "Another fourth");
});

test("reads a separate answer key without appending it to the final option", () => {
  const questions = parseSourceMcqs(paper() + "\nAnswer Key:\n1. C\n2. A\n");
  assert.equal(questions[0].correct_answer, "Third option");
  assert.equal(questions[1].correct_answer, "Another first");
  assert.equal(questions[1].options[3], "Another fourth");
});

test("preserves multiline stems and options", () => {
  const questions = parseSourceMcqs(paper().replace("Which option is first?", "Given the following case,\nwhich option is first?")
    .replace("First option", "First option\ncontinued on the next line"));
  assert.equal(questions[0].question, "Given the following case,\nwhich option is first?");
  assert.equal(questions[0].options[0], "First option\ncontinued on the next line");
});

for (const [label, input] of [
  ["missing numbered questions", paper().replace("2. Which", "3. Which")],
  ["missing options", paper().replace("C. Third option\n", "")],
  ["truncated last option", paper().replace("d) Another fourth", "")],
  ["conflicting answers", paper("Answer: A") + "\nAnswer Key\n1. B\n2. D"],
  ["invalid answer letters", paper("Answer: E")],
  ["unsupported answer notation", paper("Answer: The second option")],
  ["numbered prose", "1. A long paragraph about medicine.\n2. Another long paragraph without answer options."],
]) {
  test(`falls back for ${label}`, () => assert.equal(parseSourceMcqs(input), null));
}
