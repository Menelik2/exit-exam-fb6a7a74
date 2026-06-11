import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BlueprintItemSchema = z.object({
  subject: z.string().min(1).max(120),
  objectives: z.string().max(800).optional().default(""),
  weight: z.number().min(0).max(100),
  count: z.number().int().min(0).max(200),
});

const InputSchema = z.object({
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

export const generateExam = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ questions: ExamQuestion[] }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

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

Respond ONLY with a JSON object via the provided tool. No prose, no markdown.

JSON structure: an object with a "questions" array; each item:
- "question_number": (int)
- "question": (string) clear, exam-grade stem
- "options": (array of 4 strings) plausible, mutually exclusive
- "correct_answer": (string) exact verbatim match of one option
- "explanation": (string) detailed rationale + distractor analysis`;

    const avoidList = (data.avoid ?? []).slice(-200);
    const avoidBlock =
      avoidList.length > 0
        ? `\n\nSTRICT NO-REPEAT RULE: Do NOT repeat, rephrase, or produce semantically equivalent versions of any of these previously generated questions. Pick entirely different subtopics, angles, scenarios, and wording. Previously generated questions (one per line):\n${avoidList.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
        : "";

    const blueprint = data.blueprint ?? [];
    const blueprintBlock =
      blueprint.length > 0
        ? `\n\nEXAM BLUEPRINT — you MUST follow this subject distribution exactly. Produce questions grouped per subject in the listed order, totaling ${data.numQuestions} questions:\n${blueprint
            .map(
              (b, i) =>
                `${i + 1}. Subject: "${b.subject}" — ${b.count} question(s) (weight ${b.weight}%)${b.objectives ? `\n   Learning objectives to cover: ${b.objectives}` : ""}`
            )
            .join(
              "\n"
            )}\n\nFor each subject, ensure the questions explicitly target the listed learning objectives. Do not exceed or fall short of the per-subject counts. Number questions globally 1..${data.numQuestions}.`
        : "";

    const userPrompt = `Topic / Course: ${data.topic}
Difficulty: ${data.difficulty}
Number of Questions: ${data.numQuestions}
Variation seed: ${data.nonce ?? Date.now()} — generate a fresh, distinct set of questions different from any prior generation. Vary subtopics, phrasing, and which option is correct.${blueprintBlock}${avoidBlock}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_exam",
              description: "Return the generated multiple-choice exam",
              parameters: {
                type: "object",
                properties: {
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        question_number: { type: "integer" },
                        question: { type: "string" },
                        options: {
                          type: "array",
                          items: { type: "string" },
                          minItems: 4,
                          maxItems: 4,
                        },
                        correct_answer: { type: "string" },
                        explanation: { type: "string" },
                      },
                      required: [
                        "question_number",
                        "question",
                        "options",
                        "correct_answer",
                        "explanation",
                      ],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["questions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_exam" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
      if (response.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
      const text = await response.text();
      throw new Error(`AI request failed: ${response.status} ${text}`);
    }

    const json = await response.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured exam data");
    }
    const parsed = JSON.parse(toolCall.function.arguments) as { questions: ExamQuestion[] };
    return { questions: parsed.questions };
  });

const DocInputSchema = z.object({
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
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

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

Respond ONLY via the provided tool. No prose, no markdown.`;

    const avoidList = (data.avoid ?? []).slice(-200);
    const avoidBlock =
      avoidList.length > 0
        ? `\n\nDo NOT repeat or rephrase these previously generated questions:\n${avoidList.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
        : "";

    const userPrompt = `Source Document: "${data.documentName}"
Difficulty: ${data.difficulty}
Number of Questions: ${data.numQuestions}
Variation seed: ${data.nonce ?? Date.now()}

=== DOCUMENT CONTENT START ===
${data.documentText}
=== DOCUMENT CONTENT END ===

Generate exactly ${data.numQuestions} multiple-choice questions based STRICTLY on the document above.${avoidBlock}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_exam",
              description: "Return the generated multiple-choice exam",
              parameters: {
                type: "object",
                properties: {
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        question_number: { type: "integer" },
                        question: { type: "string" },
                        options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
                        correct_answer: { type: "string" },
                        explanation: { type: "string" },
                      },
                      required: ["question_number", "question", "options", "correct_answer", "explanation"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["questions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_exam" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
      if (response.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
      const text = await response.text();
      throw new Error(`AI request failed: ${response.status} ${text}`);
    }

    const json = await response.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured exam data");
    }
    const parsed = JSON.parse(toolCall.function.arguments) as { questions: ExamQuestion[] };
    return { questions: parsed.questions };
  });

