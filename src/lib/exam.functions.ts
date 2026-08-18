import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BlueprintItemSchema = z.object({
  subject: z.string().min(1).max(120),
  objectives: z.string().max(800).optional().default(""),
  weight: z.number().min(0).max(100),
  count: z.number().int().min(0).max(200),
});

const InputSchema = z.object({
  // Optional when server has OPENROUTER_API_KEY and provider is openrouter
  apiKey: z.string().max(200).optional().default(""),
  provider: z
    .enum(["openrouter", "gemini", "openai", "deepseek"])
    .optional()
    .default("openrouter"),
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
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-flash-lite-latest",
];

export type AiProvider = "openrouter" | "gemini" | "openai" | "deepseek";

const OPENAI_MODEL = "gpt-4o-mini";
const DEEPSEEK_MODEL = "deepseek-chat";
/** Fast, capable default on OpenRouter for MCQ drafting */
const OPENROUTER_MODEL = "openai/gpt-4o-mini";

function resolveApiKey(provider: AiProvider, clientKey: string): string {
  const trimmed = (clientKey ?? "").trim();
  if (trimmed) return trimmed;

  // Server-side env fallback (preferred for OpenRouter)
  const env =
    provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY
      : provider === "openai"
        ? process.env.OPENAI_API_KEY
        : provider === "deepseek"
          ? process.env.DEEPSEEK_API_KEY
          : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  return (env ?? "").trim();
}

async function callOpenRouter(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<ExamQuestion[]> {
  if (!apiKey) {
    throw new Error(
      "OpenRouter API key missing. Set OPENROUTER_API_KEY on the server or paste a key in the panel.",
    );
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://exit-exam-fb6a7a74.vercel.app",
      "X-Title": process.env.OPENROUTER_APP_TITLE || "Exit Exam Generator",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || OPENROUTER_MODEL,
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${userPrompt}\n\nReturn a JSON object shaped as {"questions": [{"question_number": number, "question": string, "options": string[4], "correct_answer": string, "explanation": string}]}.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error("Your OpenRouter API key was rejected. Check the key and try again.");
    }
    if (response.status === 429) {
      throw new Error("OpenRouter is rate limited. Try again in a moment.");
    }
    if (response.status === 402) {
      throw new Error("OpenRouter account has insufficient credits.");
    }
    throw new Error(`OpenRouter request failed: ${response.status} ${text}`);
  }

  const json = await response.json();
  const text: string | undefined = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter did not return content");

  // Models sometimes wrap JSON in markdown fences
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as { questions?: ExamQuestion[] };
  return parsed.questions ?? [];
}

async function callOpenAICompatible(
  provider: "openai" | "deepseek",
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<ExamQuestion[]> {
  const label = provider === "deepseek" ? "DeepSeek" : "OpenAI";
  if (!apiKey) throw new Error(`${label} API key missing`);

  const url =
    provider === "deepseek"
      ? "https://api.deepseek.com/chat/completions"
      : "https://api.openai.com/v1/chat/completions";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: provider === "deepseek" ? DEEPSEEK_MODEL : OPENAI_MODEL,
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${userPrompt}\n\nReturn a JSON object shaped as {"questions": [{"question_number": number, "question": string, "options": string[4], "correct_answer": string, "explanation": string}]}.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Your ${label} API key was rejected. Check the key and try again.`);
    }
    if (response.status === 429) {
      throw new Error(`${label} is rate limited or out of credit. Try again in a moment.`);
    }
    if (response.status === 402) {
      throw new Error(`${label} account has insufficient balance.`);
    }
    throw new Error(`${label} request failed: ${response.status} ${text}`);
  }

  const json = await response.json();
  const text: string | undefined = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${label} did not return content`);
  const parsed = JSON.parse(text) as { questions?: ExamQuestion[] };
  return parsed.questions ?? [];
}

function callModel(
  provider: AiProvider,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<ExamQuestion[]> {
  if (provider === "openrouter") {
    return callOpenRouter(apiKey, systemPrompt, userPrompt);
  }
  if (provider === "gemini") {
    return callGemini(apiKey, systemPrompt, userPrompt);
  }
  return callOpenAICompatible(provider, apiKey, systemPrompt, userPrompt);
}

async function callGemini(apiKey: string, systemPrompt: string, userPrompt: string): Promise<ExamQuestion[]> {
  if (!apiKey) throw new Error("Gemini API key missing");

  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.9,
    },
  });

  let lastErr = "";
  for (const model of MODEL_FALLBACKS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (response.ok) {
        const json = await response.json();
        const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Gemini did not return content");
        const parsed = JSON.parse(text) as { questions: ExamQuestion[] };
        return parsed.questions;
      }

      const text = await response.text();
      lastErr = `${response.status} ${text}`;

      if (response.status === 429) throw new Error("Gemini is rate limited. Please try again in a moment.");
      if (response.status === 404 || response.status === 400) break; // model unavailable — try next model
      if (response.status === 503 || response.status === 500 || response.status === 502) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw new Error(`Gemini request failed: ${lastErr}`);
    }
  }
  throw new Error(`Gemini request failed: ${lastErr || "no available model"}`);
}

const BATCH_SIZE = 25;

