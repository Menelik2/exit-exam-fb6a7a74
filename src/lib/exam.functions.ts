import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BlueprintItemSchema = z.object({
  subject: z.string().min(1).max(120),
  objectives: z.string().max(800).optional().default(""),
  weight: z.number().min(0).max(100),
  count: z.number().int().min(0).max(200),
});

const InputSchema = z.object({
  apiKey: z.string().max(200).optional().default(""),
  provider: z.enum(["gemini"]).optional().default("gemini"),
  topic: z.string().min(1).max(400),
  difficulty: z.enum(["Beginner", "Intermediate", "Advanced"]),
  numQuestions: z.number().int().min(1).max(200),
  nonce: z.string().optional(),
  avoid: z.array(z.string().min(1).max(500)).max(500).optional(),
  blueprint: z.array(BlueprintItemSchema).max(12).optional(),
});

export type ExamQuestion = {
  question_number: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
};

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
} as const;

// Prefer known-stable Gemini models. Speculative / unreleased IDs only add 404 latency.
const GEMINI_MODEL = "gemini-2.5-flash";
const MODEL_FALLBACKS = [
  GEMINI_MODEL,
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
];

export type AiProvider = "gemini";

function resolveApiKey(clientKey: string): string {
  const trimmed = (clientKey ?? "").trim();
  if (trimmed) return trimmed;
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ""
  ).trim();
}

function parseQuestionsJson(text: string): ExamQuestion[] {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as { questions?: ExamQuestion[] } | ExamQuestion[];
  if (Array.isArray(parsed)) return parsed;
  return parsed.questions ?? [];
}

/** Strip leading "A.", "A)", "(A)", "A -" etc. from option text */
function stripOptionPrefix(opt: string): string {
  return opt.replace(/^\s*([A-Da-d]|[1-4])\s*[.):\-–]\s*/u, "").trim();
}

/**
 * Normalize a raw model question so options/correct_answer always line up.
 * Gemini often returns correct_answer as "A" / "B" instead of full option text.
 */
function normalizeQuestion(raw: ExamQuestion, index: number): ExamQuestion | null {
  const question = (raw.question ?? "").trim();
  if (!question) return null;

  let options = (Array.isArray(raw.options) ? raw.options : [])
    .map((o) => String(o ?? "").trim())
    .filter(Boolean);

  // Deduplicate options (case-insensitive)
  const seenOpts = new Set<string>();
  options = options.filter((o) => {
    const k = o.toLowerCase();
    if (seenOpts.has(k)) return false;
    seenOpts.add(k);
    return true;
  });

  if (options.length < 2) return null;

  // Keep at most 4 options
  options = options.slice(0, 4);

  let correct = String(raw.correct_answer ?? "").trim();

  // Map letter / index answers to option text
  const letterMatch = correct.match(/^\s*([A-Da-d])\s*[.):]?\s*$/);
  const numMatch = correct.match(/^\s*([1-4])\s*$/);
  if (letterMatch) {
    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) correct = options[idx];
  } else if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < options.length) correct = options[idx];
  } else {
    // Try exact match
    let found = options.find((o) => o === correct);
    if (!found) {
      // Case-insensitive match
      found = options.find((o) => o.toLowerCase() === correct.toLowerCase());
    }
    if (!found) {
      // Match after stripping prefixes from both sides
      const cNorm = stripOptionPrefix(correct).toLowerCase();
      found = options.find(
        (o) =>
          stripOptionPrefix(o).toLowerCase() === cNorm ||
          o.toLowerCase().includes(cNorm) ||
          cNorm.includes(stripOptionPrefix(o).toLowerCase()),
      );
    }
    if (found) correct = found;
    else {
      // Last resort: first option (better than a non-matching string that breaks UI)
      correct = options[0];
    }
  }

  // Ensure correct_answer is exactly one of the options
  if (!options.includes(correct)) {
    const ci = options.find((o) => o.toLowerCase() === correct.toLowerCase());
    correct = ci ?? options[0];
  }

  const explanation = String(raw.explanation ?? "").trim() || "No explanation provided.";

  return {
    question_number: index + 1,
    question,
    options,
    correct_answer: correct,
    explanation,
  };
}

