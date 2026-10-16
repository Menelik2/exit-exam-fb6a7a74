import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { generateExam, generateExamFromDocument, type ExamQuestion } from "@/lib/exam.functions";
import { extractDocumentText } from "@/lib/extract-document";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Sparkles,
  RefreshCw,
  Upload,
  FileText,
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Settings2,
  ListChecks,
  Moon,
  Sun,
  Monitor,
  Share2,
  FileDown,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiKeyPanel, type AiProvider } from "@/components/api-key-panel";
import { exportPdf, exportText, copyShareLink, parseShareCode } from "@/lib/exam-export";
import { recordFinishedAttempt } from "@/lib/exam-history";
import { ProgressAnalytics } from "@/components/progress-analytics";
import { useTheme } from "@/hooks/use-theme";
import { toast } from "sonner";
import {
  MoodleNavButton,
  MoodleQuestionInfo,
  MoodleOption,
  moodleLetter,
  type MoodleNavState,
} from "@/components/moodle-quiz-ui";
import {
  loadWrongQuestions,
  saveWrongQuestions,
  loadSeenQuestions,
  saveSeenQuestions,
  isSimilarQuestion,
  isSimilarToAny,
  isOptionCorrect,
  MAX_SEEN_QUESTIONS,
} from "@/lib/exam-page-helpers";

type Difficulty = "Beginner" | "Intermediate" | "Advanced";
type QuizPhase = "setup" | "attempt" | "summary" | "review";

