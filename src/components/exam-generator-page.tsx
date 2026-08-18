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
  GraduationCap,
  CheckCircle2,
  XCircle,
  Sparkles,
  RefreshCw,
  Upload,
  FileText,
  X,
  Download,
  Info,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Trash2,
  RotateCcw,
  Settings2,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiKeyPanel, type AiProvider } from "@/components/api-key-panel";
import { downloadExamPdf } from "@/lib/exam-pdf";

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

/** Fuzzy: exact, near-substring, or high word overlap (rephrases). */
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

function questionKey(q: ExamQuestion) {
  return normalizeQuestionText(q.question);
}

export function ExamGeneratorPage() {
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Beginner");
  const [numQuestions, setNumQuestions] = useState(5);
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
  const [seenQuestions, setSeenQuestions] = useState<string[]>([]);

  useEffect(() => {
    setWrongQuestions(loadWrongQuestions());
    setSeenQuestions(loadSeenQuestions());
  }, []);

  const persistWrong = useCallback((list: ExamQuestion[]) => {
    setWrongQuestions(list);
    saveWrongQuestions(list);
  }, []);

  const docMode = docText.length > 0;
  const generateFn = useServerFn(generateExam);
  const generateDocFn = useServerFn(generateExamFromDocument);

  const mutation = useMutation({
    mutationFn: async () => {
      const avoid = seenQuestions.slice(-200);
      if (docMode) {
        return generateDocFn({
          data: {
            apiKey,
            provider: aiProvider,
            documentName: docName || "Uploaded document",
            documentText: docText,
            difficulty,
            numQuestions,
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
          numQuestions,
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
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setSettingsOpen(false);
      }
    },
  });

  const questions: ExamQuestion[] = reviewMode
    ? reviewQuestions
    : (mutation.data?.questions ?? []);

  useEffect(() => {
    if (questions.length === 0) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex >= questions.length) setCurrentIndex(questions.length - 1);
  }, [questions.length, currentIndex]);

  const run = useCallback(() => {
    if (!docMode && !topic.trim()) return;
    if (numQuestions < 1) return;
    if (wrongQuestions.length > 0) return;
    mutation.mutate();
  }, [docMode, topic, numQuestions, mutation, wrongQuestions.length]);

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

  useEffect(() => {
    if (!allAnswered || examFinished || reviewMode) return;
    const sessionWrong: ExamQuestion[] = [];
    for (const q of questions) {
      const selected = answers[q.question_number];
      if (selected && selected !== q.correct_answer) sessionWrong.push(q);
    }
    if (sessionWrong.length > 0) {
      const merged = [...wrongQuestions];
      for (const q of sessionWrong) {
        const already = merged.some((w) => isSimilarQuestion(w.question, q.question));
        if (!already) merged.push(q);
      }
      persistWrong(merged.map((q, i) => ({ ...q, question_number: i + 1 })));
      setExamFinished(true);
    } else setExamFinished(true);
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
    const isCorrect = opt === q.correct_answer;
    const key = questionKey(q);
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
        (q) => revealed[q.question_number] && answers[q.question_number] === q.correct_answer,
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

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-3 py-3 sm:px-5 sm:py-6 lg:px-8 lg:py-8 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="grid w-full grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[minmax(280px,360px)_1fr] lg:gap-8 lg:items-start">
          <aside className={cn("flex flex-col rounded-2xl sm:rounded-3xl border border-border bg-secondary/60", "lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto")}>
            <div className="flex items-center justify-between gap-3 p-4 sm:p-5 lg:p-6 pb-3 sm:pb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                  <GraduationCap className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="font-display text-base sm:text-lg font-bold tracking-tight truncate">Exam Generator</h1>
                  <p className="text-[11px] sm:text-xs text-muted-foreground">
                    AI MCQ drafting
                    {hasWrongPending && <span className="text-amber-700 dark:text-amber-400">{" · "}{wrongQuestions.length} to review</span>}
                  </p>
                </div>
              </div>
              <button type="button" className="lg:hidden flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground touch-manipulation" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen} aria-label={settingsOpen ? "Hide settings" : "Show settings"}>
                {settingsOpen ? <ChevronUp className="h-5 w-5" /> : <Settings2 className="h-5 w-5" />}
              </button>
            </div>
            <div className={cn("flex flex-col gap-4 sm:gap-5 px-4 sm:px-5 lg:px-6 pb-4 sm:pb-6", settingsOpen ? "flex" : "hidden lg:flex")}>
              <ApiKeyPanel onKeyChange={(key, provider) => { setApiKey(key); setAiProvider(provider); }} />
              {hasWrongPending && (
                <div className="rounded-2xl border border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/30 p-3.5 sm:p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <BookOpen className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{wrongQuestions.length} wrong question{wrongQuestions.length !== 1 ? "s" : ""} saved</p>
                      <p className="text-[11px] leading-relaxed text-amber-800/80 dark:text-amber-200/70 mt-0.5">Answer each correctly (retry allowed). Then generate new questions.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" className="flex-1 h-10 sm:h-9 rounded-xl text-xs font-semibold touch-manipulation" onClick={() => startReview()} disabled={reviewMode && reviewQuestions.length > 0}>
                      <BookOpen className="mr-1.5 h-3.5 w-3.5" />{reviewMode ? "Reviewing…" : "Review now"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-10 sm:h-9 w-10 sm:w-9 rounded-xl text-xs touch-manipulation shrink-0 px-0" onClick={clearAllWrong} title="Clear all saved wrong questions"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Source document (optional)</Label>
                <input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain" className="hidden" id="doc-upload" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
                {!docMode ? (
                  <button type="button" onClick={() => document.getElementById("doc-upload")?.click()} disabled={docExtracting} className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-60 touch-manipulation">
                    {docExtracting ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading…</> : <><Upload className="h-4 w-4" /><span className="text-left">Upload PDF, DOCX, or TXT</span></>}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{docName}</p><p className="text-[10px] text-muted-foreground">{docText.length.toLocaleString()} chars</p></div>
                    <button type="button" onClick={() => { setDocText(""); setDocName(""); setDocError(null); }} className="rounded-md p-2 text-muted-foreground hover:text-destructive touch-manipulation" aria-label="Remove document"><X className="h-4 w-4" /></button>
                  </div>
                )}
                {docError && <p className="text-xs text-destructive">{docError}</p>}
              </div>
              {!docMode && (
                <div className="space-y-2">
                  <Label htmlFor="topic" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Topic</Label>
                  <Input id="topic" placeholder="e.g. Data Structures" value={topic} onChange={(e) => setTopic(e.target.value)} className="h-11 rounded-xl text-base sm:text-sm" disabled={hasWrongPending} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Difficulty</Label>
                  <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)} disabled={hasWrongPending}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Beginner">Beginner</SelectItem>
                      <SelectItem value="Intermediate">Intermediate</SelectItem>
                      <SelectItem value="Advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Questions</Label>
                  <Input type="number" min={1} max={200} inputMode="numeric" value={numQuestions} onChange={(e) => setNumQuestions(Math.min(200, Math.max(1, parseInt(e.target.value, 10) || 1)))} className="h-11 rounded-xl text-base sm:text-sm" disabled={hasWrongPending} />
                </div>
              </div>
              <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-card/70 p-3.5 sm:p-4 touch-manipulation">
                <span className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-3.5 w-3.5 text-primary" /> Auto-generate</span>
                <Switch checked={autoGenerate} onCheckedChange={setAutoGenerate} disabled={hasWrongPending} />
              </label>
              <Button type="button" onClick={run} disabled={mutation.isPending || docExtracting || (!docMode && !topic.trim()) || !canGenerateNew} className="h-12 w-full rounded-2xl font-semibold touch-manipulation text-base sm:text-sm">
                {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</> : !canGenerateNew ? <><BookOpen className="mr-2 h-4 w-4" /> Answer all wrong first</> : questions.length > 0 && !reviewMode ? <><RefreshCw className="mr-2 h-4 w-4" /> Regenerate</> : <><Sparkles className="mr-2 h-4 w-4" /> Generate exam</>}
              </Button>
              {questions.length > 0 && !reviewMode && (
                <Button type="button" variant="outline" className="h-11 w-full rounded-xl text-xs font-bold uppercase tracking-widest touch-manipulation" onClick={() => downloadExamPdf(questions, { title: docMode ? docName : topic.trim() || "Generated exam", difficulty })}>
                  <Download className="mr-2 h-4 w-4" /> Download PDF
                </Button>
              )}
              {questions.length > 0 && (
                <p className="text-center text-sm text-muted-foreground">{reviewMode ? "Re-exam left" : "Score"}: {reviewMode ? `${questions.length} to go` : `${correctCount}/${questions.length}`}</p>
              )}
              {seenQuestions.length > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card/50 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground leading-snug">{seenQuestions.length} past question{seenQuestions.length !== 1 ? "s" : ""} remembered (fuzzy match — will not repeat similar ones)</p>
                  <button type="button" onClick={clearSeenHistory} className="shrink-0 text-[11px] font-medium text-muted-foreground hover:text-destructive underline-offset-2 hover:underline touch-manipulation">Clear history</button>
                </div>
              )}
            </div>
          </aside>
          <main className={cn("flex flex-col gap-4 sm:gap-5 min-w-0", hasActiveExam && "pb-20 lg:pb-0")}>
            {mutation.isError && <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{(mutation.error as Error).message}</div>}
            {mutation.isPending && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl sm:rounded-[28px] border border-dashed border-border bg-card py-16 sm:py-24 text-muted-foreground">
                <Loader2 className="h-7 w-7 animate-spin text-primary" /><p className="text-sm">Drafting your exam…</p>
              </div>
            )}
            {showFinishSummary && (
              <div className="flex flex-col items-center justify-center gap-4 rounded-2xl sm:rounded-[28px] border border-border bg-card py-12 sm:py-16 text-center px-4 sm:px-6">
                <CheckCircle2 className="h-10 w-10 text-primary" />
                <div><p className="text-lg font-semibold">Exam finished</p><p className="text-sm text-muted-foreground mt-1">Score: {correctCount}/{questions.length}</p></div>
                {wrongQuestions.length > 0 ? (
                  <><p className="text-sm text-amber-800 dark:text-amber-200 max-w-sm">{wrongQuestions.length} wrong question{wrongQuestions.length !== 1 ? "s" : ""} saved. Re-exam starts next.</p>
                  <Button type="button" className="rounded-xl h-11 touch-manipulation w-full sm:w-auto" onClick={() => startReview()}><RotateCcw className="mr-2 h-4 w-4" />Re-exam wrong questions now</Button></>
                ) : <p className="text-sm text-muted-foreground">Perfect score — you can generate new questions.</p>}
              </div>
            )}
            {!mutation.isPending && questions.length === 0 && !mutation.isError && !showFinishSummary && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl sm:rounded-[28px] border border-dashed border-border bg-card py-16 sm:py-24 text-center text-muted-foreground px-4">
                {hasWrongPending ? (
                  <><BookOpen className="h-5 w-5 text-amber-600" /><p className="text-sm max-w-sm">{wrongQuestions.length} wrong question{wrongQuestions.length !== 1 ? "s" : ""} left. Answer each correctly first.</p>
                  <Button type="button" className="mt-2 rounded-xl h-11 touch-manipulation" onClick={() => startReview()}><BookOpen className="mr-2 h-4 w-4" /> Review mistakes</Button></>
                ) : (
                  <><Sparkles className="h-5 w-5 text-primary" /><p className="text-sm">{docMode ? "Click Generate exam to create questions from your document." : "Set a topic and click Generate exam."}</p></>
                )}
              </div>
            )}
            {hasActiveExam && currentQuestion && (
              <>
                {reviewMode && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/20 px-3 sm:px-4 py-2.5 text-xs sm:text-sm text-amber-900 dark:text-amber-100 leading-relaxed">
                    <span className="font-semibold">Re-exam</span> — answer correctly to pass. If wrong, try the same question again until correct.
                  </div>
                )}
                <div className="flex items-center gap-3 px-0.5">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground whitespace-nowrap">{reviewMode ? "Re-exam" : "Q"} {currentIndex + 1}/{questions.length}</p>
                  <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${((currentIndex + 1) / Math.max(questions.length, 1)) * 100}%` }} />
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 md:p-6 shadow-sm">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Question {currentQuestion.question_number}{reviewMode && <span className="ml-2 text-amber-600">· must answer correctly</span>}</p>
                  <p className="mb-4 text-[15px] sm:text-base leading-relaxed">{currentQuestion.question}</p>
                  <div className="space-y-2.5">
                    {currentQuestion.options.map((opt, i) => {
                      const letter = String.fromCharCode(65 + i);
                      const selected = answers[currentQuestion.question_number];
                      const isRevealed = revealed[currentQuestion.question_number];
                      const isSelected = selected === opt;
                      const isAnswer = opt === currentQuestion.correct_answer;
                      return (
                        <button key={i} type="button" disabled={isRevealed} onClick={() => handleAnswer(currentQuestion, opt)} className={cn("flex w-full items-start gap-3 rounded-xl border px-3.5 sm:px-4 py-3.5 sm:py-3 text-left transition-colors touch-manipulation min-h-[52px] sm:min-h-0 border-border hover:border-foreground active:scale-[0.99]", isSelected && !isRevealed && "border-foreground bg-secondary", isRevealed && isAnswer && "border-emerald-600 bg-emerald-50", isRevealed && isSelected && !isAnswer && "border-destructive bg-red-50")}>
                          <span className={cn("flex h-8 w-8 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold", isRevealed && isAnswer && "border-emerald-700 bg-emerald-700 text-white", isRevealed && isSelected && !isAnswer && "border-destructive bg-destructive text-white")}>{letter}</span>
                          <span className="flex-1 pt-0.5 text-sm leading-snug">{opt}</span>
                          {isRevealed && isAnswer && <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0" />}
                          {isRevealed && isSelected && !isAnswer && <XCircle className="h-5 w-5 text-destructive shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  {revealed[currentQuestion.question_number] && (
                    <div className={cn("mt-4 rounded-xl border-l-4 bg-secondary/60 p-3.5 sm:p-4", answers[currentQuestion.question_number] === currentQuestion.correct_answer ? "border-emerald-700" : "border-amber-600")}>
                      <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                        <Info className="h-3.5 w-3.5" />
                        {answers[currentQuestion.question_number] === currentQuestion.correct_answer ? (reviewMode ? "Correct — removed from mistakes" : "Correct") : reviewMode ? "Wrong — try again" : `Answer: ${currentQuestion.correct_answer}`}
                      </div>
                      {!(reviewMode && needsRetry) && <p className="text-sm leading-relaxed">{currentQuestion.explanation}</p>}
                      {reviewMode && needsRetry && (
                        <div className="mt-3 space-y-2">
                          <p className="text-sm text-muted-foreground">You must get this right before moving on. Read the explanation, then try again.</p>
                          <p className="text-sm leading-relaxed border-t border-border/60 pt-2">{currentQuestion.explanation}</p>
                          <Button type="button" className="mt-2 h-11 rounded-xl w-full sm:w-auto touch-manipulation" onClick={retryCurrentQuestion}><RotateCcw className="mr-2 h-4 w-4" />Try again</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="hidden lg:flex items-center justify-between gap-3">
                  <Button type="button" variant="outline" className="h-11 rounded-xl px-5" disabled={isFirst || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}><ChevronLeft className="mr-1.5 h-4 w-4" />Previous</Button>
                  <span className="text-xs text-muted-foreground tabular-nums">{currentIndex + 1} / {questions.length}</span>
                  <Button type="button" variant="outline" className="h-11 rounded-xl px-5" disabled={isLast || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}>Next<ChevronRight className="ml-1.5 h-4 w-4" /></Button>
                </div>
                <div className={cn("lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-md px-3 pt-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))]")}>
                  <div className="mx-auto max-w-6xl flex items-center gap-2">
                    <Button type="button" variant="outline" className="h-12 flex-1 rounded-xl touch-manipulation text-sm" disabled={isFirst || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Prev</Button>
                    <span className="text-xs text-muted-foreground tabular-nums px-2 shrink-0">{currentIndex + 1}/{questions.length}</span>
                    <Button type="button" variant="outline" className="h-12 flex-1 rounded-xl touch-manipulation text-sm" disabled={isLast || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
