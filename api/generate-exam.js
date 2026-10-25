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
  process.env.GEMINI_MODEL || "gemini-2.5-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
].filter((v, i, a) => v && a.indexOf(v) === i);
const HARD_MAX = 50;

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

async function callGeminiOnce(apiKey, model, systemPrompt, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        // MCQs with options and explanations can be long; explicitly budget output tokens.
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
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
  let lastErr;
  for (const model of GEMINI_MODELS) {
    // Give a temporarily busy model one brief retry, then move to a fallback.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGeminiOnce(apiKey, model, systemPrompt, userPrompt);
      } catch (e) {
        lastErr = e;
        if (!isRetryableModelError(e)) throw e;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 700));
        else break;
      }
    }
  }
  const finalError = new Error(
    "The AI service is temporarily busy or has reached its usage limit. Please try again in 1–2 minutes. If this keeps happening, check your Gemini API quota or use a different API key."
  );
  finalError.status = Number(lastErr?.status) === 429 ? 429 : 503;
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

    if (!documentText && !topic) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: false, error: "Enter a topic or upload a document first." }));
    }

    let userPrompt;
    if (documentText) {
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

    const raw = await callGemini(apiKey, SYSTEM_PROMPT, userPrompt);
    const questions = normalizeQuestions(parseModelJson(raw), need);
    if (!questions.length) {
      throw new Error("Model returned no valid questions");
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, questions }));
  } catch (e) {
    const status = Number(e?.status);
    res.statusCode = status === 429 ? 429 : status === 503 ? 503 : 500;
    res.setHeader("Content-Type", "application/json");
    if (res.statusCode === 503) res.setHeader("Retry-After", "60");
    return res.end(
      JSON.stringify({
        ok: false,
        error: (e && e.message) || "Generation failed",
      }),
    );
  }
}
