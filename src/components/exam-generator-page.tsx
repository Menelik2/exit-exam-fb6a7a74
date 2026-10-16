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
  CheckCircle2,
  XCircle,
  Sparkles,
  RefreshCw,
  Upload,
  FileText,
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Trash2,
  RotateCcw,
  Settings2,
  Flag,
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

type Difficulty = "Beginner" | "Intermediate" | "Advanced";
/** Moodle-style phases: attempt (deferred feedback) → summary → review */
type QuizPhase = "setup" | "attempt" | "summary" | "review";

const WRONG_STORAGE_KEY = "exam-generator-wrong-questions";
const SEEN_STORAGE_KEY = "exam-generator-seen-questions";
const MAX_SEEN_QUESTIONS = 400;

function loadWrongQuestions(): ExamQuestion[] {
  try {
    const raw = localStorage.getItem(WRONG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWrongQuestions(list: ExamQuestion[]) {
  try {
    localStorage.setItem(WRONG_STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

function loadSeenQuestions(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function saveSeenQuestions(list: string[]) {
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(list.slice(-MAX_SEEN_QUESTIONS)));
  } catch {}
}

function normalizeQuestionText(q: string) {
  return q
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionTokens(q: string): Set<string> {
  return new Set(normalizeQuestionText(q).split(" ").filter((w) => w.length > 2));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function isSimilarQuestion(a: string, b: string, threshold = 0.72): boolean {
  const na = normalizeQuestionText(a);
  const nb = normalizeQuestionText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.65) return true;
  return jaccardSimilarity(questionTokens(na), questionTokens(nb)) >= threshold;
}

function isSimilarToAny(q: string, list: string[], threshold = 0.72): boolean {
  return list.some((item) => isSimilarQuestion(q, item, threshold));
}

function isOptionCorrect(q: ExamQuestion, opt: string) {
  if (opt === q.correct_answer) return true;
  if (opt.trim().toLowerCase() === (q.correct_answer ?? "").trim().toLowerCase()) return true;
  return false;
}

/** Moodle-style nav cell: number with optional red flag triangle + state coloring */
function MoodleNavCell({
  number,
  state,
  flagged,
  isCurrent,
  onClick,
  disabled,
}: {
  number: number;
  state: "todo" | "answered" | "correct" | "incorrect";
  flagged: boolean;
  isCurrent: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`Question ${number}${flagged ? ", flagged" : ""}, ${state}${isCurrent ? ", current" : ""}`}
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "relative flex h-9 w-full items-center justify-center overflow-hidden rounded-md border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-10 lg:text-sm",
        isCurrent && "ring-2 ring-foreground/40 border-foreground",
        !isCurrent && state === "todo" && "border-border bg-background hover:bg-muted",
        !isCurrent && state === "answered" && "border-border bg-muted text-foreground",
        !isCurrent && state === "correct" && "border-emerald-700 bg-emerald-600 text-white",
        !isCurrent && state === "incorrect" && "border-red-700 bg-red-600 text-white",
        isCurrent && state === "todo" && "bg-background",
        isCurrent && state === "answered" && "bg-muted",
        isCurrent && state === "correct" && "bg-emerald-600 text-white",
        isCurrent && state === "incorrect" && "bg-red-600 text-white",
      )}
    >
      {state === "answered" && !isCurrent && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-muted-foreground/15" aria-hidden />
      )}
      <span className="relative z-10">{number}</span>
      {flagged && (
        <span
          className="absolute right-0 top-0 h-0 w-0 border-l-[10px] border-t-[10px] border-l-transparent border-t-red-600"
          aria-hidden
        />
      )}
    </button>
  );
}

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
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [importedQuestions, setImportedQuestions] = useState<ExamQuestion[] | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
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
      if (data?.questions?.length) {
        setPhase("attempt");
        setSeenQuestions((prev) => {
          const merged = [...prev];
          for (const q of data.questions) {
            const t = (q.question ?? "").trim();
            if (!t) continue;
            if (isSimilarToAny(t, merged)) continue;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const clearSeenHistory = () => {
    setSeenQuestions([]);
    saveSeenQuestions([]);
  };

  const clearAllWrong = () => {
    persistWrong([]);
  };

  /** Moodle: select answer during attempt — no immediate feedback */
  const selectAnswer = (q: ExamQuestion, opt: string) => {
    if (phase !== "attempt") return;
    setAnswers((a) => ({ ...a, [q.question_number]: opt }));
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
      if (!selected || !isOptionCorrect(q, selected)) {
        sessionWrong.push(q);
      }
    }
    if (sessionWrong.length > 0) {
      const merged = [...wrongQuestions];
      for (const q of sessionWrong) {
        const already = merged.some((w) => isSimilarQuestion(w.question, q.question));
        if (!already) merged.push(q);
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
        (q) => answers[q.question_number] != null && isOptionCorrect(q, answers[q.question_number]),
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
  const showReviewResults = phase === "review" && questions.length > 0;

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

  const quizTitle = docMode ? docName || "Document quiz" : topic.trim() || "Generated quiz";

  const navState = (q: ExamQuestion, idx: number): "todo" | "answered" | "correct" | "incorrect" => {
    const qNum = q.question_number;
    const answered = answers[qNum] != null;
    if (phase === "review") {
      if (answered && isOptionCorrect(q, answers[qNum])) return "correct";
      return "incorrect";
    }
    if (answered) return "answered";
    return "todo";
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 text-foreground shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-card/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3 sm:px-5 lg:px-8 lg:py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
              <ListChecks className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight sm:text-base lg:text-[17px]">
                {hasActiveQuiz || showSummary || showReviewResults ? quizTitle : "Exit Exam Practice"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {phase === "attempt"
                  ? `${difficulty} · Question ${currentIndex + 1} of ${questions.length} · Deferred feedback`
                  : phase === "summary"
                    ? "Summary of attempt"
                    : phase === "review"
                      ? `Review · Score ${correctCount}/${questions.length}`
                      : "Moodle-style quiz practice"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {phase === "attempt" && (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                  Answered {answeredCount}/{questions.length}
                </span>
              </div>
            )}
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={cycleTheme}
              aria-label={`Theme: ${themeMode}. Click to change.`}
              title={`Theme: ${themeMode}`}
            >
              {themeMode === "dark" ? (
                <Moon className="h-3.5 w-3.5" />
              ) : themeMode === "light" ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Monitor className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-expanded={settingsOpen}
              aria-controls="quiz-setup-panel"
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Setup</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
        {settingsOpen && (
          <section
            id="quiz-setup-panel"
            className="mb-4 overflow-hidden rounded-2xl border border-border bg-card/90 shadow-sm ring-1 ring-foreground/5 lg:mb-6"
          >
            <div className="border-b border-border bg-muted/40 px-4 py-3 lg:px-6 lg:py-3.5">
              <h2 className="text-sm font-semibold tracking-tight lg:text-base">Quiz setup</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Moodle-style deferred feedback: answer all questions, then submit for grading.
              </p>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-2 lg:gap-8 lg:p-6">
              <div className="space-y-3">
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
                    placeholder="e.g. Thermodynamics, Civil Procedure"
                    className="rounded-xl"
                    disabled={docMode}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Difficulty</Label>
                    <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
                      <SelectTrigger className="rounded-xl">
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
                      className="rounded-xl"
                      inputMode="numeric"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                  <Label htmlFor="auto" className="text-sm">
                    Auto-generate
                  </Label>
                  <Switch id="auto" checked={autoGenerate} onCheckedChange={setAutoGenerate} />
                </div>
                <div className="space-y-2">
                  <Label>Or upload a document</Label>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-medium hover:bg-muted">
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
                        className="h-9 rounded-xl text-xs"
                        onClick={() => {
                          setDocText("");
                          setDocName("");
                          setDocError(null);
                        }}
                      >
                        <X className="mr-1 h-3.5 w-3.5" /> Clear doc
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
                  className="h-10 w-full rounded-xl"
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
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Export
                    </p>
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
                          toast.success(
                            res.ok
                              ? res.mode === "url"
                                ? "Share link copied"
                                : "Share code copied"
                              : "Copy failed",
                          );
                          setShareMsg(res.ok ? "Copied" : "Failed");
                          setTimeout(() => setShareMsg(null), 3000);
                        }}
                      >
                        <Share2 className="mr-1 h-3.5 w-3.5" /> Share
                      </Button>
                    </div>
                    {shareMsg && <p className="text-[11px] text-primary">{shareMsg}</p>}
                  </div>
                )}
                {seenQuestions.length > 0 && (
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>{seenQuestions.length} past questions remembered</span>
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={clearSeenHistory}>
                      Clear history
                    </Button>
                  </div>
                )}
                {wrongQuestions.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                    <p className="font-medium text-amber-800 dark:text-amber-300">
                      {wrongQuestions.length} incorrect saved for practice
                    </p>
                    <Button type="button" size="sm" variant="outline" className="mt-2 rounded-lg" onClick={clearAllWrong}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear
                    </Button>
                  </div>
                )}
                {mutation.isError && (
                  <p className="text-xs text-destructive">
                    {(mutation.error as Error)?.message || "Generation failed"}
                  </p>
                )}
              </div>
              <div className="space-y-3">
                <ProgressAnalytics refreshKey={historyKey} />
              </div>
            </div>
          </section>
        )}

        {mutation.isPending && (
          <div className="flex flex-col items-center justify-center gap-3 py-20" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Generating questions…</p>
          </div>
        )}

        {showSummary && (
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h2 className="text-lg font-semibold tracking-tight">Summary of attempt</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Review your answers before submitting. You can return to the attempt to change answers.
              </p>
              <div className="mt-4 overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                      <th className="px-3 py-2">Question</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map((q, idx) => {
                      const answered = answers[q.question_number] != null;
                      const isFlagged = !!flagged[q.question_number];
                      return (
                        <tr key={q.question_number} className="border-b border-border last:border-0">
                          <td className="px-3 py-2.5 font-medium">
                            {q.question_number}
                            {isFlagged && (
                              <span className="ml-1.5 inline-block h-0 w-0 border-l-[8px] border-t-[8px] border-l-transparent border-t-red-600 align-middle" title="Flagged" />
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {answered ? (
                              <span className="text-muted-foreground">Answer saved</span>
                            ) : (
                              <span className="font-medium text-amber-700 dark:text-amber-400">Not yet answered</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              type="button"
                              className="text-xs font-medium text-primary hover:underline"
                              onClick={() => {
                                setCurrentIndex(idx);
                                setPhase("attempt");
                              }}
                            >
                              {answered ? "Edit" : "Answer"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(notAnsweredCount > 0 || flaggedCount > 0) && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    {notAnsweredCount > 0 && (
                      <span>{notAnsweredCount} question{notAnsweredCount === 1 ? "" : "s"} not yet answered. </span>
                    )}
                    {flaggedCount > 0 && <span>{flaggedCount} flagged for review.</span>}
                  </p>
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="rounded-xl" onClick={returnToAttempt}>
                  Return to attempt
                </Button>
                {!confirmSubmit ? (
                  <Button type="button" className="rounded-xl" onClick={() => setConfirmSubmit(true)}>
                    Submit all and finish
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2">
                    <p className="text-sm text-destructive">Once submitted, you can no longer change answers.</p>
                    <Button type="button" variant="destructive" size="sm" className="rounded-lg" onClick={submitAllAndFinish}>
                      Confirm submit
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmSubmit(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showReviewResults && !hasActiveQuiz && (
          <div className="mb-4 rounded-2xl border border-border bg-card p-6 text-center shadow-sm lg:mx-auto lg:max-w-2xl">
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-2 text-lg font-semibold">Attempt finished</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Score: <strong className="text-foreground">{correctCount}/{questions.length}</strong> ·{" "}
              {Math.round((correctCount / Math.max(questions.length, 1)) * 100)}%
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button type="button" variant="outline" className="rounded-xl text-xs" onClick={() => { setPhase("review"); setCurrentIndex(0); }}>
                Review questions
              </Button>
              <Button type="button" variant="outline" className="rounded-xl text-xs" onClick={() => exportPdf(questions, { title: quizTitle, difficulty })}>
                <Download className="mr-1 h-3.5 w-3.5" /> PDF
              </Button>
              <Button type="button" className="rounded-xl text-xs" onClick={() => setSettingsOpen(true)}>
                New quiz
              </Button>
            </div>
          </div>
        )}

        {!mutation.isPending && questions.length === 0 && phase === "setup" && (
          <div className="rounded-2xl border border-dashed border-border bg-card/70 py-16 text-center shadow-sm">
            <ListChecks className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-3 text-sm font-medium">No active attempt</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open Setup, choose a topic, then click Attempt quiz now.
            </p>
          </div>
        )}

        {hasActiveQuiz && currentQuestion && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-7">
            <div className="min-w-0 space-y-3 pb-28 lg:pb-0">
              {phase === "review" && (
                <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  Review mode — answers are locked. Green = correct, red = incorrect.
                </div>
              )}
              <article
                className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6"
                aria-labelledby={`q-${currentQuestion.question_number}`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Question {currentQuestion.question_number}
                    {phase === "attempt" && " · Select one answer"}
                  </span>
                  {phase === "attempt" && (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        flagged[currentQuestion.question_number]
                          ? "border-red-500 bg-red-500/10 text-red-700 dark:text-red-400"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                      onClick={() =>
                        setFlagged((f) => ({
                          ...f,
                          [currentQuestion.question_number]: !f[currentQuestion.question_number],
                        }))
                      }
                      aria-pressed={!!flagged[currentQuestion.question_number]}
                      aria-label={
                        flagged[currentQuestion.question_number] ? "Remove flag" : "Flag question"
                      }
                    >
                      <Flag className="h-3.5 w-3.5" />
                      {flagged[currentQuestion.question_number] ? "Flagged" : "Flag question"}
                    </button>
                  )}
                  {phase === "review" && flagged[currentQuestion.question_number] && (
                    <span className="inline-flex items-center gap-1 text-xs text-red-600">
                      <Flag className="h-3.5 w-3.5" /> Flagged
                    </span>
                  )}
                </div>
                <p
                  id={`q-${currentQuestion.question_number}`}
                  className="text-base font-medium leading-relaxed sm:text-lg"
                >
                  {currentQuestion.question}
                </p>
                <ul className="mt-4 space-y-2" role="list">
                  {currentQuestion.options.map((opt) => {
                    const qNum = currentQuestion.question_number;
                    const selected = answers[qNum] === opt;
                    const inReview = phase === "review";
                    const isCorrect = isOptionCorrect(currentQuestion, opt);
                    return (
                      <li key={opt}>
                        <button
                          type="button"
                          disabled={inReview}
                          onClick={() => selectAnswer(currentQuestion, opt)}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            !inReview && !selected && "border-border hover:border-foreground/30 hover:bg-muted/40",
                            !inReview && selected && "border-foreground bg-muted/60 ring-1 ring-foreground/20",
                            inReview && isCorrect && "border-emerald-600 bg-emerald-500/10",
                            inReview && selected && !isCorrect && "border-red-500 bg-red-500/10",
                            inReview && !selected && !isCorrect && "border-border opacity-60",
                          )}
                        >
                          <span className="mt-0.5 shrink-0">
                            {inReview && isCorrect ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : inReview && selected ? (
                              <XCircle className="h-4 w-4 text-red-500" />
                            ) : selected ? (
                              <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-foreground bg-foreground">
                                <span className="h-1.5 w-1.5 rounded-full bg-background" />
                              </span>
                            ) : (
                              <span className="block h-4 w-4 rounded-full border-2 border-border" />
                            )}
                          </span>
                          <span>{opt}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {phase === "review" && currentQuestion.explanation && (
                  <div className="mt-4 rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Feedback</p>
                    <p className="mt-1">{currentQuestion.explanation}</p>
                    <p className="mt-2 text-xs">
                      Correct answer: <strong className="text-foreground">{currentQuestion.correct_answer}</strong>
                    </p>
                  </div>
                )}
              </article>

              <div className="hidden gap-2 lg:flex">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 flex-1 rounded-xl"
                  disabled={isFirst}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="mr-1.5 h-4 w-4" /> Previous
                </Button>
                {!isLast ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 flex-1 rounded-xl"
                    onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                  >
                    Next <ChevronRight className="ml-1.5 h-4 w-4" />
                  </Button>
                ) : phase === "attempt" ? (
                  <Button type="button" className="h-10 flex-1 rounded-xl" onClick={finishAttempt}>
                    Finish attempt
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 flex-1 rounded-xl"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Done
                  </Button>
                )}
              </div>
            </div>

            <aside className="lg:sticky lg:top-[4.5rem] lg:self-start">
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <button
                  type="button"
                  className="flex w-full items-center justify-between border-b border-border bg-muted/30 px-3 py-2.5 text-left text-sm font-semibold lg:cursor-default"
                  onClick={() => setNavOpen((o) => !o)}
                >
                  Quiz navigation
                  <span className="text-xs font-normal text-muted-foreground lg:hidden">
                    {navOpen ? "Hide" : "Show"}
                  </span>
                </button>
                <div className={cn("p-3", navOpen ? "block" : "hidden lg:block")}>
                  <div
                    className="grid grid-cols-5 gap-1.5 sm:grid-cols-6 lg:grid-cols-5"
                    role="navigation"
                    aria-label="Quiz navigation"
                  >
                    {questions.map((q, idx) => (
                      <MoodleNavCell
                        key={q.question_number}
                        number={idx + 1}
                        state={navState(q, idx)}
                        flagged={!!flagged[q.question_number]}
                        isCurrent={idx === currentIndex}
                        onClick={() => setCurrentIndex(idx)}
                      />
                    ))}
                  </div>
                  <ul className="mt-3 space-y-1 border-t border-border pt-3 text-[10px] text-muted-foreground">
                    <li className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded border border-border bg-background" /> Not answered
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className="relative h-3 w-3 overflow-hidden rounded border border-border bg-muted">
                        <span className="absolute inset-x-0 bottom-0 h-1/2 bg-muted-foreground/20" />
                      </span>{" "}
                      Answered
                    </li>
                    {phase === "review" && (
                      <>
                        <li className="flex items-center gap-1.5">
                          <span className="h-3 w-3 rounded border border-emerald-700 bg-emerald-600" /> Correct
                        </li>
                        <li className="flex items-center gap-1.5">
                          <span className="h-3 w-3 rounded border border-red-700 bg-red-600" /> Incorrect
                        </li>
                      </>
                    )}
                    <li className="flex items-center gap-1.5">
                      <span className="relative h-3 w-3 rounded border border-border">
                        <span className="absolute right-0 top-0 h-0 w-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-red-600" />
                      </span>{" "}
                      Flagged
                    </li>
                  </ul>
                  {phase === "attempt" && (
                    <Button type="button" className="mt-3 h-9 w-full rounded-lg text-xs" onClick={finishAttempt}>
                      Finish attempt…
                    </Button>
                  )}
                  {phase === "review" && (
                    <p className="mt-3 text-center text-xs text-muted-foreground">
                      Score: <strong className="text-foreground">{correctCount}/{questions.length}</strong>
                    </p>
                  )}
                </div>
              </div>
            </aside>

            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
              <div className="mx-auto flex max-w-7xl gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 rounded-xl text-sm"
                  disabled={isFirst}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" /> Prev
                </Button>
                {!isLast ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 flex-1 rounded-xl text-sm"
                    onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                  >
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : phase === "attempt" ? (
                  <Button type="button" className="h-11 flex-1 rounded-xl text-sm" onClick={finishAttempt}>
                    Finish attempt
                  </Button>
                ) : (
                  <Button type="button" variant="outline" className="h-11 flex-1 rounded-xl text-sm" onClick={() => setSettingsOpen(true)}>
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