function normalizeKey(q: string) {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Generates EXACTLY `target` questions by batching requests and topping up
 * whenever the model returns fewer items than asked for.
 */
async function generateExactly(
  provider: AiProvider,
  apiKey: string,
  systemPrompt: string,
  buildUserPrompt: (need: number, extraAvoid: string[]) => string,
  target: number
): Promise<ExamQuestion[]> {
  const collected: ExamQuestion[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  const maxAttempts = Math.ceil(target / BATCH_SIZE) + 6;

  while (collected.length < target && attempts < maxAttempts) {
    attempts++;
    const need = Math.min(BATCH_SIZE, target - collected.length);
    let batch: ExamQuestion[] = [];
    try {
      batch = await callModel(provider, apiKey, systemPrompt, buildUserPrompt(need, collected.map((q) => q.question)));
    } catch (err) {
      if (collected.length === 0) throw err;
      break;
    }

    for (const q of batch) {
      if (collected.length >= target) break;
      if (!q?.question || !Array.isArray(q.options) || q.options.length < 2) continue;
      const key = normalizeKey(q.question);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(q);
    }
  }

  return collected.slice(0, target).map((q, i) => ({ ...q, question_number: i + 1 }));
}


export const generateExam = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: ExamQuestion[] }> => {
    const provider: AiProvider = data.provider ?? "openrouter";
    const apiKey = resolveApiKey(provider, data.apiKey ?? "");
    const systemPrompt = `You are a senior Ethiopian university professor and official examiner for the Ethiopian Higher Education Exit Examination (EHEEE). You write rigorous, exam-grade multiple-choice questions that match the style, depth, and cognitive level of the real Ethiopian Exit Exam administered by the Ministry of Education.

Follow these standards strictly:
- Align with the Ethiopian Exit Exam blueprint for the given topic/course (Bloom's levels: Understanding, Applying, Analyzing, Evaluating — minimize pure recall).
- Use precise academic language. Questions must be unambiguous, self-contained, and free of trick wording.
- Keep each question stem concise — ideally under 35 words and never over 60 words. Avoid long paragraphs or multi-sentence stems.
- Each item must have exactly 4 plausible options (A–D style) with strong, realistic distractors based on common student misconceptions in Ethiopian universities.
- Exactly one option must be unambiguously correct; "correct_answer" must match one option verbatim.
- Vary subtopics, scenarios, and which option is correct across the set. Avoid pattern bias.
- Explanations must be detailed, pedagogical, and explain WHY the correct answer is right AND why each distractor is wrong.
- Where relevant, use Ethiopian context (local examples, units, case studies) without making questions region-locked.

Respond ONLY with valid JSON matching the schema. No prose, no markdown.`;

    const avoidList = (data.avoid ?? []).slice(-200);
    const avoidText = (extra: string[]) => {
      const all = [...avoidList, ...extra].slice(-300);
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
          provider,
          apiKey,
          systemPrompt,
          (need, extra) => `Topic / Course: ${data.topic}\nSubject area: ${b.subject}${b.objectives ? `\nLearning objectives to cover: ${b.objectives}` : ""}\nDifficulty: ${data.difficulty}\nNumber of Questions: ${need}\nVariation seed: ${seed}\n\nGenerate EXACTLY ${need} multiple-choice questions for the subject area above. Number them 1..${need}.${avoidText([...all.map((q) => q.question), ...extra])}`,
          b.count
        );
        all.push(...subjectQs);
      }
      const questions = all.slice(0, data.numQuestions).map((q, i) => ({ ...q, question_number: i + 1 }));
      return { questions };
    }

    const questions = await generateExactly(
      provider,
      apiKey,
      systemPrompt,
      (need, extra) => `Topic / Course: ${data.topic}\nDifficulty: ${data.difficulty}\nNumber of Questions: ${need}\nVariation seed: ${seed} — generate a fresh, distinct set of questions different from any prior generation. Vary subtopics, phrasing, and which option is correct.\n\nGenerate EXACTLY ${need} multiple-choice questions. Number them 1..${need}. Never return fewer than ${need}.${avoidText(extra)}`,
      data.numQuestions
    );
    return { questions };
  });


const DocInputSchema = z.object({
  apiKey: z.string().max(200).optional().default(""),
  provider: z
    .enum(["openrouter", "gemini", "openai", "deepseek"])
    .optional()
    .default("openrouter"),
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
    const provider: AiProvider = data.provider ?? "openrouter";
    const apiKey = resolveApiKey(provider, data.apiKey ?? "");
    const systemPrompt = `You are a senior university professor writing rigorous multiple-choice exam questions STRICTLY from a provided source document.

ABSOLUTE RULES:
- Generate questions ONLY from facts, concepts, definitions, and examples explicitly present in the provided document. Do NOT introduce outside knowledge, opinions, or facts not in the document.
- If the document does not contain enough material for the requested number, generate as many as the document supports — never fabricate.
- Each question stem must be answerable from the document alone.
- Keep each question stem concise (under 35 words, never over 60). No long paragraphs.
- 4 plausible options, exactly one unambiguously correct; "correct_answer" must match an option verbatim.
- Distractors must be plausible misreadings of the document, not random.
- Vary subtopics across the whole document; avoid clustering only on the first pages.
- Explanations MUST cite the relevant idea from the document and explain why each distractor is wrong.

Respond ONLY with valid JSON matching the schema. No prose, no markdown.`;

    const avoidList = (data.avoid ?? []).slice(-200);
    const seed = data.nonce ?? String(Date.now());

    const questions = await generateExactly(
      provider,
      apiKey,
      systemPrompt,
      (need, extra) => {
        const all = [...avoidList, ...extra].slice(-300);
        const avoidBlock =
          all.length > 0
            ? `\n\nDo NOT repeat or rephrase these already generated questions:\n${all.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
            : "";
        return `Source Document: "${data.documentName}"\nDifficulty: ${data.difficulty}\nNumber of Questions: ${need}\nVariation seed: ${seed}\n\n=== DOCUMENT CONTENT START ===\n${data.documentText}\n=== DOCUMENT CONTENT END ===\n\nGenerate EXACTLY ${need} multiple-choice questions based STRICTLY on the document above. Number them 1..${need}.${avoidBlock}`;
      },
      data.numQuestions
    );
    return { questions };
  });
