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

// Current Gemini models (as of 2026). Avoid retired IDs (1.5-flash, 2.0-flash).
const GEMINI_MODEL = "gemini-2.5-flash";
const MODEL_FALLBACKS = [
  "gemini-2.5-flash-lite", // fastest / cheapest
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-flash-latest", // alias if supported
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

function normalizeQuestions(list: ExamQuestion[]): ExamQuestion[] {
  const out: ExamQuestion[] = [];
  for (const raw of list) {
    const n = normalizeQuestion(raw, out.length);
    if (n) out.push(n);
  }
  return out.map((q, i) => ({ ...q, question_number: i + 1 }));
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<ExamQuestion[]> {
  if (!apiKey) {
    throw new Error(
      "Gemini API key missing. Set GEMINI_API_KEY on Vercel (Environment Variables) and redeploy, or paste a key in the panel.",
    );
  }

  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.85,
    },
  });

  let lastErr = "";
  // Bounded retries so serverless functions do not time out (Vercel ~60s)
  const maxAttemptsPerModel = 3;
  for (const model of MODEL_FALLBACKS) {
    for (let attempt = 0; attempt < maxAttemptsPerModel; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body,
        });
      } catch (netErr) {
        lastErr = `network ${(netErr as Error).message || netErr}`;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }

      if (response.ok) {
        const json = await response.json();
        const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          const block = json?.candidates?.[0]?.finishReason || json?.promptFeedback;
          // Empty content — retry same model
          lastErr = `empty content ${block ? JSON.stringify(block) : ""}`;
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        try {
          const raw = parseQuestionsJson(text);
          const normalized = normalizeQuestions(raw);
          if (normalized.length === 0) {
            lastErr = "parsed zero valid questions";
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          return normalized;
        } catch {
          lastErr = "invalid JSON from model";
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
      }

      const errBody = await response.text();
      lastErr = `${response.status} ${errBody.slice(0, 400)}`;

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "Gemini API key was rejected. Create a key at https://aistudio.google.com/apikey, set GEMINI_API_KEY on Vercel, and redeploy.",
        );
      }

      // Model not found / bad request — skip to next model (do not burn retries)
      if (response.status === 404 || response.status === 400) {
        break;
      }

      // Rate limit or temporary errors — wait and retry (respect Retry-After, capped)
      if (
        response.status === 429 ||
        response.status === 503 ||
        response.status === 500 ||
        response.status === 502
      ) {
        const retryAfterHeader = response.headers.get("retry-after");
        let waitMs = 0;
        if (retryAfterHeader) {
          const sec = Number(retryAfterHeader);
          waitMs = Number.isFinite(sec) && sec > 0 ? sec * 1000 : 0;
        }
        // Keep waits short so generation stays responsive
        if (waitMs <= 0) {
          waitMs = Math.min(6_000, 1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
        } else {
          waitMs = Math.min(6_000, waitMs);
        }
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      throw new Error(`Gemini request failed: ${lastErr}`);
    }
  }
  const hint = lastErr.includes("404") || lastErr.includes("NOT_FOUND")
    ? " No available Gemini model responded. Check that your API key can access gemini-2.5-flash."
    : " Try again in a few seconds, or use fewer questions.";
  throw new Error(
    `Could not generate questions after retries.${lastErr ? ` (${lastErr.slice(0, 280)})` : ""}${hint}`,
  );
}

const BATCH_SIZE = 25;

function normalizeKey(q: string) {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Word tokens (length > 2) for fuzzy comparison */
function questionTokens(q: string): Set<string> {
  const norm = normalizeKey(q);
  const parts = norm.split(" ").filter((w) => w.length > 2);
  return new Set(parts);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Fuzzy match: true if questions are exact, near-substring, or share enough content words.
 * threshold ~0.72 catches rephrases while allowing genuinely different questions.
 */
function isSimilarQuestion(a: string, b: string, threshold = 0.72): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // One stem largely contains the other (reworded with extra clause)
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.65) {
    return true;
  }

  const sim = jaccardSimilarity(questionTokens(na), questionTokens(nb));
  return sim >= threshold;
}

function isSimilarToAny(q: string, list: string[], threshold = 0.72): boolean {
  for (const item of list) {
    if (isSimilarQuestion(q, item, threshold)) return true;
  }
  return false;
}

