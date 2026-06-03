import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  topic: z.string().min(1).max(200),
  difficulty: z.enum(["Beginner", "Intermediate", "Advanced"]),
  numQuestions: z.number().int().min(1).max(30),
  nonce: z.string().optional(),
  avoid: z.array(z.string().min(1).max(500)).max(500).optional(),
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

    const systemPrompt = `You are an expert Computer Science professor and exam generator. Your task is to generate a multiple-choice exam based on the topic and difficulty level provided by the user.

You must respond ONLY with a JSON object. Do not include any conversational text before or after the JSON.

The JSON structure must be an object with a "questions" array, where each item contains:
- "question_number": (int) The number of the question.
- "question": (string) The exam question.
- "options": (array of strings) Exactly 4 multiple-choice options.
- "correct_answer": (string) The exact string of the correct option (must match one option verbatim).
- "explanation": (string) A detailed explanation of why the correct answer is right, and why common misconceptions are incorrect.`;

    const avoidList = (data.avoid ?? []).slice(-200);
    const avoidBlock =
      avoidList.length > 0
        ? `\n\nSTRICT NO-REPEAT RULE: Do NOT repeat, rephrase, or produce semantically equivalent versions of any of these previously generated questions. Pick entirely different subtopics, angles, scenarios, and wording. Previously generated questions (one per line):\n${avoidList.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
        : "";

    const userPrompt = `Topic: ${data.topic}
Difficulty: ${data.difficulty}
Number of Questions: ${data.numQuestions}
Variation seed: ${data.nonce ?? Date.now()} — generate a fresh, distinct set of questions different from any prior generation. Vary subtopics, phrasing, and which option is correct.${avoidBlock}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
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
