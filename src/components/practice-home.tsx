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
    <div className="relative min-h-dvh overflow-x-hidden bg-[#f8f9fb] text-foreground dark:bg-background">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-blue-400/20 blur-3xl" />
        <div className="absolute -right-16 top-32 h-64 w-64 rounded-full bg-indigo-400/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-48 w-48 rounded-full bg-sky-300/10 blur-3xl" />
      </div>

      <header className="sticky top-0 z-50 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-6xl px-3 pt-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/70 px-3 py-2.5 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-border/50 dark:bg-card/80 sm:px-5 sm:py-3">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30 sm:h-11 sm:w-11">
                <ListChecks className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight sm:text-base">
                  Exit Exam
                </p>
                <p className="truncate text-[10px] text-muted-foreground sm:text-xs">
                  Practice platform
                </p>
              </div>
            </div>
            <nav className="flex shrink-0 items-center gap-2" aria-label="Main">
              <Link
                to="/generate"
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-600 to-blue-500 px-3.5 text-xs font-semibold text-white shadow-md shadow-blue-600/25 transition hover:from-blue-700 hover:to-blue-600 active:scale-[0.97] sm:h-11 sm:px-5 sm:text-sm"
              >
                <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="max-[340px]:hidden">Exam Generator</span>
                <span className="min-[341px]:hidden">Generate</span>
              </Link>
              <a
                href="https://t.me/exitexamto"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-[#229ED9] transition hover:bg-sky-50 active:scale-[0.97] dark:border-border dark:bg-card sm:h-11 sm:w-auto sm:gap-1.5 sm:px-4"
                aria-label="Telegram help"
              >
                <MessageCircle className="h-4 w-4" />
                <span className="hidden text-sm font-medium text-slate-700 dark:text-foreground sm:inline">
                  Help
                </span>
              </a>
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:pt-10 lg:px-8 lg:pt-12">
        <section className="mb-6 flex flex-col gap-6 sm:mb-10 lg:mb-12 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <div className="min-w-0 max-w-xl">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/60 bg-blue-50/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              Ready to practice
            </div>
            <h1 className="mt-3 text-[1.65rem] font-semibold leading-[1.15] tracking-tight text-slate-900 dark:text-foreground sm:mt-4 sm:text-3xl lg:text-4xl">
              Choose your department
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-slate-500 dark:text-muted-foreground sm:mt-3 sm:text-[15px] lg:text-base">
              Open an exam and start a practice quiz instantly. Stored questions — no AI wait.
            </p>
          </div>
          <div className="relative w-full max-w-md shrink-0 lg:w-80 xl:w-96">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search departments or exams…"
              className="h-12 rounded-2xl border-slate-200/80 bg-white/90 pl-11 text-base shadow-sm shadow-slate-900/5 placeholder:text-slate-400 focus-visible:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-500/20 dark:border-border dark:bg-card sm:text-sm"
              aria-label="Search departments or exams"
            />
          </div>
        </section>

        {filteredDepts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white/50 px-6 py-16 text-center dark:border-border dark:bg-card/40">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-muted">
              📚
            </span>
            <p className="mt-4 text-sm font-semibold text-slate-800 dark:text-foreground">
              No departments yet
            </p>
            <p className="mt-1 text-xs text-slate-500">Check back soon for practice exams.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:gap-5">
            {filteredDepts.map((d) => {
              const n = (d.exams || []).length;
              const withQuiz = (d.exams || []).filter(
                (e) => e.questions && e.questions.length > 0,
              ).length;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => openDept(d)}
                    className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-slate-200/70 bg-white px-3.5 py-3 text-left shadow-[0_1px_8px_rgba(15,23,42,0.04)] transition duration-200 hover:border-blue-200 hover:shadow-[0_8px_24px_rgba(37,99,235,0.1)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-border dark:bg-card lg:min-h-[160px] lg:flex-col lg:items-start lg:rounded-3xl lg:p-6 lg:hover:-translate-y-0.5"
                  >
                    <div className="flex w-full items-start gap-3 lg:justify-between">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 text-xl shadow-inner dark:from-muted dark:to-muted/60 lg:h-12 lg:w-12 lg:rounded-2xl lg:text-2xl">
                        {d.emoji || "📘"}
                      </span>
                      <span className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-400 transition group-hover:bg-blue-50 group-hover:text-blue-600 dark:bg-muted lg:ml-0 lg:h-8 lg:w-8">
                        <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 lg:h-4 lg:w-4" />
                      </span>
                    </div>
                    <span className="min-w-0 flex-1 lg:mt-4 lg:flex-none lg:w-full">
                      <span className="block truncate text-[14px] font-semibold tracking-tight text-slate-900 dark:text-foreground lg:text-[16px]">
                        {d.name}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1 lg:mt-2.5 lg:gap-1.5">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-muted dark:text-muted-foreground lg:px-2.5 lg:text-[11px]">
                          {n === 0 ? "No exams" : `${n} exam${n === 1 ? "" : "s"}`}
                        </span>
                        {withQuiz > 0 && (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 lg:px-2.5 lg:text-[11px]">
                            {withQuiz} ready
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <a
          href="https://t.me/exitexamto"
          target="_blank"
          rel="noreferrer"
          className="mt-8 flex max-w-xl items-center gap-3.5 rounded-2xl border border-sky-200/80 bg-sky-50/90 px-4 py-3.5 shadow-sm transition hover:bg-sky-100/90 active:scale-[0.99] dark:border-sky-500/25 dark:bg-sky-500/10 sm:mt-10 lg:mt-12"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#229ED9] text-white shadow-md shadow-sky-500/30">
            <MessageCircle className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold tracking-tight text-slate-900 dark:text-foreground">
              Join Telegram for support
            </span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-muted-foreground">
              @exitexamto — help, tips & updates
            </span>
          </span>
        </a>
      </main>
    </div>
  );
}
