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
    onMutate: () => {
      setExamFinished(false);
      setNeedsRetry(false);
      setFlagged({});
    },
    mutationFn: async (requestedCount?: number) => {
      const count = Math.min(200, Math.max(1, requestedCount ?? numQuestions || 1));
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
    const raw = reviewMode ? reviewQuestions : (mutation.data?.questions ?? []);
    return raw.map((q, i) => ({ ...q, question_number: i + 1 }));
  }, [reviewMode, reviewQuestions, mutation.data?.questions]);

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
    <div className="min-h-screen w-full bg-[#f4f6f8] text-[#1d2125]">
      <header className="sticky top-0 z-50 border-b border-[#d0d5dd] bg-[#0f6cbf] text-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2.5 sm:px-5 lg:px-8 lg:py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <ListChecks className="h-5 w-5 shrink-0 opacity-90" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold sm:text-base lg:text-[17px]">
                {hasActiveExam || showFinishSummary ? quizTitle : "Exit Exam Practice"}
              </p>
              <p className="truncate text-[11px] text-white/75">
                {reviewMode
                  ? "Review mode · answer correctly to clear mistakes"
                  : hasActiveExam
                    ? `${difficulty} · Question ${currentIndex + 1} of ${questions.length}`
                    : "Moodle-style quiz generator"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {hasActiveExam && (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="rounded bg-white/15 px-2.5 py-1 text-xs font-medium">
                  Answered {answeredCount}/{questions.length}
                </span>
                <span className="hidden rounded bg-white/15 px-2.5 py-1 text-xs font-medium lg:inline">
                  Score {correctCount}/{questions.length}
                </span>
              </div>
            )}
            <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-white/15 px-2.5 text-xs font-medium hover:bg-white/25" onClick={() => setSettingsOpen((o) => !o)}>
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Setup</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
        {settingsOpen && (
          <section className="mb-4 rounded border border-[#d0d5dd] bg-white shadow-sm lg:mb-6">
            <div className="border-b border-[#e8eaed] bg-[#f8f9fa] px-4 py-2.5 lg:px-6 lg:py-3">
              <h2 className="text-sm font-semibold text-[#0f6cbf] lg:text-base">Quiz setup</h2>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-2 lg:gap-8 lg:p-6">
              <div className="space-y-3">
                <ApiKeyPanel onKeyChange={(key, provider) => { setApiKey(key); setAiProvider(provider); }} />
                {hasWrongPending && (
                  <div className="rounded border border-amber-300 bg-amber-50 p-3">
                    <p className="text-sm font-semibold text-amber-900">{wrongQuestions.length} question{wrongQuestions.length !== 1 ? "s" : ""} to review</p>
                    <p className="mt-0.5 text-xs text-amber-800">Finish the re-attempt before generating a new quiz.</p>
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" className="h-8 rounded-md bg-[#0f6cbf] text-xs hover:bg-[#0c5aa3]" onClick={() => startReview()} disabled={reviewMode && reviewQuestions.length > 0}>
                        <BookOpen className="mr-1 h-3.5 w-3.5" />{reviewMode ? "Reviewing…" : "Start re-attempt"}
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="h-8 rounded-md text-xs" onClick={clearAllWrong}><Trash2 className="mr-1 h-3.5 w-3.5" /> Clear</Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-[#5b636b]">Source document (optional)</Label>
                  <input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain" className="hidden" id="doc-upload" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
                  {!docMode ? (
                    <button type="button" onClick={() => document.getElementById("doc-upload")?.click()} disabled={docExtracting} className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-[#b0b8c0] bg-[#fafbfc] px-3 py-2.5 text-sm text-[#5b636b] hover:border-[#0f6cbf] hover:text-[#0f6cbf]">
                      {docExtracting ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading…</> : <><Upload className="h-4 w-4" /> Upload PDF, DOCX, or TXT</>}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 rounded border border-[#0f6cbf]/30 bg-[#e8f2fb] px-3 py-2">
                      <FileText className="h-4 w-4 text-[#0f6cbf]" />
                      <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{docName}</p><p className="text-[10px] text-[#5b636b]">{docText.length.toLocaleString()} chars</p></div>
                      <button type="button" onClick={() => { setDocText(""); setDocName(""); setDocError(null); }} className="p-1 text-[#5b636b] hover:text-red-600" aria-label="Remove"><X className="h-4 w-4" /></button>
                    </div>
                  )}
                  {docError && <p className="text-xs text-red-600">{docError}</p>}
                </div>
                {!docMode && (
                  <div className="space-y-1.5">
                    <Label htmlFor="topic" className="text-xs font-semibold text-[#5b636b]">Topic / course</Label>
                    <Input id="topic" placeholder="e.g. Data Structures" value={topic} onChange={(e) => setTopic(e.target.value)} className="h-10 rounded-md border-[#cfd5dc] lg:h-11" disabled={hasWrongPending} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-[#5b636b]">Difficulty</Label>
                    <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)} disabled={hasWrongPending}>
                      <SelectTrigger className="h-10 rounded-md border-[#cfd5dc] lg:h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Beginner">Beginner</SelectItem>
                        <SelectItem value="Intermediate">Intermediate</SelectItem>
                        <SelectItem value="Advanced">Advanced</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-[#5b636b]">Questions</Label>
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      inputMode="numeric"
                      value={numQuestionsText}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "" || v === "-") {
                          setNumQuestionsText(v);
                          return;
                        }
                        if (!/^\d+$/.test(v)) return;
                        setNumQuestionsText(v);
                        const n = parseInt(v, 10);
                        if (!Number.isNaN(n)) setNumQuestions(Math.min(200, Math.max(0, n)));
                      }}
                      onBlur={() => {
                        let n = parseInt(numQuestionsText, 10);
                        if (Number.isNaN(n) || n < 1) n = 1;
                        if (n > 200) n = 200;
                        setNumQuestions(n);
                        setNumQuestionsText(String(n));
                      }}
                      className="h-10 rounded-md border-[#cfd5dc] lg:h-11"
                      disabled={hasWrongPending}
                    />
                  </div>
                </div>
                <label className="flex items-center justify-between rounded border border-[#e8eaed] bg-[#fafbfc] px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm"><Sparkles className="h-3.5 w-3.5 text-[#0f6cbf]" /> Auto-generate</span>
                  <Switch checked={autoGenerate} onCheckedChange={setAutoGenerate} disabled={hasWrongPending} />
                </label>
                <Button type="button" onClick={run} disabled={mutation.isPending || docExtracting || (!docMode && !topic.trim()) || !canGenerateNew} className="h-10 w-full rounded-md bg-[#0f6cbf] font-semibold hover:bg-[#0c5aa3] lg:h-11 lg:text-[15px]">
                  {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</> : !canGenerateNew ? <><BookOpen className="mr-2 h-4 w-4" /> Finish review first</> : questions.length > 0 && !reviewMode ? <><RefreshCw className="mr-2 h-4 w-4" /> Regenerate quiz</> : <><Sparkles className="mr-2 h-4 w-4" /> Start attempt</>}
                </Button>
                {questions.length > 0 && !reviewMode && (
                  <Button type="button" variant="outline" className="h-9 w-full rounded-md border-[#cfd5dc] text-xs" onClick={() => downloadExamPdf(questions, { title: quizTitle, difficulty })}>
                    <Download className="mr-2 h-3.5 w-3.5" /> Download PDF
                  </Button>
                )}
                {seenQuestions.length > 0 && (
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[#5b636b]">
                    <span>{seenQuestions.length} past questions remembered</span>
                    <button type="button" onClick={clearSeenHistory} className="underline hover:text-red-600">Clear history</button>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {mutation.isError && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{(mutation.error as Error).message}</div>
        )}

        {mutation.isPending && (
          <div className="flex flex-col items-center justify-center gap-3 rounded border border-[#d0d5dd] bg-white py-20 text-[#5b636b] shadow-sm">
            <Loader2 className="h-8 w-8 animate-spin text-[#0f6cbf]" />
            <p className="text-sm font-medium">Preparing your quiz attempt…</p>
          </div>
        )}

        {showFinishSummary && (
          <div className="rounded border border-[#d0d5dd] bg-white p-8 text-center shadow-sm lg:mx-auto lg:max-w-2xl lg:p-12">
            <CheckCircle2 className="mx-auto h-12 w-12 text-[#0f6cbf]" />
            <h2 className="mt-3 text-xl font-semibold">Attempt finished</h2>
            <p className="mt-1 text-sm text-[#5b636b]">Score: <strong>{correctCount}/{questions.length}</strong> · {Math.round((correctCount / Math.max(questions.length, 1)) * 100)}%</p>
            {wrongQuestions.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-amber-800">{wrongQuestions.length} incorrect — re-attempt available</p>
                <Button type="button" className="rounded-md bg-[#0f6cbf] hover:bg-[#0c5aa3]" onClick={() => startReview()}><RotateCcw className="mr-2 h-4 w-4" /> Re-attempt now</Button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[#5b636b]">Perfect score. Generate a new quiz from Setup.</p>
            )}
          </div>
        )}

        {!mutation.isPending && questions.length === 0 && !mutation.isError && !showFinishSummary && (
          <div className="rounded border border-dashed border-[#cfd5dc] bg-white py-16 text-center shadow-sm">
            {hasWrongPending ? (
              <>
                <BookOpen className="mx-auto h-8 w-8 text-amber-600" />
                <p className="mt-3 text-sm text-[#5b636b]">{wrongQuestions.length} question(s) left to review.</p>
                <Button type="button" className="mt-4 rounded-md bg-[#0f6cbf] hover:bg-[#0c5aa3]" onClick={() => startReview()}>Start re-attempt</Button>
              </>
            ) : (
              <>
                <ListChecks className="mx-auto h-8 w-8 text-[#0f6cbf]" />
                <p className="mt-3 text-sm font-medium">No active attempt</p>
                <p className="mt-1 text-xs text-[#5b636b]">Open Setup, choose a topic, then click Start attempt.</p>
              </>
            )}
          </div>
        )}

        {hasActiveExam && currentQuestion && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-8">
            <div className="min-w-0 space-y-3 pb-24 lg:pb-0">
              {reviewMode && (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <strong>Re-attempt:</strong> answer correctly before moving on.
                </div>
              )}
              <article className="overflow-hidden rounded border border-[#d0d5dd] bg-white shadow-sm">
                <div className="flex items-center justify-between gap-2 border-b border-[#e8eaed] bg-[#f8f9fa] px-4 py-2.5 lg:px-7 lg:py-3.5">
                  <p className="text-sm font-semibold text-[#0f6cbf] lg:text-base">
                    Question {currentIndex + 1}<span className="font-normal text-[#5b636b]"> of {questions.length}</span>
                  </p>
                  <button
                    type="button"
                    className={cn("inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium", flagged[currentQuestion.question_number] ? "bg-amber-100 text-amber-800" : "text-[#5b636b] hover:bg-[#eef1f4]")}
                    onClick={() => setFlagged((f) => ({ ...f, [currentQuestion.question_number]: !f[currentQuestion.question_number] }))}
                  >
                    <Flag className="h-3.5 w-3.5" />
                    {flagged[currentQuestion.question_number] ? "Flagged" : "Flag"}
                  </button>
                </div>
                <div className="p-4 sm:p-5 lg:p-7 xl:p-8">
                  <p className="text-[15px] leading-relaxed sm:text-base lg:text-lg lg:leading-relaxed">{currentQuestion.question}</p>
                  <div className="mt-4 space-y-2 lg:space-y-2.5">
                    {currentQuestion.options.map((opt, i) => {
                      const letter = String.fromCharCode(65 + i);
                      const selected = answers[currentQuestion.question_number];
                      const isRevealed = !!revealed[currentQuestion.question_number];
                      const isSelected = selected === opt;
                      const isAnswer = isOptionCorrect(currentQuestion, opt);
                      return (
                        <button
                          key={i}
                          type="button"
                          disabled={isRevealed}
                          onClick={() => handleAnswer(currentQuestion, opt)}
                          className={cn(
                            "flex w-full items-start gap-3 rounded border px-3 py-3 text-left text-sm transition-colors lg:gap-4 lg:px-4 lg:py-3.5 lg:text-[15px] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6cbf]/40",
                            !isRevealed && "border-[#cfd5dc] hover:border-[#0f6cbf] hover:bg-[#f5f9fc]",
                            isSelected && !isRevealed && "border-[#0f6cbf] bg-[#e8f2fb]",
                            isRevealed && isAnswer && "border-emerald-600 bg-emerald-50",
                            isRevealed && isSelected && !isAnswer && "border-red-500 bg-red-50",
                            isRevealed && !isSelected && !isAnswer && "border-[#e8eaed] opacity-70",
                          )}
                        >
                          <span className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[9px] lg:h-6 lg:w-6",
                            isSelected && !isRevealed && "border-[#0f6cbf] bg-[#0f6cbf] text-white",
                            !isSelected && !isRevealed && "border-[#9aa3ad]",
                            isRevealed && isAnswer && "border-emerald-600 bg-emerald-600 text-white",
                            isRevealed && isSelected && !isAnswer && "border-red-500 bg-red-500 text-white",
                          )}>
                            {(isSelected || (isRevealed && isAnswer)) ? "●" : ""}
                          </span>
                          <span className="font-semibold text-[#5b636b]">{letter}.</span>
                          <span className="flex-1 leading-snug">{opt}</span>
                          {isRevealed && isAnswer && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
                          {isRevealed && isSelected && !isAnswer && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                        </button>
                      );
                    })}
                  </div>
                  {revealed[currentQuestion.question_number] && (
                    <div className={cn(
                      "mt-4 rounded border-l-4 px-3 py-3 text-sm lg:mt-5 lg:px-4 lg:py-4",
                      answers[currentQuestion.question_number] != null && isOptionCorrect(currentQuestion, answers[currentQuestion.question_number])
                        ? "border-l-emerald-600 bg-emerald-50"
                        : "border-l-amber-500 bg-amber-50",
                    )}>
                      <p className="text-xs font-bold uppercase tracking-wide">
                        {answers[currentQuestion.question_number] != null && isOptionCorrect(currentQuestion, answers[currentQuestion.question_number])
                          ? (reviewMode ? "Correct — removed from review" : "Correct")
                          : (reviewMode ? "Incorrect — try again" : `Correct answer: ${currentQuestion.correct_answer}`)}
                      </p>
                      {!(reviewMode && needsRetry) && <p className="mt-1.5 text-[13px] leading-relaxed lg:text-sm">{currentQuestion.explanation}</p>}
                      {reviewMode && needsRetry && (
                        <div className="mt-2 space-y-2">
                          <p className="text-[13px] leading-relaxed lg:text-sm">{currentQuestion.explanation}</p>
                          <Button type="button" size="sm" className="h-9 rounded-md bg-[#0f6cbf] hover:bg-[#0c5aa3]" onClick={retryCurrentQuestion}>
                            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Try again
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
              <div className="hidden items-center justify-between gap-4 rounded border border-[#d0d5dd] bg-white px-4 py-3 shadow-sm lg:flex xl:px-5">
                <Button type="button" variant="outline" className="h-11 min-w-[140px] rounded-md border-[#cfd5dc] px-5" disabled={isFirst || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}>
                  <ChevronLeft className="mr-1.5 h-4 w-4" /> Previous page
                </Button>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-sm font-medium text-[#1d2125]">Page {currentIndex + 1} of {questions.length}</span>
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-[#e8eaed] xl:w-56">
                    <div className="h-full rounded-full bg-[#0f6cbf] transition-all" style={{ width: `${((currentIndex + 1) / Math.max(questions.length, 1)) * 100}%` }} />
                  </div>
                </div>
                <Button type="button" variant="outline" className="h-11 min-w-[140px] rounded-md border-[#cfd5dc] px-5" disabled={isLast || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}>
                  Next page <ChevronRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </div>

            <aside className="lg:sticky lg:top-20 lg:self-start">
              <div className="rounded border border-[#d0d5dd] bg-white shadow-sm">
                <button type="button" className="flex w-full items-center justify-between border-b border-[#e8eaed] bg-[#f8f9fa] px-3 py-2.5 text-left text-sm font-semibold text-[#0f6cbf] lg:cursor-default" onClick={() => setNavOpen((o) => !o)}>
                  Quiz navigation
                  <span className="text-xs font-normal text-[#5b636b] lg:hidden">{navOpen ? "Hide" : "Show"}</span>
                </button>
                <div className={cn("p-3 lg:p-4", navOpen ? "block" : "hidden lg:block")}>
                  <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6 lg:grid-cols-5 lg:gap-2">
                    {questions.map((q, idx) => {
                      const st = navStatus(q, idx);
                      return (
                        <button
                          key={q.question_number}
                          type="button"
                          disabled={reviewMode && needsRetry && idx !== currentIndex}
                          onClick={() => { if (!(reviewMode && needsRetry)) setCurrentIndex(idx); }}
                          className={cn(
                            "relative flex h-9 items-center justify-center rounded border text-xs font-semibold lg:h-10 lg:text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6cbf]/40",
                            st === "current" && "border-[#0f6cbf] bg-[#0f6cbf] text-white ring-2 ring-[#0f6cbf]/30",
                            st === "answered" && "border-[#0f6cbf] bg-[#e8f2fb] text-[#0f6cbf]",
                            st === "correct" && "border-emerald-600 bg-emerald-600 text-white",
                            st === "incorrect" && "border-red-500 bg-red-500 text-white",
                            st === "flagged" && "border-amber-500 bg-amber-50 text-amber-800",
                            st === "todo" && "border-[#cfd5dc] bg-white hover:border-[#0f6cbf]",
                          )}
                        >
                          {idx + 1}
                          {flagged[q.question_number] && st !== "current" && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" />}
                        </button>
                      );
                    })}
                  </div>
                  <ul className="mt-3 space-y-1.5 border-t border-[#e8eaed] pt-3 text-[10px] text-[#5b636b] lg:text-[11px]">
                    <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-[#0f6cbf] bg-[#0f6cbf]" /> Current</li>
                    <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-[#0f6cbf] bg-[#e8f2fb]" /> Answered</li>
                    <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-[#cfd5dc] bg-white" /> Not yet answered</li>
                    <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-emerald-600 bg-emerald-600" /> Correct</li>
                    <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-red-500 bg-red-500" /> Incorrect</li>
                  </ul>
                  <p className="mt-3 text-center text-xs text-[#5b636b]">Score: <strong>{correctCount}/{questions.length}</strong></p>
                  <p className="mt-2 hidden text-center text-[10px] text-[#9aa3ad] lg:block">Click a number to jump · Flag questions to revisit</p>
                </div>
              </div>
            </aside>

            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#d0d5dd] bg-white/95 px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
              <div className="mx-auto flex max-w-7xl gap-2">
                <Button type="button" variant="outline" className="h-11 flex-1 rounded-md border-[#cfd5dc] text-sm" disabled={isFirst || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Prev
                </Button>
                <Button type="button" variant="outline" className="h-11 flex-1 rounded-md border-[#cfd5dc] text-sm" disabled={isLast || (reviewMode && needsRetry)} onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}>
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
