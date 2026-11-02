export function reviewRequired(message) {
  const error = new Error(message);
  error.status = 422;
  error.retryable = false;
  error.code = "ANSWER_REVIEW_REQUIRED";
  return error;
}

export function normalizeCandidates(raw, need) {
  if (!Array.isArray(raw) || raw.length === 0) throw reviewRequired("No valid questions were generated.");
  const seen = new Set();
  return raw.slice(0, need).map((item, i) => {
    const question = typeof item?.question === "string" ? item.question.trim() : "";
    const options = Array.isArray(item?.options) ? item.options.map((o) => typeof o === "string" ? o.trim() : "") : [];
    const key = question.toLowerCase().replace(/\s+/g, " ");
    if (!question || question.length > 10000 || seen.has(key) || options.length < 2 || options.length > 6 ||
        options.some((o) => !o || o.length > 5000) || new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      throw reviewRequired(`Question ${i + 1} has incomplete or ambiguous wording/options. Please regenerate or review it.`);
    }
    seen.add(key);
    const answer = typeof item.correct_answer === "string" ? item.correct_answer.trim() : "";
    let index = options.findIndex((o) => o.toLowerCase() === answer.toLowerCase());
    if (index < 0 && /^[A-F]$/i.test(answer)) index = answer.toUpperCase().charCodeAt(0) - 65;
    if (index < 0 || index >= options.length) {
      throw reviewRequired(`Question ${i + 1} has no valid answer. It was not saved.`);
    }
    return {
      question_number: i + 1, question, options, correct_answer: options[index],
      explanation: typeof item.explanation === "string" ? item.explanation : "",
    };
  });
}

export function applyIndependentReview(questions, reviews) {
  if (!Array.isArray(reviews) || reviews.length !== questions.length) {
    throw reviewRequired("The answer cross-check was incomplete. No unchecked questions were saved.");
  }
  const byId = new Map();
  for (const review of reviews) {
    if (!review || byId.has(review.question_number)) throw reviewRequired("The answer cross-check returned invalid question IDs.");
    byId.set(review.question_number, review);
  }
  return questions.map((q) => {
    const r = byId.get(q.question_number);
    if (!r || r.verdict !== "supported" || !Number.isInteger(r.correct_option) ||
        r.correct_option < 0 || r.correct_option >= q.options.length ||
        q.options[r.correct_option] !== q.correct_answer) {
      throw reviewRequired(`Question ${q.question_number} needs review: the independent answer check disagreed or could not establish one supported answer. No unchecked questions were saved.`);
    }
    if (typeof r.explanation !== "string" || !r.explanation.trim() || r.explanation.length > 2000 ||
        !Array.isArray(r.option_explanations) || r.option_explanations.length !== q.options.length ||
        r.option_explanations.some((reason) => typeof reason !== "string" || !reason.trim() || reason.length > 600)) {
      throw reviewRequired(`Question ${q.question_number} needs a complete explanation for every option.`);
    }
    const explanation = [r.explanation.trim(), ...r.option_explanations.map((reason, i) =>
      `${String.fromCharCode(65 + i)}. ${reason.trim()}`)].join("\n\n");
    if (explanation.length > 2000) {
      throw reviewRequired(`Question ${q.question_number} needs a concise, complete explanation before it can be saved.`);
    }
    return {
      ...q,
      explanation,
      answer_check: "ai_cross_checked",
    };
  });
}

export const REVIEW_PROMPT = `Independently solve each multiple-choice question before choosing an answer.
You are a separate answer-checking pass. No proposed answers are supplied.
Check every option, calculations, units, assumptions, and negative wording such as NOT/EXCEPT.
Return verdict "supported" only when exactly one option is defensible from reliable knowledge and any provided context.
Use "ambiguous" for multiple defensible options or flawed wording; use "insufficient_context" for missing figures/passages, unavailable current guidance, or facts you cannot establish. Do not guess.
Source answer keys can contain mistakes; they are not proof. Do not invent citations or claim external fact-checking.
Explain the key principle in 2–4 educational sentences, then explain each option in its original order.
Keep the complete explanation and option reasons together under 1800 characters without omitting an option.
Output JSON only: { "questions": [{ "question_number": integer, "verdict": "supported"|"ambiguous"|"insufficient_context", "correct_option": zero-based integer or null, "explanation": string, "option_explanations": string[] }] }.`;
