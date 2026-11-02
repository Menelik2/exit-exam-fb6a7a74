/**
 * POST /api/generate-exam
 * Body:
 *   topic?: string,
 *   difficulty?: string,
 *   numQuestions?: number,
 *   documentText?: string,
 *   documentName?: string,
 *   apiKey?: string,
 *   provider?: string,
 *   avoid?: string[],
 *   nonce?: string,
 *   fullDocument?: boolean
 */

// Prefer the configured model, then try known fallback models when Google is
// temporarily overloaded or a model is unavailable.
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  "gemini-3.5-flash-lite",
  ...(process.env.GEMINI_FALLBACK_MODELS || "gemini-3.1-flash-lite").split(",").map((v) => v.trim()),
].filter((v, i, a) => v && a.indexOf(v) === i);
const HARD_MAX = 50;
// One deadline covers all model attempts, including response-body reads.
const GENERATION_TIMEOUT_MS = 50_000;

function getEnvApiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ""
  ).trim();
}

function clampNum(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.round(x)));
}

function cleanJsonText(raw) {
  let s = String(raw || "").trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  return s.trim();
}

function normalizeQuestions(raw, need) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const question = String(item.question || item.stem || "").trim();
    if (!question) continue;
    let options = Array.isArray(item.options)
      ? item.options.map((o) => String(o ?? "").trim()).filter(Boolean)
      : [];
    if (options.length < 2) continue;
    options = options.slice(0, 6);
    let correct = String(item.correct_answer || item.answer || "").trim();
    if (!options.includes(correct)) {
      const found = options.find((o) => o.toLowerCase() === correct.toLowerCase());
      if (found) correct = found;
      else if (/^[A-Da-d]$/.test(correct)) {
        const idx = correct.toUpperCase().charCodeAt(0) - 65;
        correct = options[idx] || options[0];
      } else {
        correct = options[0];
      }
    }
    out.push({
      question_number: out.length + 1,
      question,
      options,
      correct_answer: correct,
      explanation: item.explanation == null ? "" : String(item.explanation).slice(0, 2000),
    });
    if (out.length >= need) break;
  }
  return out;
}

function parseModelJson(text) {
  const cleaned = cleanJsonText(text);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/) || cleaned.match(/\[[\s\S]*\]/);
    if (!m) throw new Error("Model returned non-JSON");
    parsed = JSON.parse(m[0]);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
  return [];
}

function serviceFailureDetails(data, status, retryAfterHeader) {
  const details = Array.isArray(data?.error?.details) ? data.error.details : [];
  const retryInfo = details.find((item) => String(item?.["@type"] || "").endsWith("RetryInfo"));
  const retrySeconds = Number.parseFloat(retryInfo?.retryDelay || retryAfterHeader || "");
  const quotaFailures = details.filter((item) => String(item?.["@type"] || "").endsWith("QuotaFailure"));
  const violations = quotaFailures.flatMap((item) => Array.isArray(item.violations) ? item.violations : []);
  // Google's generic 429 message mentions billing even for per-minute limits.
  // Use violated quota IDs/values; never infer exhaustion from that boilerplate.
  const quotaText = violations.length
    ? violations.map((v) => `${v.quotaId || ""} ${v.quotaMetric || ""}`).join(" ")
    : String(data?.error?.message || "");
  const zeroQuota = violations.some((v) => v.quotaValue != null && Number(v.quotaValue) === 0);
  const quotaExhausted = status === 429 &&
    (zeroQuota || /per.?day|daily|insufficient.?quota|limit:\s*0\b/i.test(quotaText));
  const modelScopedQuota = status === 429 && violations.length > 0 &&
    violations.every((v) => v.quotaDimensions?.model !== "*" && (v.quotaId
      ? /per.?model/i.test(String(v.quotaId))
      : typeof v.quotaDimensions?.model === "string" && !!v.quotaDimensions.model));
  return {
    retryable: !quotaExhausted && (status === 408 || status === 429 || status >= 500),
    retryAfterSeconds: Number.isFinite(retrySeconds)
      ? Math.max(1, Math.ceil(retrySeconds))
      : status === 429 ? 30 : 5,
    code: quotaExhausted ? "QUOTA_EXHAUSTED" : status === 429 ? "RATE_LIMITED" : "SERVICE_BUSY",
    modelScopedQuota,
  };
}