function normalizeBatch(raw: ExamQuestion[]): ExamQuestion[] {
  const out: ExamQuestion[] = [];
  for (const r of raw) {
    const n = normalizeQuestion(r, out.length);
    if (n) out.push(n);
  }
  return out;
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<ExamQuestion[]> {
  let lastErr = "";
  for (const model of MODEL_FALLBACKS) {
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
        lastErr = `${model} HTTP ${res.status}: ${body.slice(0, 200)}`;
        // Try next model on 404 / not found
        if (res.status === 404 || res.status === 400) continue;
        throw new Error(`Gemini request failed (${model}): ${lastErr}`);
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text.trim()) {
        lastErr = `${model}: empty response`;
        continue;
      }
      const questions = normalizeBatch(parseQuestionsJson(text));
      if (questions.length === 0) {
        lastErr = `${model}: no valid questions in response`;
        continue;
      }
      return questions;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (lastErr.includes("HTTP 404") || lastErr.includes("HTTP 400")) continue;
      // Network / parse errors: try next model once, then rethrow if all fail
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

async function generateExactly(
  apiKey: string,
  systemPrompt: string,
  buildUserPrompt: (need: number, extraAvoid: string[]) => string,
  target: number,
  seedAvoid: string[] = [],
): Promise<ExamQuestion[]> {
  const collected: ExamQuestion[] = [];
  const seenNorm = new Set<string>();
  const avoidList = [...seedAvoid];
  let attempts = 0;
  const maxAttempts = 6;

  while (collected.length < target && attempts < maxAttempts) {
    attempts++;
    const need = target - collected.length;
    const extraAvoid = collected.map((q) => q.question);
    const userPrompt = buildUserPrompt(need, [...avoidList, ...extraAvoid]);
    let batch: ExamQuestion[] = [];
    try {
      batch = await callGemini(apiKey, systemPrompt, userPrompt);
    } catch (e) {
      if (attempts >= maxAttempts) throw e;
      continue;
    }
    for (const q of batch) {
      const key = q.question.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      if (!key || seenNorm.has(key)) continue;
      seenNorm.add(key);
      collected.push({ ...q, question_number: collected.length + 1 });
      if (collected.length >= target) break;
    }
  }

  if (collected.length === 0) {
    throw new Error("Could not generate any valid questions. Try a different topic or check your API key.");
  }
  // Renumber
  return collected.slice(0, target).map((q, i) => ({ ...q, question_number: i + 1 }));
}

export const generateExam = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: ExamQuestion[] }> => {
    const apiKey = resolveApiKey(data.apiKey ?? "");
    if (!apiKey) {
      throw new Error(
        "Gemini API key missing. Set GEMINI_API_KEY on Vercel or paste a key in the panel.",
      );
    }

    const avoidList = (data.avoid ?? []).map((s) => s.trim()).filter(Boolean);
    const seed = data.nonce ?? String(Date.now());

    if (data.blueprint && data.blueprint.length > 0) {
      const all: ExamQuestion[] = [];
      for (const item of data.blueprint) {
        if (item.count <= 0) continue;
        const subjectQs = await generateExactly(
          apiKey,
          SYSTEM_PROMPT,
          (need, extra) => {
            const allAvoid = [...avoidList, ...extra]
              .map((q) => q.trim().slice(0, 140))
              .filter(Boolean)
              .slice(-40);
            const avoidBlock =
              allAvoid.length > 0
                ? `Avoid (do not repeat or paraphrase):\n${allAvoid.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
                : "";
            return [
              `Task: Generate EXACTLY ${need} MCQs.`,
              `Topic / subject: ${item.subject}`,
              item.objectives ? `Learning objectives: ${item.objectives}` : "",
              `Difficulty: ${data.difficulty}`,
              `Weight hint: ${item.weight}% of exam`,
              `Seed: ${seed}`,
              `Requirements: 4 options; correct_answer = full option text; number 1..${need}.`,
              avoidBlock.trim(),
            ]
              .filter(Boolean)
              .join("\n");
          },
          item.count,
          avoidList,
        );
        all.push(...subjectQs);
      }
      return {
        questions: all.map((q, i) => ({ ...q, question_number: i + 1 })),
      };
    }

    const questions = await generateExactly(
      apiKey,
      SYSTEM_PROMPT,
      (need, extra) => {
        const allAvoid = [...avoidList, ...extra]
          .map((q) => q.trim().slice(0, 140))
          .filter(Boolean)
          .slice(-40);
        const avoidBlock =
          allAvoid.length > 0
            ? `Avoid (do not repeat or paraphrase):\n${allAvoid.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
            : "";
        return [
          `Task: Generate EXACTLY ${need} MCQs.`,
          `Topic: ${data.topic}`,
          `Difficulty: ${data.difficulty}`,
          `Seed: ${seed}`,
          `Requirements: 4 options; correct_answer = full option text; number 1..${need}.`,
          avoidBlock.trim(),
        ]
          .filter(Boolean)
          .join("\n");
      },
      data.numQuestions,
      avoidList,
    );
    return { questions };
  });

const DocInputSchema = z.object({
  apiKey: z.string().max(200).optional().default(""),
  provider: z.enum(["gemini"]).optional().default("gemini"),
  documentName: z.string().min(1).max(200),
  documentText: z.string().min(20).max(200000),
  difficulty: z.enum(["Beginner", "Intermediate", "Advanced"]),
  numQuestions: z.number().int().min(1).max(200),
  nonce: z.string().optional(),
  avoid: z.array(z.string().min(1).max(500)).max(500).optional(),
});

export const generateExamFromDocument = createServerFn({ method: "POST" })
  .validator((input: unknown) => DocInputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: ExamQuestion[] }> => {
    const apiKey = resolveApiKey(data.apiKey ?? "");
    if (!apiKey) {
      throw new Error(
        "Gemini API key missing. Set GEMINI_API_KEY on Vercel or paste a key in the panel.",
      );
    }

    const avoidList = (data.avoid ?? []).map((s) => s.trim()).filter(Boolean);
    const seed = data.nonce ?? String(Date.now());
    const docBody = data.documentText.slice(0, 180000);

    const questions = await generateExactly(
      apiKey,
      SYSTEM_PROMPT,
      (need, extra) => {
        const all = [...avoidList, ...extra]
          .map((q) => q.trim().slice(0, 140))
          .filter(Boolean)
          .slice(-40);
        const avoidBlock =
          all.length > 0
            ? `Avoid (do not repeat or paraphrase):\n${all.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
            : "";
        return [
          `Task: Generate EXACTLY ${need} MCQs from the document only.`,
          `Document: ${data.documentName}`,
          `Difficulty: ${data.difficulty}`,
          `Seed: ${seed}`,
          `Requirements: 4 options; correct_answer = full option text; number 1..${need}.`,
          avoidBlock.trim(),
          `=== DOCUMENT ===`,
          docBody,
          `=== END DOCUMENT ===`,
        ]
          .filter(Boolean)
          .join("\n");
      },
      data.numQuestions,
      avoidList,
    );
    return { questions };
  });
