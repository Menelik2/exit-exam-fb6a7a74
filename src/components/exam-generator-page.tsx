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

type Difficulty = "Beginner" | "Intermediate" | "Advanced";
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
  return q.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function questionTokens(q: string): Set<string> {
  return new Set(normalizeQuestionText(q).split(" ").filter((w) => w.length > 2));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
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
    if (questions.length === 0) { setCurrentIndex(0); return; }
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

  const selectAnswer = (q: ExamQuestion, opt: string) => {
    if (phase !== "attempt") return;
    setAnswers((a) => ({ ...a, [q.question_number]: opt }));
    setLastSaved(new Date());
  };

  const finishAttempt = () => { setPhase("summary"); setConfirmSubmit(false); };
  const returnToAttempt = () => { setPhase("attempt"); setConfirmSubmit(false); };

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
      questions, answers, title: titleForHistory, difficulty,
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
    () => questions.filter((q) => answers[q.question_number] != null && isOptionCorrect(q, answers[q.question_number])).length,
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
      if (e.key === "ArrowLeft") { e.preventDefault(); setCurrentIndex((i) => Math.max(0, i - 1)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setCurrentIndex((i) => Math.min(questions.length - 1, i + 1)); }
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
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground transition active:scale-[0.97] hover:bg-muted sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3 sm:text-xs sm:font-medium"
              onClick={cycleTheme}
              aria-label={`Theme: ${themeMode}. Click to change.`}
              title={`Theme: ${themeMode}`}
            >
              {themeMode === "dark" ? (
                <Moon className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" />
              ) : themeMode === "light" ? (
                <Sun className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" />
              ) : (
                <Monitor className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" />
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
              <Settings2 className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5" />
              <span className="hidden xs:inline sm:inline">{settingsOpen ? "Hide" : "Setup"}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-6">
        {/* LAYOUT_BODY_CONTINUES */}
        <p className="text-sm text-muted-foreground">Loading layout…</p>
      </div>
    </div>
  );
}
