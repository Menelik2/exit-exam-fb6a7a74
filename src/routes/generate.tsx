import { createFileRoute } from "@tanstack/react-router";
import { ExamGeneratorPage } from "@/components/exam-generator-page";

export const Route = createFileRoute("/generate")({
  component: ExamGeneratorPage,
  head: () => ({
    meta: [
      { title: "AI Exam Generator — Optional practice" },
      {
        name: "description",
        content:
          "Optional: generate custom multiple-choice exams by topic or from a document.",
      },
    ],
  }),
});
