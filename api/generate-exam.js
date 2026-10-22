/**
 * POST /api/generate-exam
 * Body: {
 *   topic?: string,
 *   documentName?: string,
 *   documentText?: string,
 *   difficulty?: "Beginner"|"Intermediate"|"Advanced",
 *   numQuestions?: number,
 *   apiKey?: string,
 *   avoid?: string[]
 * }
 */

const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-2.0-flash"];

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question_number: { type: "INTEGER" },
          question: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" } },
          correct_answer: { type: "STRING" },
          explanation: { type: "STRING" },
        },
        required: ["question_number", "question", "options", "correct_answer", "explanation"],
      },
    },
  },
  required: ["questions"],
};

function resolveApiKey(clientKey) {
  const trimmed = String(clientKey || "").trim();
  if (trimmed) return trimmed;
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ""
  ).trim();
}

function stripOptionPrefix(opt) {
  return String(opt || "").replace(/^\s*([A-Da-d]|[1-4])\s*[.):\-–]\s*/u, "").trim();
}

function normalizeQuestion(raw, index) {
  const question = String(raw.question || "").trim();
  if (!question) return null;

  let options = (Array.isArray(raw.options) ? raw.options : [])
    .map((o) => String(o ?? "").trim())
    .filter(Boolean);

  const seen = new Set();
  options = options.filter((o) => {
    const k = o.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (options.length < 2) return null;
  options = options.slice(0, 4);

  let correct = String(raw.correct_answer || "").trim();
  const letterMatch = correct.match(/^\s*([A-Da-d])\s*[.):]?\s*$/);
  const numMatch = correct.match(/^\s*([1-4])\s*$/);
  if (letterMatch) {
    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) correct = options[idx];
  } else if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < options.length) correct = options[idx];
  } else {
    let found = options.find((o) => o === correct);
    if (!found) found = options.find((o) => o.toLowerCase() === correct.toLowerCase());
    if (!found) {
      const cNorm = stripOptionPrefix(correct).toLowerCase();
      found = options.find(
        (o) =>
          stripOptionPrefix(o).toLowerCase() === cNorm ||
          o.toLowerCase().includes(cNorm) ||
          cNorm.includes(stripOptionPrefix(o).toLowerCase()),
      );
    }
    correct = found || options[0];
  }
  if (!options.includes(correct)) {
    const ci = options.find((o) => o.toLowerCase() === correct.toLowerCase());
    correct = ci || options[0];
  }

  return {
    question_number: index + 1,
    question,
    options,
    correct_answer: correct,
    explanation: String(raw.explanation || "").trim() || "No explanation provided.",
  };
}

function parseQuestionsJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (Array.isArray(parsed)) return parsed;
  return parsed.questions || [];
}

function normalizeBatch(raw) {
  const out = [];
  for (const r of raw) {
    const n = normalizeQuestion(r, out.length);
    if (n) out.push(n);
  }
  return out;
}

async function callGemini(apiKey, systemPrompt, userPrompt) {
  let lastErr = "";
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        lastErr = `${model} HTTP ${res.status}: ${body.slice(0, 180)}`;
        if (res.status === 404 || res.status === 400) continue;
        throw new Error(`Gemini failed (${model}): ${lastErr}`);
      }
      const data = await res.json();
      const text =
        (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("") || "";
      if (!text.trim()) {
        lastErr = `${model}: empty response`;
        continue;
      }
      const questions = normalizeBatch(parseQuestionsJson(text));
      if (!questions.length) {
        lastErr = `${model}: no valid questions`;
        continue;
      }
      return questions;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
  }
  throw new Error(`Gemini request failed: ${lastErr}`);
}

const SYSTEM_PROMPT = `You are an expert exam writer. Generate high-quality multiple-choice questions.
Rules:
- Exactly 4 options per question unless the topic truly needs fewer (minimum 2).
- correct_answer MUST be the full option text (not just "A" or "1").
- explanations should be 1-3 sentences, educational.
- Avoid repeating or paraphrasing questions listed in the avoid list.
- Output valid JSON matching the schema.`;

