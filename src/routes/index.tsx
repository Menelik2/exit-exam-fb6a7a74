import { createFileRoute } from "@tanstack/react-router";
import { PracticeHome } from "@/components/practice-home";

export const Route = createFileRoute("/")({
  component: PracticeHome,
  head: () => ({
    meta: [
      { title: "Exit Exam Practice — Select department & open exams" },
      {
        name: "description",
        content:
          "Choose your department, open stored exam PDFs/DOCX, or take practice quizzes. No AI generation required.",
      },
    ],
  }),
});
