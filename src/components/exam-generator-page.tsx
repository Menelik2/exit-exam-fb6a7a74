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
  BarChart3,
  FileDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiKeyPanel, type AiProvider } from "@/components/api-key-panel";
import { exportPdf, exportText, copyShareLink, parseShareCode } from "@/lib/exam-export";
import { recordFinishedAttempt } from "@/lib/exam-history";
import { ProgressAnalytics } from "@/components/progress-analytics";
import { useTheme } from "@/hooks/use-theme";
import { toast } from "sonner";

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

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

export function ExamGeneratorPage() {
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Beginner");
  const [numQuestions, setNumQuestions] = useState(5);
  const [numQuestionsText, setNumQuestionsText] = useState("5");
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider>("gemini");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [docName, setDocName] = useState("");
  const [docText, setDocText] = useState("");
  const [docExtracting, setDocExtracting] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [wrongQuestions, setWrongQuestions] = useState<ExamQuestion[]>([]);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewQuestions, setReviewQuestions] = useState<ExamQuestion[]>([]);
  const [examFinished, setExamFinished] = useState(false);
  const [needsRetry, setNeedsRetry] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(true);
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const [seenQuestions, setSeenQuestions] = useState<string[]>([]);
  const [historyKey, setHistoryKey] = useState(0);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [importedQuestions, setImportedQuestions] = useState<ExamQuestion[] | null>(null);
  const { mode: themeMode, cycle: cycleTheme, isDark } = useTheme();

  useEffect(() => {
    setWrongQuestions(loadWrongQuestions());
    setSeenQuestions(loadSeenQuestions());
  }, []);

  // Load shared quiz from ?quiz= URL
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
    setReviewMode(false);
    setReviewQuestions([]);
    setExamFinished(false);
    setAnswers({});
    setRevealed({});
    setCurrentIndex(0);
    setFlagged({});
    setNeedsRetry(false);
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
      setExamFinished(false);
      setNeedsRetry(false);
      setFlagged({});
      setImportedQuestions(null);
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
      setRevealed({});
      setCurrentIndex(0);
      setReviewMode(false);
      setReviewQuestions([]);
      setExamFinished(false);
      setNeedsRetry(false);
      setFlagged({});
      if (data?.questions?.length) {
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
    const raw = reviewMode
      ? reviewQuestions
      : (importedQuestions ?? mutation.data?.questions ?? []);
    return raw.map((q, i) => ({ ...q, question_number: i + 1 }));
  }, [reviewMode, reviewQuestions, importedQuestions, mutation.data?.questions]);

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
    if (wrongQuestions.length > 0) return;
    mutation.mutate(n);
  }, [docMode, topic, numQuestionsText, mutation, wrongQuestions.length]);

  useEffect(() => {
    if (!autoGenerate) return;
    if (!docMode && !topic.trim()) return;
    if (wrongQuestions.length > 0) return;
    const t = setTimeout(() => run(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, difficulty, numQuestions, autoGenerate, aiProvider, apiKey, docMode, wrongQuestions.length]);

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

  const startReview = useCallback(
    (source?: ExamQuestion[]) => {
      const list = source ?? wrongQuestions;
      if (list.length === 0) return;
      setReviewQuestions(list.map((q, i) => ({ ...q, question_number: i + 1 })));
      setReviewMode(true);
      setExamFinished(false);
      setAnswers({});
      setRevealed({});
      setCurrentIndex(0);
      setNeedsRetry(false);
      setFlagged({});
      if (typeof window !== "undefined" && window.innerWidth < 1024) setSettingsOpen(false);
    },
    [wrongQuestions],
  );

  const clearAllWrong = () => {
    persistWrong([]);
    if (reviewMode) {
      setReviewMode(false);
      setReviewQuestions([]);
      setAnswers({});
      setRevealed({});
      setCurrentIndex(0);
    }
    setExamFinished(false);
    setNeedsRetry(false);
  };

  const clearSeenHistory = () => {
    setSeenQuestions([]);
    saveSeenQuestions([]);
  };

  const retryCurrentQuestion = useCallback(() => {
    if (!questions[currentIndex]) return;
    const qNum = questions[currentIndex].question_number;
    setAnswers((a) => {
      const next = { ...a };
      delete next[qNum];
      return next;
    });
    setRevealed((r) => {
      const next = { ...r };
      delete next[qNum];
      return next;
    });
    setNeedsRetry(false);
  }, [questions, currentIndex]);

  const allAnswered =
    !reviewMode && questions.length > 0 && questions.every((q) => revealed[q.question_number]);

  const isOptionCorrect = (q: ExamQuestion, opt: string) => {
    if (opt === q.correct_answer) return true;
    if (opt.trim().toLowerCase() === (q.correct_answer ?? "").trim().toLowerCase()) return true;
    return false;
  };

  useEffect(() => {
    if (!allAnswered || examFinished || reviewMode) return;
    const sessionWrong: ExamQuestion[] = [];
    for (const q of questions) {
      const selected = answers[q.question_number];
      if (selected && !isOptionCorrect(q, selected)) sessionWrong.push(q);
    }
    if (sessionWrong.length > 0) {
      const merged = [...wrongQuestions];
      for (const q of sessionWrong) {
        const already = merged.some((w) => isSimilarQuestion(w.question, q.question));
        if (!already) merged.push(q);
      }
      persistWrong(merged.map((q, i) => ({ ...q, question_number: i + 1 })));
    }
    setExamFinished(true);
    const titleForHistory = docMode
      ? docName || "Document quiz"
      : topic.trim() || "Generated quiz";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAnswered, examFinished, reviewMode, questions, answers, wrongQuestions, persistWrong]);

  useEffect(() => {
    if (!examFinished || reviewMode || wrongQuestions.length === 0) return;
    const t = setTimeout(() => startReview(wrongQuestions), 1500);
    return () => clearTimeout(t);
  }, [examFinished, reviewMode, wrongQuestions, startReview]);

  const handleAnswer = (q: ExamQuestion, opt: string) => {
    const qNum = q.question_number;
    setAnswers((a) => ({ ...a, [qNum]: opt }));
    setRevealed((r) => ({ ...r, [qNum]: true }));
    const isCorrect = isOptionCorrect(q, opt);
    if (!isCorrect) {
      if (!wrongQuestions.some((w) => isSimilarQuestion(w.question, q.question))) {
        persistWrong([...wrongQuestions, { ...q, question_number: wrongQuestions.length + 1 }]);
      }
      if (reviewMode) setNeedsRetry(true);
    } else {
      setNeedsRetry(false);
      const remaining = wrongQuestions.filter((w) => !isSimilarQuestion(w.question, q.question));
      if (remaining.length !== wrongQuestions.length) persistWrong(remaining);
      if (reviewMode) {
        setReviewQuestions((prev) => {
          const next = prev
            .filter((w) => !isSimilarQuestion(w.question, q.question))
            .map((item, i) => ({ ...item, question_number: i + 1 }));
          setCurrentIndex((idx) => (next.length === 0 ? 0 : Math.min(idx, next.length - 1)));
          if (next.length === 0) {
            setReviewMode(false);
            setExamFinished(false);
            setAnswers({});
            setRevealed({});
            setNeedsRetry(false);
            setSettingsOpen(true);
          }
          return next;
        });
        setAnswers({});
        setRevealed({});
      }
    }
  };

  const correctCount = useMemo(
    () =>
      questions.filter(
        (q) =>
          revealed[q.question_number] &&
          answers[q.question_number] != null &&
          isOptionCorrect(q, answers[q.question_number]),
      ).length,
    [questions, revealed, answers],
  );

  const currentQuestion = questions[currentIndex];
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= questions.length - 1;
  const hasWrongPending = wrongQuestions.length > 0;
  const canGenerateNew = !hasWrongPending;
  const showFinishSummary = examFinished && !reviewMode && questions.length > 0 && allAnswered;
  const hasActiveExam = !mutation.isPending && !!currentQuestion && !showFinishSummary;
  const answeredCount = questions.filter((q) => answers[q.question_number] != null).length;

  useEffect(() => {
    if (!hasActiveExam || questions.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (reviewMode && needsRetry) return;
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
  }, [hasActiveExam, questions.length, reviewMode, needsRetry]);

  const quizTitle = reviewMode
    ? "Re-attempt: incorrect questions"
    : docMode
      ? docName || "Document quiz"
      : topic.trim() || "Generated quiz";

  const navStatus = (q: ExamQuestion, idx: number) => {
    const qNum = q.question_number;
    const answered = answers[qNum] != null;
    const isRev = !!revealed[qNum];
    const correct = answered && isOptionCorrect(q, answers[qNum]);
    if (idx === currentIndex) return "current";
    if (isRev && correct) return "correct";
    if (isRev && answered && !correct) return "incorrect";
    if (answered) return "answered";
    if (flagged[qNum]) return "flagged";
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
                {hasActiveExam || showFinishSummary ? quizTitle : "Exit Exam Practice"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {reviewMode
                  ? "Review mode · answer correctly to clear mistakes"
                  : hasActiveExam
                    ? `${difficulty} · Question ${currentIndex + 1} of ${questions.length}`
                    : "Modern quiz practice"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {hasActiveExam && (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                  Answered {answeredCount}/{questions.length}
                </span>
                <span className="hidden rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary lg:inline">
                  Score {correctCount}/{questions.length}
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
            <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen} aria-controls="quiz-setup-panel">
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Setup</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
        {settingsOpen && (
          <section id="quiz-setup-panel" className="mb-4 overflow-hidden rounded-2xl border border-border bg-card/90 shadow-sm ring-1 ring-foreground/5 lg:mb-6">
            <div className="border-b border-border bg-muted/40 px-4 py-3 lg:px-6 lg:py-3.5">
              <h2 className="text-sm font-semibold tracking-tight lg:text-base">Quiz setup</h2>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-2 lg:gap-8 lg:p-6">
              <div className="space-y-3">
                <ApiKeyPanel onKeyChange={(k, p) => { setApiKey(k); setAiProvider(p); }} />
                <div className="space-y-2">
                  <Label htmlFor="topic">Topic</Label>
                  <Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Thermodynamics, Civil Procedure" className="rounded-xl" disabled={docMode} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Difficulty</Label>
                    <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
                      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Beginner">Beginner</SelectItem>
                        <SelectItem value="Intermediate">Intermediate</SelectItem>
                        <SelectItem value="Advanced">Advanced</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="nq">Questions</Label>
                    <Input id="nq" value={numQuestionsText} onChange={(e) => setNumQuestionsText(e.target.value)} className="rounded-xl" inputMode="numeric" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                  <Label htmlFor="auto" className="text-sm">Auto-generate</Label>
                  <Switch id="auto" checked={autoGenerate} onCheckedChange={setAutoGenerate} />
                </div>
                <div className="space-y-2">
                  <Label>Or upload a document</Label>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-medium hover:bg-muted">
                      <Upload className="h-3.5 w-3.5" />
                      {docExtracting ? "Reading…" : "Upload PDF / DOCX / TXT"}
                      <input type="file" className="sr-only" accept=".pdf,.docx,.txt,.md" disabled={docExtracting} onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
                    </label>
                    {docName && (
                      <Button type="button" variant="outline" size="sm" className="h-9 rounded-xl text-xs" onClick={() => { setDocText(""); setDocName(""); setDocError(null); }}>
                        <X className="mr-1 h-3.5 w-3.5" /> Clear doc
                      </Button>
                    )}
                  </div>
                  {docName && <p className="text-[11px] text-muted-foreground"><FileText className="mr-1 inline h-3 w-3" />{docName}</p>}
                  {docError && <p className="text-xs text-destructive">{docError}</p>}
                </div>
                <Button type="button" className="h-10 w-full rounded-xl" disabled={mutation.isPending || (!docMode && !topic.trim()) || hasWrongPending} onClick={run}>
                  {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</> : questions.length > 0 && !reviewMode ? <><RefreshCw className="mr-2 h-4 w-4" /> Regenerate quiz</> : <><Sparkles className="mr-2 h-4 w-4" /> Start attempt</>}
                </Button>
                {questions.length > 0 && !reviewMode && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Export</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      <Button type="button" variant="outline" className="h-9 rounded-xl border-border text-[11px]" onClick={() => exportPdf(questions, { title: quizTitle, difficulty })} aria-label="Download PDF">
                        <Download className="mr-1 h-3.5 w-3.5" /> PDF
                      </Button>
                      <Button type="button" variant="outline" className="h-9 rounded-xl border-border text-[11px]" onClick={() => exportText(questions, { title: quizTitle, difficulty })} aria-label="Download text file for Word">
                        <FileDown className="mr-1 h-3.5 w-3.5" /> Text
                      </Button>
                      <Button type="button" variant="outline" className="h-9 rounded-xl border-border text-[11px]" onClick={async () => {
                        const res = await copyShareLink(questions, { title: quizTitle, difficulty });
                        if (res.ok) {
                          setShareMsg(res.mode === "url" ? "Share link copied" : "Share code copied (quiz too large for URL)");
                          toast.success(res.mode === "url" ? "Share link copied to clipboard" : "Share code copied");
                        } else {
                          setShareMsg("Copy failed — code shown in console");
                          console.log("Share code:", res.value);
                          toast.error("Could not copy — check console for code");
                        }
                        setTimeout(() => setShareMsg(null), 4000);
                      }} aria-label="Copy shareable quiz link">
                        <Share2 className="mr-1 h-3.5 w-3.5" /> Share
                      </Button>
                    </div>
                    {shareMsg && <p className="text-[11px] text-primary">{shareMsg}</p>}
                  </div>
                )}
                {seenQuestions.length > 0 && (
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>{seenQuestions.length} past questions remembered</span>
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px]" onClick={clearSeenHistory}>Clear history</Button>
                  </div>
                )}
                {hasWrongPending && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                    <p className="font-medium text-amber-800 dark:text-amber-300">{wrongQuestions.length} to re-attempt</p>
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" className="rounded-lg" onClick={() => startReview()}>Start review</Button>
                      <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={clearAllWrong}><Trash2 className="mr-1 h-3.5 w-3.5" /> Clear</Button>
                    </div>
                  </div>
                )}
                {mutation.isError && (
                  <p className="text-xs text-destructive">{(mutation.error as Error)?.message || "Generation failed"}</p>
                )}
              </div>
              <div className="space-y-3">
                <ProgressAnalytics refreshKey={historyKey} />
              </div>
            </div>
          </section>
        )}

        {showFinishSummary && (
          <div className="rounded-2xl border border-border bg-card/95 p-8 text-center shadow-sm ring-1 ring-foreground/5 lg:mx-auto lg:max-w-2xl lg:p-12" role="status" aria-live="polite">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" aria-hidden />
            <h2 className="mt-3 text-xl font-semibold tracking-tight">Attempt finished</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Score: <strong className="text-foreground">{correctCount}/{questions.length}</strong> ·{" "}
              {Math.round((correctCount / Math.max(questions.length, 1)) * 100)}%
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button type="button" variant="outline" className="rounded-xl text-xs" onClick={() => exportPdf(questions, { title: quizTitle, difficulty })}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> PDF
              </Button>
              <Button type="button" variant="outline" className="rounded-xl text-xs" onClick={() => exportText(questions, { title: quizTitle, difficulty })}>
                <FileDown className="mr-1.5 h-3.5 w-3.5" /> Text
              </Button>
              <Button type="button" variant="outline" className="rounded-xl text-xs" onClick={async () => {
                const res = await copyShareLink(questions, { title: quizTitle, difficulty });
                toast.success(res.ok ? (res.mode === "url" ? "Share link copied" : "Share code copied") : "Copy failed");
              }}>
                <Share2 className="mr-1.5 h-3.5 w-3.5" /> Share
              </Button>
            </div>
            {wrongQuestions.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-amber-800 dark:text-amber-400">{wrongQuestions.length} incorrect — re-attempt available</p>
                <Button type="button" className="rounded-xl" onClick={() => startReview()}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Re-attempt now
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Perfect score. Generate a new quiz from Setup.</p>
            )}
          </div>
        )}

        {!mutation.isPending && questions.length === 0 && !mutation.isError && !showFinishSummary && (
          <div className="rounded-2xl border border-dashed border-border bg-card/70 py-16 text-center shadow-sm">
            {hasWrongPending ? (
              <>
                <BookOpen className="mx-auto h-8 w-8 text-amber-600" />
                <p className="mt-3 text-sm text-muted-foreground">{wrongQuestions.length} question(s) left to review.</p>
                <Button type="button" className="mt-4 rounded-xl" onClick={() => startReview()}>Start re-attempt</Button>
              </>
            ) : (
              <>
                <ListChecks className="mx-auto h-8 w-8 text-primary" />
                <p className="mt-3 text-sm font-medium">No active attempt</p>
                <p className="mt-1 text-xs text-muted-foreground">Open Setup, choose a topic, then click Start attempt.</p>
              </>
            )}
          </div>
        )}

        {mutation.isPending && (
          <div className="flex flex-col items-center justify-center gap-3 py-20" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Generating questions…</p>
          </div>
        )}

        {hasActiveExam && currentQuestion && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-7 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-8">
            <div className="min-w-0 space-y-3 pb-24 lg:pb-0">
              {reviewMode && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                  Review mode — answer correctly to remove from your list.
                </div>
              )}
              <article className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6" aria-labelledby={`q-${currentQuestion.question_number}`}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <p id={`q-${currentQuestion.question_number}`} className="text-base font-medium leading-relaxed sm:text-lg">
                    <span className="mr-2 text-muted-foreground">{currentQuestion.question_number}.</span>
                    {currentQuestion.question}
                  </p>
                  <button
                    type="button"
                    className={cn(
                      "shrink-0 rounded-lg border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      flagged[currentQuestion.question_number] ? "border-amber-500 bg-amber-500/15 text-amber-700" : "border-border text-muted-foreground hover:bg-muted",
                    )}
                    onClick={() => setFlagged((f) => ({ ...f, [currentQuestion.question_number]: !f[currentQuestion.question_number] }))}
                    aria-label={flagged[currentQuestion.question_number] ? "Unflag question" : "Flag question"}
                    aria-pressed={!!flagged[currentQuestion.question_number]}
                  >
                    <Flag className="h-4 w-4" />
                  </button>
                </div>
                <ul className="space-y-2" role="list">
                  {currentQuestion.options.map((opt) => {
                    const qNum = currentQuestion.question_number;
                    const selected = answers[qNum] === opt;
                    const shown = !!revealed[qNum];
                    const isCorrect = isOptionCorrect(currentQuestion, opt);
                    return (
                      <li key={opt}>
                        <button
                          type="button"
                          disabled={shown && !(reviewMode && needsRetry)}
                          onClick={() => handleAnswer(currentQuestion, opt)}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            !shown && "border-border hover:border-primary/50 hover:bg-muted/50",
                            shown && isCorrect && "border-emerald-600 bg-emerald-500/10",
                            shown && selected && !isCorrect && "border-red-500 bg-red-500/10",
                            shown && !selected && !isCorrect && "border-border opacity-70",
                          )}
                        >
                          <span className="mt-0.5 shrink-0">
                            {shown && isCorrect ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : shown && selected ? <XCircle className="h-4 w-4 text-red-500" /> : <span className="block h-4 w-4 rounded-full border border-border" />}
                          </span>
                          <span>{opt}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {revealed[currentQuestion.question_number] && currentQuestion.explanation && (
                  <div className="mt-4 rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Explanation</p>
                    <p className="mt-1">{currentQuestion.explanation}</p>
                  </div>
                )}
                {reviewMode && needsRetry && (
                  <Button type="button" variant="outline" className="mt-3 rounded-xl" onClick={retryCurrentQuestion}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Try again
                  </Button>
                )}
              </article>
              <div className="hidden gap-2 lg:flex">
                <Button type="button" variant="outline" className="h-10 flex-1 rounded-xl" disabled={isFirst || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}>
                  <ChevronLeft className="mr-1.5 h-4 w-4" /> Previous
                </Button>
                <Button type="button" variant="outline" className="h-10 flex-1 rounded-xl" disabled={isLast || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}>
                  Next <ChevronRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </div>

            <aside className="lg:sticky lg:top-[4.5rem] lg:self-start">
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm ring-1 ring-foreground/5">
                <button type="button" className="flex w-full items-center justify-between border-b border-border bg-muted/30 px-3 py-3 text-left text-sm font-semibold lg:cursor-default" onClick={() => setNavOpen((o) => !o)}>
                  Quiz navigation
                  <span className="text-xs font-normal text-muted-foreground lg:hidden">{navOpen ? "Hide" : "Show"}</span>
                </button>
                <div className={cn("p-3 lg:p-4", navOpen ? "block" : "hidden lg:block")}>
                  <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6 lg:grid-cols-5 lg:gap-2" role="navigation" aria-label="Question palette">
                    {questions.map((q, idx) => {
                      const st = navStatus(q, idx);
                      return (
                        <button
                          key={q.question_number}
                          type="button"
                          disabled={reviewMode && needsRetry && idx !== currentIndex}
                          onClick={() => { if (!(reviewMode && needsRetry)) setCurrentIndex(idx); }}
                          className={cn(
                            "relative flex h-9 items-center justify-center rounded-lg border text-xs font-semibold transition-all hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-10 lg:text-sm",
                            st === "current" && "border-primary bg-primary text-primary-foreground ring-2 ring-primary/30",
                            st === "answered" && "border-primary/40 bg-primary/10 text-primary",
                            st === "correct" && "border-emerald-600 bg-emerald-600 text-white",
                            st === "incorrect" && "border-red-500 bg-red-500 text-white",
                            st === "flagged" && "border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-300",
                            st === "todo" && "border-border bg-background hover:border-primary/40",
                          )}
                          aria-label={`Question ${idx + 1}, ${st}`}
                          aria-current={st === "current" ? "true" : undefined}
                        >
                          {idx + 1}
                          {flagged[q.question_number] && st !== "current" && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" aria-hidden />}
                        </button>
                      );
                    })}
                  </div>
                  <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-[10px] text-muted-foreground lg:text-[11px]">
                    <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-primary bg-primary" /> Current</li>
                    <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-primary/40 bg-primary/10" /> Answered</li>
                    <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-border bg-background" /> Not yet answered</li>
                    <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-emerald-600 bg-emerald-600" /> Correct</li>
                    <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-red-500 bg-red-500" /> Incorrect</li>
                  </ul>
                  <p className="mt-3 text-center text-xs text-muted-foreground">Score: <strong className="text-foreground">{correctCount}/{questions.length}</strong></p>
                  <p className="mt-2 hidden text-center text-[10px] text-muted-foreground lg:block">Click a number to jump · use ← → keys</p>
                </div>
              </div>
            </aside>

            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
              <div className="mx-auto flex max-w-7xl gap-2">
                <Button type="button" variant="outline" className="h-11 flex-1 rounded-xl text-sm" disabled={isFirst || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Prev
                </Button>
                <Button type="button" variant="outline" className="h-11 flex-1 rounded-xl text-sm" disabled={isLast || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}>
                  Next <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