async function callGeminiOnce(apiKey, model, systemPrompt, userPrompt, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        // Newer Gemini models reject legacy sampling/thinking-budget settings.
        // Flash-Lite 3.5 defaults to minimal thinking for low-latency extraction.
        ...(/^gemini-2\./.test(model) ? { temperature: 0.2 } : {}),
        // MCQs with options and explanations can be long; explicitly budget output tokens.
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        // Flash 2.5 otherwise spends extra tokens/time thinking on every small batch.
        ...(/^gemini-2\.5-flash(?:-|$)/.test(model)
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : {}),
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      `Gemini error (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    Object.assign(err, serviceFailureDetails(data, res.status, res.headers.get("Retry-After")));
    throw err;
  }
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

function isRetryableModelError(error) {
  const status = Number(error?.status || 0);
  const msg = String(error?.message || error);
  return status === 408 || status === 429 || status >= 500 ||
    /high demand|overload|overloaded|temporarily unavailable|resource_exhausted|unavailable|rate.?limit|too many requests|no longer available|not found|is not found|NOT_FOUND/i.test(msg);
}

async function callGemini(apiKey, systemPrompt, userPrompt) {
  const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
  let lastErr;
  let quotaErr;
  for (const model of GEMINI_MODELS) {
    // Give a temporarily busy model one brief retry, then move to a fallback.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGeminiOnce(apiKey, model, systemPrompt, userPrompt, signal);
      } catch (e) {
        lastErr = e;
        if (Number(e?.status) === 429) quotaErr = e;
        if (signal.aborted) break;
        // Quota limits need time to recover; repeated model calls add latency.
        if (Number(e?.status) === 429) break;
        if (!isRetryableModelError(e)) throw e;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 700));
        else break;
      }
    }
    // Model-specific quota pools can differ. Try each permitted fallback once,
    // but never rotate models for an unscoped/project-wide quota rejection.
    if (signal.aborted || (Number(lastErr?.status) === 429 && !lastErr.modelScopedQuota)) break;
  }
  // A retired/unavailable fallback must not hide the original quota failure.
  if (quotaErr && Number(lastErr?.status) === 404) lastErr = quotaErr;
  const quota = Number(lastErr?.status) === 429;
  const exhausted = lastErr?.code === "QUOTA_EXHAUSTED";
  const finalError = new Error(exhausted
    ? "Gemini quota is exhausted for the available models. Check your API plan and quota in Google AI Studio. In Admin Settings, use a key from a project with available quota, or wait for the quota reset."
    : quota
      ? "Gemini is rate limiting requests. Generation will pause before retrying."
      : signal.aborted
        ? "Gemini took too long to respond. Please resume generation to retry this section."
        : "Gemini is temporarily busy. Generation will pause before retrying.");
  finalError.status = Number(lastErr?.status) === 429 ? 429 : 503;
  finalError.retryable = !exhausted;
  finalError.retryAfterSeconds = lastErr?.retryAfterSeconds || (quota ? 30 : 5);
  finalError.code = signal.aborted ? "SERVICE_TIMEOUT" : lastErr?.code || "SERVICE_BUSY";
  throw finalError;
}

const SYSTEM_PROMPT = `You are an expert exam writer and exam-document parser. Produce high-quality multiple-choice questions.
Rules:
- Exactly 4 options per question unless the source truly has fewer (minimum 2).
- correct_answer MUST be the full option text (not just "A" or "1").
- explanations should be 1-3 sentences, educational.
- Avoid repeating or paraphrasing questions listed in the avoid list.
- Output valid JSON matching the schema.

When the document already contains MCQs (e.g. "Question 12", options a/b/c/d from exit exams or Moodle):
- EXTRACT those questions faithfully — keep the stem and all four options as written.
- Do NOT invent new topics when the document is already an exam paper.
- If a correct answer is marked in the text, use it. If not marked, pick the most accurate option as correct_answer and briefly justify in explanation.
- Prefer extracting every distinct question in the provided section over inventing fillers.`;

const ANSWER_PROMPT = `Answer the supplied multiple-choice exam questions accurately.
Return JSON only: { "questions": [{ "question_number": integer, "correct_option": integer, "explanation": string }] }.
Use the original question_number. correct_option is a zero-based index into that question's options.
Give one short sentence of explanation. Do not repeat stems or options. Answer every supplied question.`;

function validateSourceQuestions(value) {
  const invalid = () => {
    const error = new Error("Supply 1–24 source questions with unique integer IDs, complete stems and 2–6 options.");
    error.status = 400;
    throw error;
  };
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) invalid();
  const ids = new Set();
  return value.map((q) => {
    if (!q || !Number.isInteger(q.question_number) || q.question_number < 1 ||
        ids.has(q.question_number) || typeof q.question !== "string" || !q.question.trim() ||
        q.question.length > 10000 || !Array.isArray(q.options) || q.options.length < 2 ||
        q.options.length > 6 || q.options.some((o) => typeof o !== "string" || !o.trim() || o.length > 5000)) invalid();
    ids.add(q.question_number);
    return { question_number: q.question_number, question: q.question, options: q.options };
  });
}

function mergeSourceAnswers(raw, source) {
  const answers = new Map();
  for (const answer of raw) {
    if (answers.has(answer?.question_number)) throw new Error("Model returned duplicate answer IDs");
    answers.set(answer?.question_number, answer);
  }
  if (answers.size !== source.length) throw new Error("Model did not answer every source question");
  return source.map((q) => {
    const answer = answers.get(q.question_number);
    const index = answer?.correct_option;
    if (!Number.isInteger(index) || index < 0 || index >= q.options.length) {
      throw new Error("Model returned an invalid source answer");
    }
    return {
      ...q,
      correct_answer: q.options[index],
      explanation: typeof answer.explanation === "string" ? answer.explanation.slice(0, 2000) : "",
    };
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        body = {};
      }
    }
    if (!body || typeof body !== "object") body = {};

    const apiKey = String(body.apiKey || getEnvApiKey() || "").trim();
    if (!apiKey) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          ok: false,
          error: "No Gemini API key configured. Add GEMINI_API_KEY or paste a key in Setup.",
        }),
      );
    }

    const topic = String(body.topic || "").trim();
    const difficulty = String(body.difficulty || "Intermediate").trim();
    const documentText = String(body.documentText || "").trim().slice(0, 180000);
    const documentName = String(body.documentName || "").trim();
    const avoid = Array.isArray(body.avoid)
      ? body.avoid.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 80)
      : [];
    const need = clampNum(body.numQuestions, 1, HARD_MAX, 10);
    const sourceQuestions = body.sourceQuestions === undefined
      ? null : validateSourceQuestions(body.sourceQuestions);

    if (!documentText && !topic && !sourceQuestions) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: false, error: "Enter a topic or upload a document first." }));
    }

    let userPrompt;
    if (sourceQuestions) {
      userPrompt = JSON.stringify(sourceQuestions);
    } else if (documentText) {
      userPrompt = [
        `Task: From this document section, produce EXACTLY ${need} MCQs. If the section already has exam questions with options, EXTRACT them (stems + a/b/c/d). Only invent new items when the section is prose without MCQs. Use the document only.`,
        documentName ? `Document: ${documentName}` : "",
        `Difficulty target: ${difficulty}`,
        avoid.length ? `Avoid similar questions:\n- ${avoid.join("\n- ")}` : "",
        "Keep each explanation to one short sentence (or empty if not needed) to fit the response limit.",
        "Return only valid JSON, with no markdown fences. Keep every question and all options complete.",
        "Return JSON: { \"questions\": [ { \"question\": string, \"options\": string[4], \"correct_answer\": string, \"explanation\": string } ] }",
        "DOCUMENT SECTION:",
        documentText,
      ]
        .filter(Boolean)
        .join("\n\n");
    } else {
      userPrompt = [
        `Task: Generate EXACTLY ${need} MCQs.`,
        `Topic: ${topic}`,
        `Difficulty: ${difficulty}`,
        avoid.length ? `Avoid similar questions:\n- ${avoid.join("\n- ")}` : "",
        "Return JSON: { \"questions\": [ { \"question\": string, \"options\": string[4], \"correct_answer\": string, \"explanation\": string } ] }",
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    const raw = await callGemini(apiKey, sourceQuestions ? ANSWER_PROMPT : SYSTEM_PROMPT, userPrompt);
    const questions = sourceQuestions
      ? mergeSourceAnswers(parseModelJson(raw), sourceQuestions)
      : normalizeQuestions(parseModelJson(raw), need);
    if (!questions.length) {
      throw new Error("Model returned no valid questions");
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, questions }));
  } catch (e) {
    const status = Number(e?.status);
    res.statusCode = [400, 401, 403, 429, 503].includes(status) ? status : 500;
    res.setHeader("Content-Type", "application/json");
    if ([429, 503].includes(res.statusCode)) {
      res.setHeader("Retry-After", String(e?.retryAfterSeconds || 5));
    }
    return res.end(
      JSON.stringify({
        ok: false,
        error: (e && e.message) || "Generation failed",
        retryable: e?.retryable ?? res.statusCode >= 500,
        retryAfterSeconds: e?.retryAfterSeconds,
        code: e?.code,
      }),
    );
  }
}

