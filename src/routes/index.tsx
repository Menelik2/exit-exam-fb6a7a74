import { createFileRoute } from "@tanstack/react-router";
import { ExamGeneratorPage } from "@/components/exam-generator-page";

export const Route = createFileRoute("/")({
  component: ExamGeneratorPage,
  head: () => ({
    meta: [
      { title: "Exam Generator — Instant Multiple Choice Quizzes" },
      {
        name: "description",
        content:
          "Generate custom multiple-choice exams by topic and difficulty. Preview answers and explanations instantly.",
      },
    ],
  }),
});