export function ExamGeneratorPage() {
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Beginner");
  const [numQuestions, setNumQuestions] = useState(5);
  const [numQuestionsText, setNumQuestionsText] = useState("5");
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider>("gemini");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [docName, setDocName] = useState("");
  const [docText, setDocText] = useState("");
  const [docExtracting, setDocExtracting] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [wrongQuestions, setWrongQuestions] = useState<ExamQuestion[]>([]);
  const [phase, setPhase] = useState<QuizPhase>("setup");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(true);
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const [seenQuestions, setSeenQuestions] = useState<string[]>([]);
  const [historyKey, setHistoryKey] = useState(0);
  const [importedQuestions, setImportedQuestions] = useState<ExamQuestion[] | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const { mode: themeMode, cycle: cycleTheme } = useTheme();

  useEffect(() => {
    setWrongQuestions(loadWrongQuestions());
    setSeenQuestions(loadSeenQuestions());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("quiz");
    if (!code) return;
    const parsed = parseShareCode(code);
    if (!parsed?.questions?.length) return;
    setImportedQuestions(parsed.questions.map((q, i) => ({ ...q, question_number: i + 1 })));
    setTopic(parsed.title || "Shared quiz");
    setDifficulty((parsed.difficulty as Difficulty) || "Beginner");
    setPhase("attempt");
    setAnswers({});
    setCurrentIndex(0);
    setFlagged({});
    setSettingsOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("quiz");
    window.history.replaceState({}, "", url.pathname);
    toast.success(`Loaded shared quiz · ${parsed.questions.length} questions`);
  }, []);

  const persistWrong = useCallback((list: ExamQuestion[]) => {
    setWrongQuestions(list);
    saveWrongQuestions(list);
  }, []);

  const docMode = docText.length > 0;
  const generateFn = useServerFn(generateExam);
  const generateDocFn = useServerFn(generateExamFromDocument);

  const mutation = useMutation({
    onMutate: () => {
      setPhase("setup");
      setFlagged({});
      setImportedQuestions(null);
      setConfirmSubmit(false);
      setLastSaved(null);
    },
    mutationFn: async (requestedCount?: number) => {
      const count = Math.min(200, Math.max(1, requestedCount ?? (numQuestions || 1)));
      const avoid = seenQuestions.slice(-60);
      if (docMode) {
        return generateDocFn({
          data: {
            apiKey,
            provider: aiProvider,
            documentName: docName || "Uploaded document",
            documentText: docText,
            difficulty,
            numQuestions: count,
            nonce: `${Date.now()}`,
            avoid,
          },
        });
      }
      return generateFn({
        data: {
          apiKey,
          provider: aiProvider,
          topic: topic.trim(),
          difficulty,
          numQuestions: count,
          nonce: `${Date.now()}`,
          avoid,
        },
      });
    },
    onSuccess: (data) => {
      setAnswers({});
      setCurrentIndex(0);
      setFlagged({});
      setConfirmSubmit(false);
      setLastSaved(null);
      if (data?.questions?.length) {
        setPhase("attempt");
        setSeenQuestions((prev) => {
          const merged = [...prev];
          for (const q of data.questions) {
            const t = (q.question ?? "").trim();
            if (!t || isSimilarToAny(t, merged)) continue;
            merged.push(t);
          }
          const trimmed = merged.slice(-MAX_SEEN_QUESTIONS);
          saveSeenQuestions(trimmed);
          return trimmed;
        });
      }
      if (typeof window !== "undefined" && window.innerWidth < 1024) setSettingsOpen(false);
    },
  });

  const questions: ExamQuestion[] = useMemo(() => {
    const raw = importedQuestions ?? mutation.data?.questions ?? [];
    return raw.map((q, i) => ({ ...q, question_number: i + 1 }));
  }, [importedQuestions, mutation.data?.questions]);

  useEffect(() => {
    if (questions.length === 0) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex >= questions.length) setCurrentIndex(questions.length - 1);
  }, [questions.length, currentIndex]);

  const run = useCallback(() => {
    if (!docMode && !topic.trim()) return;
    let n = parseInt(numQuestionsText, 10);
    if (Number.isNaN(n) || n < 1) n = 1;
    if (n > 200) n = 200;
    setNumQuestions(n);
    setNumQuestionsText(String(n));
    mutation.mutate(n);
  }, [docMode, topic, numQuestionsText, mutation]);

  useEffect(() => {
    if (!autoGenerate) return;
    if (!docMode && !topic.trim()) return;
    if (phase === "attempt" || phase === "summary" || phase === "review") return;
    const t = setTimeout(() => run(), 800);
    return () => clearTimeout(t);
  }, [topic, difficulty, numQuestions, autoGenerate, aiProvider, apiKey, docMode, phase]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setDocError(null);
    setDocExtracting(true);
    try {
      const text = await extractDocumentText(file);
      if (!text || text.length < 20) throw new Error("Couldn't extract readable text from this file.");
      setDocText(text.length > 190000 ? text.slice(0, 190000) : text);
      setDocName(file.name);
    } catch (e) {
      setDocError((e as Error).message || "Failed to read document.");
      setDocText("");
      setDocName("");
    } finally {
      setDocExtracting(false);
    }
  };

  const selectAnswer = (q: ExamQuestion, opt: string) => {
    if (phase !== "attempt") return;
    setAnswers((a) => ({ ...a, [q.question_number]: opt }));
    setLastSaved(new Date());
  };

  const finishAttempt = () => {
    setPhase("summary");
    setConfirmSubmit(false);
  };
  const returnToAttempt = () => {
    setPhase("attempt");
    setConfirmSubmit(false);
  };

  const submitAllAndFinish = () => {
    const sessionWrong: ExamQuestion[] = [];
    for (const q of questions) {
      const selected = answers[q.question_number];
      if (!selected || !isOptionCorrect(q, selected)) sessionWrong.push(q);
    }
    if (sessionWrong.length > 0) {
      const merged = [...wrongQuestions];
      for (const q of sessionWrong) {
        if (!merged.some((w) => isSimilarQuestion(w.question, q.question))) merged.push(q);
      }
      persistWrong(merged.map((q, i) => ({ ...q, question_number: i + 1 })));
    }
    const titleForHistory = docMode ? docName || "Document quiz" : topic.trim() || "Generated quiz";
    recordFinishedAttempt({
      questions,
      answers,
      title: titleForHistory,
      difficulty,
      topic: topic.trim() || undefined,
      docName: docMode ? docName || undefined : undefined,
      isOptionCorrect,
    });
    setHistoryKey((k) => k + 1);
    setPhase("review");
    setConfirmSubmit(false);
    setCurrentIndex(0);
    toast.success("Quiz submitted");
  };

  const correctCount = useMemo(
    () =>
      questions.filter(
        (q) =>
          answers[q.question_number] != null &&
          isOptionCorrect(q, answers[q.question_number]),
      ).length,
    [questions, answers],
  );
  const answeredCount = questions.filter((q) => answers[q.question_number] != null).length;
  const notAnsweredCount = questions.length - answeredCount;
  const flaggedCount = questions.filter((q) => flagged[q.question_number]).length;
  const currentQuestion = questions[currentIndex];
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= questions.length - 1;
  const hasActiveQuiz = (phase === "attempt" || phase === "review") && !!currentQuestion;
  const showSummary = phase === "summary" && questions.length > 0;
  const quizTitle = docMode ? docName || "Document quiz" : topic.trim() || "Generated quiz";

  useEffect(() => {
    if (!hasActiveQuiz || questions.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setCurrentIndex((i) => Math.min(questions.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasActiveQuiz, questions.length]);

  const navState = (q: ExamQuestion): MoodleNavState => {
    const answered = answers[q.question_number] != null;
    if (phase === "review") {
      if (answered && isOptionCorrect(q, answers[q.question_number])) return "correct";
      return "incorrect";
    }
    return answered ? "answered" : "todo";
  };

  return (
    <div className="min-h-dvh w-full bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/80 bg-card/85 pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-card/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <ListChecks className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight sm:text-[15px]">
                {hasActiveQuiz || showSummary || phase === "review" ? quizTitle : "Exit Exam Practice"}
              </p>
              <p className="truncate text-[11px] leading-tight text-muted-foreground">
                {phase === "attempt"
                  ? `${difficulty} · Q${currentIndex + 1}/${questions.length}`
                  : phase === "summary"
                    ? "Summary of attempt"
                    : phase === "review"
                      ? `Review · ${correctCount}/{questions.length}`
                      : "Moodle-style quiz"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {phase === "attempt" && (
              <span className="hidden rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium tabular-nums sm:inline">
                {answeredCount}/{questions.length}
              </span>
            )}
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card transition active:scale-[0.97] hover:bg-muted sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3 sm:text-xs sm:font-medium"
              onClick={cycleTheme}
              aria-label={`Theme: ${themeMode}`}
            >
              {themeMode === "dark" ? (
                <Moon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              ) : themeMode === "light" ? (
                <Sun className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              ) : (
                <Monitor className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              )}
              <span className="hidden sm:inline">
                {themeMode === "dark" ? "Dark" : themeMode === "light" ? "Light" : "Auto"}
              </span>
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium transition active:scale-[0.97] hover:bg-muted sm:h-9"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-expanded={settingsOpen}
            >
              <Settings2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              <span>{settingsOpen ? "Hide" : "Setup"}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-6">
        {settingsOpen && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm lg:mb-7">
            <div className="border-b border-border/80 bg-muted/30 px-4 py-3.5 sm:px-5 lg:px-6">
              <h2 className="text-sm font-semibold tracking-tight">Quiz setup</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Moodle deferred feedback — answer all, then submit.
              </p>
            </div>
            <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-2 lg:gap-8 lg:p-6">
              <div className="space-y-3.5">
                <ApiKeyPanel
                  onKeyChange={(k, p) => {
                    setApiKey(k);
                    setAiProvider(p);
                  }}
                />
                <div className="space-y-2">
                  <Label htmlFor="topic">Topic</Label>
                  <Input
                    id="topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Thermodynamics"
                    className="h-11 rounded-xl text-base sm:h-10 sm:text-sm"
                    disabled={docMode}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Difficulty</Label>
                    <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
                      <SelectTrigger className="h-11 rounded-xl sm:h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Beginner">Beginner</SelectItem>
                        <SelectItem value="Intermediate">Intermediate</SelectItem>
                        <SelectItem value="Advanced">Advanced</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="nq">Questions</Label>
                    <Input
                      id="nq"
                      value={numQuestionsText}
                      onChange={(e) => setNumQuestionsText(e.target.value)}
                      className="h-11 rounded-xl text-base sm:h-10 sm:text-sm"
                      inputMode="numeric"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                  <Label htmlFor="auto" className="text-sm">
                    Auto-generate
                  </Label>
                  <Switch id="auto" checked={autoGenerate} onCheckedChange={setAutoGenerate} />
                </div>
                <div className="space-y-2">
                  <Label>Or upload a document</Label>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-border px-3 text-xs hover:bg-muted">
                      <Upload className="h-3.5 w-3.5" />
                      {docExtracting ? "Reading…" : "Upload PDF / DOCX / TXT"}
                      <input
                        type="file"
                        className="sr-only"
                        accept=".pdf,.docx,.txt,.md"
                        disabled={docExtracting}
                        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    {docName && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-10 rounded-xl text-xs"
                        onClick={() => {
                          setDocText("");
                          setDocName("");
                          setDocError(null);
                        }}
                      >
                        <X className="mr-1 h-3.5 w-3.5" /> Clear
                      </Button>
                    )}
                  </div>
                  {docName && (
                    <p className="text-[11px] text-muted-foreground">
                      <FileText className="mr-1 inline h-3 w-3" />
                      {docName}
                    </p>
                  )}
                  {docError && <p className="text-xs text-destructive">{docError}</p>}
                </div>
                <Button
                  type="button"
                  className="h-12 w-full rounded-xl text-[15px] font-semibold shadow-sm sm:h-11"
                  disabled={mutation.isPending || (!docMode && !topic.trim())}
                  onClick={run}
                >
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                    </>
                  ) : questions.length > 0 ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" /> Start new attempt
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" /> Attempt quiz now
                    </>
                  )}
                </Button>
                {questions.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-xl text-[11px]"
                      onClick={() => exportPdf(questions, { title: quizTitle, difficulty })}
                    >
                      <Download className="mr-1 h-3.5 w-3.5" /> PDF
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-xl text-[11px]"
                      onClick={() => exportText(questions, { title: quizTitle, difficulty })}
                    >
                      <FileDown className="mr-1 h-3.5 w-3.5" /> Text
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-xl text-[11px]"
                      onClick={async () => {
                        const res = await copyShareLink(questions, { title: quizTitle, difficulty });
                        toast.success(res.ok ? "Copied" : "Failed");
                      }}
                    >
                      <Share2 className="mr-1 h-3.5 w-3.5" /> Share
                    </Button>
                  </div>
                )}
                {wrongQuestions.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                    <p className="font-medium text-amber-800 dark:text-amber-300">
                      {wrongQuestions.length} incorrect saved
                    </p>
                    <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => persistWrong([])}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear
                    </Button>
                  </div>
                )}
                {mutation.isError && (
                  <p className="text-xs text-destructive">
                    {(mutation.error as Error)?.message || "Failed"}
                  </p>
                )}
              </div>
              <ProgressAnalytics refreshKey={historyKey} />
            </div>
          </section>
        )}

        {mutation.isPending && (
          <div className="flex flex-col items-center gap-3 py-16 sm:py-24" role="status">
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
            <p className="text-sm font-medium">Generating questions…</p>
            <p className="text-xs text-muted-foreground">This usually takes a few seconds</p>
          </div>
        )}

        {!mutation.isPending && questions.length === 0 && phase === "setup" && (
          <div className="rounded-2xl border border-dashed border-border/70 bg-card/60 px-4 py-14 text-center sm:py-20">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ListChecks className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm font-semibold tracking-tight">No active attempt</p>
            <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
              Open Setup, choose a topic, then tap Attempt quiz now.
            </p>
          </div>
        )}

        {hasActiveQuiz && currentQuestion && (
          <div className="grid gap-4 md:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)] xl:gap-6">
            <div className="min-w-0 space-y-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0">
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm dark:border-slate-600">
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:gap-5 sm:p-5 md:p-6">
                  <MoodleQuestionInfo
                    number={currentQuestion.question_number}
                    status={
                      phase === "review"
                        ? answers[currentQuestion.question_number] != null &&
                          isOptionCorrect(currentQuestion, answers[currentQuestion.question_number])
                          ? "Correct"
                          : "Incorrect"
                        : answers[currentQuestion.question_number] != null
                          ? "Answer saved"
                          : "Not yet answered"
                    }
                    flagged={!!flagged[currentQuestion.question_number]}
                    showFlag={phase === "attempt"}
                    onToggleFlag={
                      phase === "attempt"
                        ? () =>
                            setFlagged((f) => ({
                              ...f,
                              [currentQuestion.question_number]: !f[currentQuestion.question_number],
                            }))
                        : undefined
                    }
                    reviewMarks={
                      phase === "review"
                        ? answers[currentQuestion.question_number] != null &&
                          isOptionCorrect(currentQuestion, answers[currentQuestion.question_number])
                          ? "1.00 / 1.00"
                          : "0.00 / 1.00"
                        : undefined
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-relaxed text-foreground sm:text-base">
                      {currentQuestion.question}
                    </p>
                    <fieldset className="mt-4 space-y-2.5" disabled={phase === "review"}>
                      <legend className="sr-only">Answers</legend>
                      {currentQuestion.options.map((opt, oi) => {
                        const selected = answers[currentQuestion.question_number] === opt;
                        const inReview = phase === "review";
                        const isCorrect = isOptionCorrect(currentQuestion, opt);
                        let reviewState: "correct" | "incorrect" | "neutral" | undefined;
                        if (inReview) {
                          if (isCorrect) reviewState = "correct";
                          else if (selected) reviewState = "incorrect";
                          else reviewState = "neutral";
                        }
                        return (
                          <MoodleOption
                            key={opt}
                            label={opt}
                            letter={moodleLetter(oi)}
                            selected={selected}
                            disabled={inReview}
                            onSelect={() => selectAnswer(currentQuestion, opt)}
                            reviewState={reviewState}
                          />
                        );
                      })}
                    </fieldset>
                    {phase === "review" && currentQuestion.explanation && (
                      <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                        <p className="font-semibold">Feedback</p>
                        <p className="mt-1 text-muted-foreground">{currentQuestion.explanation}</p>
                        <p className="mt-2 text-xs">
                          The correct answer is: <strong>{currentQuestion.correct_answer}</strong>
                        </p>
                      </div>
                    )}
                    {phase === "attempt" && lastSaved && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Last saved {lastSaved.toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="hidden gap-2 lg:flex">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 rounded-xl"
                  disabled={isFirst}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="mr-1.5 h-4 w-4" /> Previous
                </Button>
                {!isLast ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 flex-1 rounded-xl"
                    onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                  >
                    Next <ChevronRight className="ml-1.5 h-4 w-4" />
                  </Button>
                ) : phase === "attempt" ? (
                  <Button type="button" className="h-11 flex-1 rounded-xl font-semibold" onClick={finishAttempt}>
                    Finish attempt
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 flex-1 rounded-xl"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Done
                  </Button>
                )}
              </div>
            </div>

            <aside className="order-first lg:order-none lg:sticky lg:top-[4.75rem] lg:self-start">
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm dark:border-slate-600">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between border-b border-border/80 bg-muted/40 px-3.5 py-2.5 text-left text-sm font-semibold"
                  onClick={() => setNavOpen((o) => !o)}
                >
                  <span>Quiz navigation</span>
                  <span className="text-xs font-normal text-muted-foreground lg:hidden">
                    {navOpen ? "Hide" : "Show"}
                  </span>
                </button>
                <div className={cn("p-3 sm:p-3.5", navOpen ? "block" : "hidden lg:block")}>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2" role="navigation" aria-label="Quiz navigation">
                    {questions.map((q, idx) => (
                      <MoodleNavButton
                        key={q.question_number}
                        number={idx + 1}
                        state={navState(q)}
                        flagged={!!flagged[q.question_number]}
                        isCurrent={idx === currentIndex}
                        onClick={() => setCurrentIndex(idx)}
                      />
                    ))}
                  </div>
                  {phase === "attempt" && (
                    <Button type="button" className="mt-3 h-9 w-full rounded-lg text-xs" onClick={finishAttempt}>
                      Finish attempt…
                    </Button>
                  )}
                  {phase === "review" && (
                    <p className="mt-3 text-center text-xs text-muted-foreground">
                      Score:{" "}
                      <strong>
                        {correctCount}/{questions.length}
                      </strong>
                    </p>
                  )}
                </div>
              </div>
            </aside>

            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/80 bg-card/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] backdrop-blur-xl supports-[backdrop-filter]:bg-card/80 dark:shadow-[0_-8px_24px_rgba(0,0,0,0.35)] lg:hidden">
              <div className="mx-auto flex max-w-7xl gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 flex-1 rounded-xl text-sm font-medium active:scale-[0.98]"
                  disabled={isFirst}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" /> Prev
                </Button>
                {!isLast ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 flex-1 rounded-xl text-sm font-medium active:scale-[0.98]"
                    onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                  >
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : phase === "attempt" ? (
                  <Button
                    type="button"
                    className="h-12 flex-1 rounded-xl text-sm font-semibold active:scale-[0.98]"
                    onClick={finishAttempt}
                  >
                    Finish attempt
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 flex-1 rounded-xl text-sm font-medium active:scale-[0.98]"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Done
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { ExamGeneratorPage };
