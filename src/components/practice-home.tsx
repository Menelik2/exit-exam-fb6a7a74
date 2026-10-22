import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { apiGetCatalog } from "@/lib/admin-api";
import type { Catalog, Department, ExamEntry, StoredQuestion } from "@/components/admin-types";
import type { ExamQuestion } from "@/lib/exam.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  ChevronRight,
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
        <div
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-500/[0.05] via-background to-background"
          aria-hidden
        />
        <header className="sticky top-0 z-50 border-b border-border/50 bg-card/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl supports-[backdrop-filter]:bg-card/70">
          <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={backToDepts}
              className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border border-border/70 bg-card transition hover:bg-muted active:scale-[0.97]"
              aria-label="Back to departments"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-semibold tracking-tight">
                <span className="mr-1.5">{selectedDept.emoji || "📘"}</span>
                {selectedDept.name}
              </p>
              <p className="text-[11px] text-muted-foreground sm:text-xs">
                {exams.length} exam{exams.length === 1 ? "" : "s"} available
              </p>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl space-y-4 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-6 lg:px-8">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search exams…"
              className="h-12 rounded-2xl border-border/70 bg-card pl-10 text-base shadow-sm sm:h-11 sm:text-sm"
              aria-label="Search exams"
            />
          </div>

          {list.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border/80 bg-card/60 px-6 py-14 text-center">
              <p className="text-sm font-medium">No exams found</p>
              <p className="mt-1 text-xs text-muted-foreground">Try another search or check back later.</p>
            </div>
          ) : (
            <ul className="space-y-3 sm:space-y-3.5">
              {list.map((exam) => {
                const hasQuiz = Array.isArray(exam.questions) && exam.questions.length > 0;
                return (
                  <li
                    key={exam.id}
                    className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition hover:border-blue-500/25 hover:shadow-md sm:p-5"
                  >
                    <div className="flex gap-3.5">
                      <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
                        <FileText className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold leading-snug tracking-tight">{exam.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[
                            exam.year != null ? String(exam.year) : null,
                            hasQuiz ? `${exam.questions!.length} questions ready` : "Quiz coming soon",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {exam.note && (
                          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{exam.note}</p>
                        )}
                        <div className="mt-3.5">
                          {hasQuiz ? (
                            <Button
                              type="button"
                              className="h-11 min-h-[44px] w-full rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 sm:w-auto sm:px-5"
                              onClick={() => startStoredQuiz(exam)}
                            >
                              <ListChecks className="mr-1.5 h-4 w-4" />
                              Start quiz ({exam.questions!.length} Qs)
                            </Button>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                              Quiz not ready yet
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
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-500/[0.06] via-background to-background"
        aria-hidden
      />

      <header className="sticky top-0 z-50 border-b border-border/50 bg-card/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl supports-[backdrop-filter]:bg-card/70">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-1 ring-black/5">
              <ListChecks className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-[15px] font-semibold tracking-tight sm:text-base">
                Exit Exam Practice
              </p>
              <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
                Department → exam → quiz
              </p>
            </div>
          </div>
          <nav className="flex shrink-0 items-center gap-2" aria-label="Main">
            <Link
              to="/generate"
              className="inline-flex h-11 min-h-[44px] items-center gap-1.5 rounded-full bg-blue-600 px-3.5 text-xs font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 active:scale-[0.97] sm:px-4 sm:text-sm"
            >
              <Sparkles className="h-4 w-4" />
              <span className="max-[360px]:hidden">Exam Generator</span>
              <span className="min-[361px]:hidden">Generate</span>
            </Link>
            <a
              href="https://t.me/exitexamto"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 min-h-[44px] w-11 items-center justify-center rounded-full border border-[#229ED9]/35 bg-[#229ED9]/10 text-[#229ED9] transition hover:bg-[#229ED9]/18 active:scale-[0.97] sm:w-auto sm:gap-1.5 sm:px-3.5"
              aria-label="Telegram help"
            >
              <MessageCircle className="h-4 w-4" />
              <span className="hidden sm:inline text-xs font-medium text-foreground">Help</span>
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:pt-8 lg:px-8">
        <section className="mb-6 sm:mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600/90 sm:text-xs">
            Practice
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Select a department
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
            Pick your field, open an exam, and start the stored practice quiz — no setup needed.
          </p>
        </section>

        <div className="relative mb-5 sm:mb-6">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search departments or exams…"
            className="h-12 rounded-2xl border-border/70 bg-card pl-10 text-base shadow-sm sm:h-11 sm:text-sm"
            aria-label="Search departments or exams"
          />
        </div>

        {filteredDepts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border/80 bg-card/60 px-6 py-16 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-xl">
              📚
            </span>
            <p className="mt-4 text-sm font-medium text-foreground">No departments yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Check back soon for practice exams.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
            {filteredDepts.map((d) => {
              const n = (d.exams || []).length;
              const withQuiz = (d.exams || []).filter((e) => e.questions && e.questions.length > 0).length;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => openDept(d)}
                    className="group flex w-full min-h-[72px] items-center gap-3.5 rounded-2xl border border-border/60 bg-card p-4 text-left shadow-sm transition duration-150 hover:border-blue-500/30 hover:bg-blue-500/[0.03] hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 sm:p-5"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-muted/80 text-2xl ring-1 ring-border/40 transition group-hover:bg-blue-500/10">
                      {d.emoji || "📘"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold tracking-tight text-foreground">
                        {d.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {n === 0
                          ? "No exams yet"
                          : `${n} exam${n === 1 ? "" : "s"}${withQuiz ? ` · ${withQuiz} ready` : ""}`}
                      </span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
