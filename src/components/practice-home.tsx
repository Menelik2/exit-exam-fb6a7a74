import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { apiGetCatalog } from "@/lib/admin-api";
import type { Catalog, Department, ExamEntry, StoredQuestion } from "@/components/admin-types";
import type { ExamQuestion } from "@/lib/exam.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Building2,
  ChevronLeft,
  FileText,
  ListChecks,
  Loader2,
  MessageCircle,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { ExamQuizBody } from "@/components/ExamQuizBody";
import type { MoodleNavState } from "@/components/moodle-quiz-ui";
import { isOptionCorrect } from "@/lib/exam-page-helpers";

type View = "departments" | "exams" | "quiz";

function toExamQuestions(raw: StoredQuestion[]): ExamQuestion[] {
  return raw.map((q, i) => ({
    question_number: i + 1,
    question: q.question,
    options: q.options,
    correct_answer: q.correct_answer,
    explanation: q.explanation || "",
  }));
}

export function PracticeHome() {
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<Catalog>({ departments: [], updatedAt: "" });
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("departments");
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [activeExam, setActiveExam] = useState<ExamEntry | null>(null);

  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<"attempt" | "summary" | "review">("attempt");
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const [navOpen, setNavOpen] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGetCatalog();
        if (cancelled) return;
        const depts = res?.catalog?.departments;
        setCatalog({
          departments: Array.isArray(depts) ? (depts as Department[]) : [],
          updatedAt: res?.catalog?.updatedAt || new Date().toISOString(),
        });
      } catch (e) {
        if (!cancelled) toast.error((e as Error).message || "Could not load exams");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const departments = catalog.departments || [];

  const filteredDepts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.id.includes(q) ||
        (d.exams || []).some((e) => e.title.toLowerCase().includes(q)),
    );
  }, [departments, search]);

  const openDept = (d: Department) => {
    setSelectedDept(d);
    setView("exams");
    setSearch("");
  };

  const backToDepts = () => {
    setView("departments");
    setSelectedDept(null);
    setActiveExam(null);
  };

  const startStoredQuiz = (exam: ExamEntry) => {
    const qs = exam.questions;
    if (!qs || qs.length === 0) {
      toast.error("No practice questions stored for this exam yet");
      return;
    }
    setActiveExam(exam);
    setQuestions(toExamQuestions(qs));
    setAnswers({});
    setCurrentIndex(0);
    setPhase("attempt");
    setFlagged({});
    setConfirmSubmit(false);
    setView("quiz");
  };

  const exitQuiz = () => {
    setView(selectedDept ? "exams" : "departments");
    setActiveExam(null);
    setQuestions([]);
    setAnswers({});
  };

  const selectAnswer = (q: ExamQuestion, opt: string) => {
    if (phase !== "attempt") return;
    setAnswers((a) => ({ ...a, [q.question_number]: opt }));
  };

  const finishAttempt = () => {
    setPhase("summary");
    setConfirmSubmit(false);
  };

  const submitAllAndFinish = () => {
    setPhase("review");
    setConfirmSubmit(false);
    setCurrentIndex(0);
    toast.success("Quiz submitted");
  };

  const correctCount = questions.filter(
    (q) => answers[q.question_number] != null && isOptionCorrect(q, answers[q.question_number]),
  ).length;
  const answeredCount = questions.filter((q) => answers[q.question_number] != null).length;
  const notAnsweredCount = questions.length - answeredCount;
  const incorrectCount = questions.length - correctCount;
  const scorePercent = questions.length ? Math.round((correctCount / questions.length) * 100) : 0;
  const currentQuestion = questions[currentIndex];
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= questions.length - 1;
  const hasActiveQuiz = (phase === "attempt" || phase === "review") && !!currentQuestion;
  const showSummary = phase === "summary" && questions.length > 0;

  const navState = (q: ExamQuestion): MoodleNavState => {
    const answered = answers[q.question_number] != null;
    if (phase === "review") {
      if (answered && isOptionCorrect(q, answers[q.question_number])) return "correct";
      return "incorrect";
    }
    return answered ? "answered" : "todo";
  };

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading exams…
      </div>
    );
  }

  if (view === "quiz" && activeExam) {
    return (
      <div className="min-h-dvh w-full bg-background text-foreground">
        <header className="sticky top-0 z-50 border-b border-border/60 bg-card/80 pt-[env(safe-area-inset-top)] backdrop-blur-2xl">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={exitQuiz}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-card text-muted-foreground hover:bg-muted"
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <p className="truncate font-display text-[15px] font-semibold tracking-tight">
                  {activeExam.title}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {phase === "attempt"
                    ? `Q${currentIndex + 1}/${questions.length}`
                    : phase === "summary"
                      ? "Summary"
                      : `Review · ${correctCount}/${questions.length}`}
                </p>
              </div>
            </div>
            {hasActiveQuiz && (
              <button
                type="button"
                className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border/80 bg-card px-3.5 text-xs font-medium lg:hidden"
                onClick={() => setNavOpen(true)}
              >
                Nav
              </button>
            )}
          </div>
        </header>
        <div className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-5 lg:px-6">
          <ExamQuizBody
            showSummary={showSummary}
            hasActiveQuiz={hasActiveQuiz}
            phase={phase}
            docMode
            docName={activeExam.title}
            topic={selectedDept?.name || ""}
            difficulty="Practice"
            questions={questions}
            answers={answers}
            currentIndex={currentIndex}
            currentQuestion={currentQuestion}
            answeredCount={answeredCount}
            notAnsweredCount={notAnsweredCount}
            correctCount={correctCount}
            incorrectCount={incorrectCount}
            scorePercent={scorePercent}
            confirmSubmit={confirmSubmit}
            flagged={flagged}
            navOpen={navOpen}
            isFirst={isFirst}
            isLast={isLast}
            setConfirmSubmit={setConfirmSubmit}
            setPhase={(p) => setPhase(p as "attempt" | "summary" | "review")}
            setCurrentIndex={setCurrentIndex}
            setNavOpen={setNavOpen}
            setFlagged={setFlagged}
            selectAnswer={selectAnswer}
            finishAttempt={finishAttempt}
            submitAllAndFinish={submitAllAndFinish}
            navState={navState}
            setSettingsOpen={() => {}}
          />
        </div>
      </div>
    );
  }

  if (view === "exams" && selectedDept) {
    const exams = selectedDept.exams || [];
    const q = search.trim().toLowerCase();
    const list = q ? exams.filter((e) => e.title.toLowerCase().includes(q)) : exams;

    return (
      <div className="min-h-dvh bg-background text-foreground">
        <header className="sticky top-0 z-50 border-b border-border/60 bg-card/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={backToDepts}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/80 hover:bg-muted"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-semibold">
                <span className="mr-1.5">{selectedDept.emoji || "📘"}</span>
                {selectedDept.name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {exams.length} exam{exams.length === 1 ? "" : "s"} — start stored quiz (no AI needed)
              </p>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search exams…"
              className="h-11 rounded-2xl pl-9"
            />
          </div>

          {list.length === 0 ? (
            <p className="rounded-2xl border border-border/60 bg-card px-4 py-12 text-center text-sm text-muted-foreground">
              No exams in this department yet. Admin can add PDF/DOCX and store questions.
            </p>
          ) : (
            <ul className="space-y-3">
              {list.map((exam) => {
                const hasQuiz = Array.isArray(exam.questions) && exam.questions.length > 0;
                return (
                  <li key={exam.id} className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
                    <div className="flex gap-3">
                      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">{exam.title}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {[
                            exam.year != null ? String(exam.year) : null,
                            hasQuiz ? `${exam.questions!.length} practice Qs` : "Quiz coming soon",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {exam.note && (
                          <p className="mt-1 text-[11px] text-muted-foreground">{exam.note}</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {hasQuiz ? (
                            <Button type="button" className="h-9 rounded-xl" onClick={() => startStoredQuiz(exam)}>
                              <ListChecks className="mr-1.5 h-3.5 w-3.5" />
                              Start quiz ({exam.questions!.length} Qs)
                            </Button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              Quiz not ready yet — admin will store questions soon
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-card/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20">
              <ListChecks className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-[15px] font-semibold tracking-tight">Exit Exam Practice</p>
              <p className="text-[11px] text-muted-foreground">Choose department → exam → start quiz</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href="https://t.me/exitexamto"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[#229ED9]/35 bg-[#229ED9]/10 px-3 text-xs font-medium"
            >
              <MessageCircle className="h-4 w-4 text-[#229ED9]" />
              <span className="hidden sm:inline">Support</span>
            </a>
            <Link
              to="/generate"
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 text-xs font-medium hover:bg-muted"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">AI generate</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Select a department
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Admin stores questions from PDFs. You only select department → exam → start quiz.
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search departments or exams…"
            className="h-11 rounded-2xl pl-9"
          />
        </div>

        {filteredDepts.length === 0 ? (
          <p className="rounded-2xl border border-border/60 bg-card px-4 py-12 text-center text-sm text-muted-foreground">
            No departments yet. Add them in{" "}
            <Link to="/admin" className="text-primary underline">
              Admin
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {filteredDepts.map((d) => {
              const n = (d.exams || []).length;
              const withQuiz = (d.exams || []).filter((e) => e.questions && e.questions.length > 0).length;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => openDept(d)}
                  className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3.5 text-left shadow-sm transition hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-2xl leading-none">{d.emoji || "📘"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {n} exam{n === 1 ? "" : "s"}
                      {withQuiz ? ` · ${withQuiz} with quiz` : ""}
                    </span>
                  </span>
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                </button>
              );
            })}
          </div>
        )}

        <p className="pt-2 text-center text-[11px] text-muted-foreground">
          <Link to="/admin" className="underline hover:text-foreground">
            Admin
          </Link>
          {" · "}
          <Link to="/generate" className="underline hover:text-foreground">
            AI exam generator
          </Link>
        </p>
      </main>
    </div>
  );
}
