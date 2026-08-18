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

const GEMINI_MODEL = "gemini-2.5-flash";

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

const MODEL_FALLBACKS = [
  GEMINI_MODEL,
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-1.5-flash",
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
      temperature: 0.95,
    },
  });

  let lastErr = "";
  for (const model of MODEL_FALLBACKS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body,
      });

      if (response.ok) {
        const json = await response.json();
        const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          const block = json?.candidates?.[0]?.finishReason || json?.promptFeedback;
          throw new Error(
            `Gemini returned no content${block ? ` (${JSON.stringify(block)})` : ""}. Try fewer questions or a simpler topic.`,
          );
        }
        try {
          return parseQuestionsJson(text);
        } catch {
          throw new Error("Gemini returned invalid JSON. Please try again.");
        }
      }

      const errBody = await response.text();
      lastErr = `${response.status} ${errBody.slice(0, 400)}`;

      if (response.status === 429) {
        throw new Error("Gemini is rate limited. Please try again in a moment.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "Gemini API key was rejected. Create a key at https://aistudio.google.com/apikey, set GEMINI_API_KEY on Vercel, and redeploy.",
        );
      }
      if (response.status === 404 || response.status === 400) break;
      if (response.status === 503 || response.status === 500 || response.status === 502) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw new Error(`Gemini request failed: ${lastErr}`);
    }
  }
  throw new Error(`Gemini request failed: ${lastErr || "no available model"}`);
}

const BATCH_SIZE = 15;

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
  const maxAttempts = Math.ceil(target / BATCH_SIZE) + 8;

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

    for (const q of batch) {
      if (collected.length >= target) break;
      if (!q?.question || !Array.isArray(q.options) || q.options.length < 2) continue;
      const key = normalizeKey(q.question);
      if (!key) continue;
      // Exact or fuzzy match against prior + already collected this run
      if (seenExact.has(key) || isSimilarToAny(q.question, seenTexts)) continue;
      seenExact.add(key);
      seenTexts.push(q.question);
      collected.push(q);
    }
  }

  if (collected.length === 0) {
    throw new Error(
      "Could not generate new questions without repeating old ones. Try a broader topic or clear question history.",
    );
  }

  return collected.slice(0, target).map((q, i) => ({ ...q, question_number: i + 1 }));
}

export const generateExam = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: ExamQuestion[] }> => {
    const apiKey = resolveApiKey(data.apiKey ?? "");
    const systemPrompt = `You are a senior Ethiopian university professor and official examiner for the Ethiopian Higher Education Exit Examination (EHEEE). You write rigorous, exam-grade multiple-choice questions that match the style, depth, and cognitive level of the real Ethiopian Exit Exam administered by the Ministry of Education.\n\nFollow these standards strictly:\n- Align with the Ethiopian Exit Exam blueprint for the given topic/course (Bloom's levels: Understanding, Applying, Analyzing, Evaluating — minimize pure recall).\n- Use precise academic language. Questions must be unambiguous, self-contained, and free of trick wording.\n- Keep each question stem concise — ideally under 35 words and never over 60 words. Avoid long paragraphs or multi-sentence stems.\n- Each item must have exactly 4 plausible options (A–D style) with strong, realistic distractors based on common student misconceptions in Ethiopian universities.\n- Exactly one option must be unambiguously correct; \"correct_answer\" must match one option verbatim.\n- Vary subtopics, scenarios, and which option is correct across the set. Avoid pattern bias.\n- Explanations must be detailed, pedagogical, and explain WHY the correct answer is right AND why each distractor is wrong.\n- Where relevant, use Ethiopian context (local examples, units, case studies) without making questions region-locked.\n\nRespond ONLY with valid JSON matching the schema. No prose, no markdown.`;

    const avoidList = (data.avoid ?? []).slice(-300);
    const avoidText = (extra: string[]) => {
      const all = [...avoidList, ...extra].slice(-400);
      return all.length > 0
        ? `\n\nSTRICT NO-REPEAT RULE: Do NOT repeat, rephrase, or produce semantically equivalent versions of any of these questions. Pick entirely different subtopics, angles, scenarios, and wording. Already used questions (one per line):\n${all.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
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
        `Topic / Course: ${data.topic}\nDifficulty: ${data.difficulty}\nNumber of Questions: ${need}\nVariation seed: ${seed} — generate a fresh, distinct set of questions different from any prior generation. Vary subtopics, phrasing, and which option is correct.\n\nGenerate EXACTLY ${need} NEW multiple-choice questions. Number them 1..${need}. Never return fewer than ${need}. Never repeat old questions.${avoidText(extra)}`,
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
    const systemPrompt = `You are a senior university professor writing rigorous multiple-choice exam questions STRICTLY from a provided source document.\n\nABSOLUTE RULES:\n- Generate questions ONLY from facts, concepts, definitions, and examples explicitly present in the provided document. Do NOT introduce outside knowledge, opinions, or facts not in the document.\n- If the document does not contain enough material for the requested number, generate as many as the document supports — never fabricate.\n- Each question stem must be answerable from the document alone.\n- Keep each question stem concise (under 35 words, never over 60). No long paragraphs.\n- 4 plausible options, exactly one unambiguously correct; \"correct_answer\" must match an option verbatim.\n- Distractors must be plausible misreadings of the document, not random.\n- Vary subtopics across the whole document; avoid clustering only on the first pages.\n- Explanations MUST cite the relevant idea from the document and explain why each distractor is wrong.\n\nRespond ONLY with valid JSON matching the schema. No prose, no markdown.`;

    const avoidList = (data.avoid ?? []).slice(-300);
    const seed = data.nonce ?? String(Date.now());

    const questions = await generateExactly(
      apiKey,
      systemPrompt,
      (need, extra) => {
        const all = [...avoidList, ...extra].slice(-400);
        const avoidBlock =
          all.length > 0
            ? `\n\nSTRICT NO-REPEAT: Do NOT repeat or rephrase these already generated questions:\n${all.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
            : "";
        return `Source Document: \"${data.documentName}\"\nDifficulty: ${data.difficulty}\nNumber of Questions: ${need}\nVariation seed: ${seed}\n\n=== DOCUMENT CONTENT START ===\n${data.documentText}\n=== DOCUMENT CONTENT END ===\n\nGenerate EXACTLY ${need} NEW multiple-choice questions based STRICTLY on the document above. Number them 1..${need}.${avoidBlock}`;
      },
      data.numQuestions,
      avoidList,
    );
    return { questions };
  });