async function generateExactly(
  apiKey: string,
  systemPrompt: string,
  buildUserPrompt: (need: number, extraAvoid: string[]) => string,
  target: number,
  /** Already-seen question texts (from prior sessions / avoid list) */
  priorAvoid: string[] = [],
): Promise<ExamQuestion[]> {
  const collected: ExamQuestion[] = [];
  // Keep raw texts for fuzzy checks (exact keys alone miss paraphrases)
  const seenTexts: string[] = priorAvoid.filter((t) => t.trim().length > 0);
  const seenExact = new Set<string>(seenTexts.map(normalizeKey).filter(Boolean));
  let attempts = 0;
  const maxAttempts = Math.min(4, Math.ceil(target / BATCH_SIZE) + 2);

  while (collected.length < target && attempts < maxAttempts) {
    attempts++;
    const need = Math.min(BATCH_SIZE, target - collected.length);
    let batch: ExamQuestion[] = [];
    try {
      batch = await callGemini(
        apiKey,
        systemPrompt,
        buildUserPrompt(
          need,
          collected.map((q) => q.question),
        ),
      );
    } catch (err) {
      if (collected.length === 0) throw err;
      break;
    }

    let added = 0;
    for (const q of batch) {
      if (collected.length >= target) break;
      if (!q?.question || !Array.isArray(q.options) || q.options.length < 2) continue;
      // Re-normalize in case anything slipped through
      const fixed = normalizeQuestion(q, collected.length);
      if (!fixed) continue;
      const key = normalizeKey(fixed.question);
      if (!key) continue;
      if (seenExact.has(key) || isSimilarToAny(fixed.question, seenTexts)) continue;
      seenExact.add(key);
      seenTexts.push(fixed.question);
      collected.push(fixed);
      added++;
    }
    // If model only returned duplicates, still count as an attempt (loop continues)
    if (added === 0 && batch.length > 0) {
      // small pause before next batch request
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  if (collected.length === 0) {
    throw new Error(
      "Could not generate new questions without repeating old ones. Clear question history or try a broader topic.",
    );
  }

  return collected.slice(0, target).map((q, i) => ({ ...q, question_number: i + 1 }));
}

export const generateExam = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: ExamQuestion[] }> => {
    const apiKey = resolveApiKey(data.apiKey ?? "");
    const systemPrompt = `Role: Ethiopian Higher Education Exit Exam (EHEEE) examiner. Write rigorous MCQs at university exit-exam level.

Output: JSON only (schema enforced). No markdown, no extra text.

Rules:
1. Exactly the requested number of questions; never fewer if the topic supports it.
2. Each stem: clear, self-contained, ≤40 words; no trick wording.
3. Exactly 4 options; one correct; three plausible distractors (common student errors).
4. "correct_answer" MUST be the FULL TEXT of the correct option (copy verbatim from options[]) — never only "A"/"B"/"C"/"D".
5. Cognitive level: prefer Apply / Analyze / Evaluate over pure recall.
6. Vary subtopics and which option is correct; no repeating patterns.
7. explanation: 2–4 sentences — why correct is right and why the main distractors fail.
8. Academic tone; Ethiopian context only when it helps (not required).

Quality bar: questions a graduating student would see on a real exit exam.`;

    const avoidList = (data.avoid ?? []).slice(-80);
    const avoidText = (extra: string[]) => {
      const all = [...avoidList, ...extra]
        .map((q) => q.trim().slice(0, 140))
        .filter(Boolean)
        .slice(-40);
      return all.length > 0
        ? `Avoid (do not repeat or paraphrase):\n${all.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
        : "";
    };

    const blueprint = data.blueprint ?? [];
    const seed = data.nonce ?? String(Date.now());

    if (blueprint.length > 0) {
      const all: ExamQuestion[] = [];
      for (const b of blueprint) {
        if (b.count <= 0) continue;
        const subjectQs = await generateExactly(
          apiKey,
          systemPrompt,
          (need, extra) =>
            `Topic / Course: ${data.topic}\nSubject area: ${b.subject}${b.objectives ? `\nLearning objectives to cover: ${b.objectives}` : ""}\nDifficulty: ${data.difficulty}\nNumber of Questions: ${need}\nVariation seed: ${seed}\n\nGenerate EXACTLY ${need} NEW multiple-choice questions for the subject area above. Number them 1..${need}.${avoidText([...all.map((q) => q.question), ...extra])}`,
          b.count,
          [...avoidList, ...all.map((q) => q.question)],
        );
        all.push(...subjectQs);
      }
      const questions = all.slice(0, data.numQuestions).map((q, i) => ({
        ...q,
        question_number: i + 1,
      }));
      return { questions };
    }

    const questions = await generateExactly(
      apiKey,
      systemPrompt,
      (need, extra) =>
        [
          `Task: Generate EXACTLY ${need} new multiple-choice questions.`,
          `Topic/Course: ${data.topic}`,
          `Difficulty: ${data.difficulty}`,
          `Seed: ${seed} (vary angles; do not reuse prior items).`,
          `Requirements: 4 options each; correct_answer = full option text; numbered 1..${need}.`,
          avoidText(extra).trim(),
        ]
          .filter(Boolean)
          .join("\n"),
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
  .inputValidator((input: unknown) => DocInputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: ExamQuestion[] }> => {
    const apiKey = resolveApiKey(data.apiKey ?? "");
    const systemPrompt = `Role: Exam writer. Create MCQs STRICTLY from the source document only.

Output: JSON only. No markdown, no extra text.

Rules:
1. Use ONLY facts, definitions, and examples present in the document. Never invent outside knowledge.
2. If material is thin, return as many solid items as the document supports — do not pad with fabrication.
3. Stem ≤40 words; answerable from the document alone.
4. Exactly 4 options; one correct; distractors = plausible misreadings of the text.
5. "correct_answer" MUST be the FULL TEXT of the correct option (verbatim from options[]) — never only a letter.
6. Cover different parts of the document; do not cluster on the opening paragraphs only.
7. explanation: briefly ground the answer in the document and note why key distractors fail.`;

    const avoidList = (data.avoid ?? []).slice(-80);
    const seed = data.nonce ?? String(Date.now());
    const docBody =
      data.documentText.length > 60000
        ? data.documentText.slice(0, 60000) + "\n\n[Document truncated for speed]"
        : data.documentText;

    const questions = await generateExactly(
      apiKey,
      systemPrompt,
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
