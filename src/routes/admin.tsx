import { createFileRoute } from "@tanstack/react-router";
import { AdminDashboard } from "@/components/admin-dashboard";

export const Route = createFileRoute("/admin")({
  component: AdminDashboard,
  head: () => ({
    meta: [
      { title: "Admin — Exit Exam Practice" },
      {
        name: "description",
        content: "Admin dashboard for departments, exam PDFs, and catalog management.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