async function generateExactly(apiKey, buildUserPrompt, target, seedAvoid) {
  const collected = [];
  const seenNorm = new Set();
  const avoidList = Array.isArray(seedAvoid) ? seedAvoid.slice() : [];
  let attempts = 0;
  const maxAttempts = Math.min(12, Math.max(5, Math.ceil(target / 15) + 2));

  while (collected.length < target && attempts < maxAttempts) {
    attempts++;
    const need = target - collected.length;
    const extraAvoid = collected.map((q) => q.question);
    const userPrompt = buildUserPrompt(need, avoidList.concat(extraAvoid));
    let batch = [];
    try {
      batch = await callGemini(apiKey, SYSTEM_PROMPT, userPrompt);
    } catch (e) {
      if (attempts >= maxAttempts) throw e;
      continue;
    }
    for (const q of batch) {
      const key = q.question
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!key || seenNorm.has(key)) continue;
      seenNorm.add(key);
      collected.push({ ...q, question_number: collected.length + 1 });
      if (collected.length >= target) break;
    }
  }

  if (!collected.length) {
    throw new Error("Could not generate any valid questions. Try a different topic or check the API key.");
  }
  return collected.slice(0, target).map((q, i) => ({ ...q, question_number: i + 1 }));
}

async function readBody(req) {
  if (req.body != null) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body || "{}");
      } catch {
        return {};
      }
    }
    if (typeof req.body === "object") return req.body;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    const body = await readBody(req);
    const apiKey = resolveApiKey(body.apiKey);
    if (!apiKey) {
      res.statusCode = 400;
      return res.end(
        JSON.stringify({
          ok: false,
          error:
            "Gemini API key missing. Set GEMINI_API_KEY on Vercel, or paste a key in the panel on this page.",
        }),
      );
    }

    let difficulty = String(body.difficulty || "Beginner");
    if (!["Beginner", "Intermediate", "Advanced"].includes(difficulty)) difficulty = "Beginner";

    let numQuestions = parseInt(String(body.numQuestions ?? 5), 10);
    if (!Number.isFinite(numQuestions) || numQuestions < 1) numQuestions = 5;
    // Per-batch max for full-document chunk generation (admin can do up to 200 total across chunks)
    if (numQuestions > 100) numQuestions = 100;

    const topic = String(body.topic || "").trim().slice(0, 400);
    const documentText = String(body.documentText || "").trim().slice(0, 180000);
    const documentName = String(body.documentName || "Uploaded document").trim().slice(0, 200);
    const avoid = Array.isArray(body.avoid)
      ? body.avoid.map((s) => String(s).trim().slice(0, 140)).filter(Boolean).slice(-40)
      : [];
    const seed = String(body.nonce || Date.now());

    if (!documentText && !topic) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: "Enter a topic or upload a document first." }));
    }

    const questions = await generateExactly(
      apiKey,
      (need, extra) => {
        const allAvoid = extra.map((q) => String(q).trim().slice(0, 140)).filter(Boolean).slice(-40);
        const avoidBlock =
          allAvoid.length > 0
            ? `Avoid (do not repeat or paraphrase):\n${allAvoid.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
            : "";
        if (documentText) {
          return [
            `Task: Generate EXACTLY ${need} MCQs covering this document section thoroughly. Use the document only.`,
            `Document: ${documentName}`,
            `Difficulty: ${difficulty}`,
            `Seed: ${seed}`,
            `Requirements: 4 options; correct_answer = full option text; number 1..${need}.`,
            avoidBlock,
            "=== DOCUMENT ===",
            documentText,
            "=== END DOCUMENT ===",
          ]
            .filter(Boolean)
            .join("\n");
        }
        return [
          `Task: Generate EXACTLY ${need} MCQs.`,
          `Topic: ${topic}`,
          `Difficulty: ${difficulty}`,
          `Seed: ${seed}`,
          `Requirements: 4 options; correct_answer = full option text; number 1..${need}.`,
          avoidBlock,
        ]
          .filter(Boolean)
          .join("\n");
      },
      numQuestions,
      avoid,
    );

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, questions }));
  } catch (e) {
    res.statusCode = 500;
    return res.end(
      JSON.stringify({
        ok: false,
        error: (e && e.message) || "Generation failed",
      }),
    );
  }
}
