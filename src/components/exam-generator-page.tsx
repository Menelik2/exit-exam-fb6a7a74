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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiKeyPanel, type AiProvider } from "@/components/api-key-panel";
import { downloadExamPdf } from "@/lib/exam-pdf";

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

const WRONG_STORAGE_KEY = "exam-generator-wrong-questions";

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
  } catch {
    // ignore quota errors
  }
}

function questionKey(q: ExamQuestion) {
  return q.question.trim().toLowerCase().replace(/\s+/g, " ");
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

  // Load saved wrong questions on mount
  useEffect(() => {
    setWrongQuestions(loadWrongQuestions());
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
        },
      });
    },
    onSuccess: () => {
      setAnswers({});
      setRevealed({});
      setCurrentIndex(0);
      setReviewMode(false);
      setReviewQuestions([]);
    },
  });

  // Active list: either review queue or freshly generated questions
  const questions: ExamQuestion[] = reviewMode
    ? reviewQuestions
    : (mutation.data?.questions ?? []);

  // Keep index in bounds if questions change
  useEffect(() => {
    if (questions.length === 0) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex >= questions.length) {
      setCurrentIndex(questions.length - 1);
    }
  }, [questions.length, currentIndex]);

  const run = useCallback(() => {
    if (!docMode && !topic.trim()) return;
    if (numQuestions < 1) return;
    // Only allow generating new questions when all wrong ones are cleared
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
      if (!text || text.length < 20) {
        throw new Error("Couldn't extract readable text from this file.");
      }
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

  const startReview = () => {
    if (wrongQuestions.length === 0) return;
    // Renumber for display
    const renumbered = wrongQuestions.map((q, i) => ({
      ...q,
      question_number: i + 1,
    }));
    setReviewQuestions(renumbered);
    setReviewMode(true);
    setAnswers({});
    setRevealed({});
    setCurrentIndex(0);
  };

  const clearAllWrong = () => {
    persistWrong([]);
    if (reviewMode) {
      setReviewMode(false);
      setReviewQuestions([]);
      setAnswers({});
      setRevealed({});
      setCurrentIndex(0);
    }
  };

  const handleAnswer = (q: ExamQuestion, opt: string) => {
    const qNum = q.question_number;
    setAnswers((a) => ({ ...a, [qNum]: opt }));
    setRevealed((r) => ({ ...r, [qNum]: true }));

    const isCorrect = opt === q.correct_answer;
    const key = questionKey(q);

    if (!isCorrect) {
      // Save wrong question (avoid duplicates by question text)
      const already = wrongQuestions.some((w) => questionKey(w) === key);
      if (!already) {
        persistWrong([...wrongQuestions, { ...q, question_number: wrongQuestions.length + 1 }]);
      }
    } else {
      // Answered correctly → remove from wrong list
      const remaining = wrongQuestions.filter((w) => questionKey(w) !== key);
      if (remaining.length !== wrongQuestions.length) {
        persistWrong(remaining);
      }

      // If in review mode, also remove from current review queue
      if (reviewMode) {
        setReviewQuestions((prev) => {
          const next = prev.filter((w) => questionKey(w) !== key);
          // Renumber remaining
          const renumbered = next.map((item, i) => ({
            ...item,
            question_number: i + 1,
          }));
          // Adjust index if needed
          setCurrentIndex((idx) => {
            if (renumbered.length === 0) return 0;
            return Math.min(idx, renumbered.length - 1);
          });
          // If all reviewed correctly, exit review mode
          if (renumbered.length === 0) {
            setReviewMode(false);
            setAnswers({});
            setRevealed({});
          }
          return renumbered;
        });
        // Clear answer state for removed question numbers is handled by renumbering
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

  return (
    <div className="min-h-screen w-full bg-background text-foreground p-3 sm:p-6 lg:p-8">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[380px_1fr] lg:gap-8">
        <aside className="flex h-fit flex-col gap-6 rounded-3xl border border-border bg-secondary/60 p-6 sm:p-7 lg:sticky lg:top-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold tracking-tight">Exam Generator</h1>
              <p className="text-xs text-muted-foreground">AI MCQ drafting</p>
            </div>
          </div>

          <ApiKeyPanel
            onKeyChange={(key, provider) => {
              setApiKey(key);
              setAiProvider(provider);
            }}
          />

          <div className="space-y-4">
            {/* Wrong questions review panel */}
            {hasWrongPending && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/30 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <BookOpen className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                      {wrongQuestions.length} wrong question{wrongQuestions.length !== 1 ? "s" : ""} saved
                    </p>
                    <p className="text-[11px] leading-relaxed text-amber-800/80 dark:text-amber-200/70 mt-0.5">
                      Review and answer them correctly to unlock generating new questions.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1 h-9 rounded-xl text-xs font-semibold"
                    onClick={startReview}
                    disabled={reviewMode && reviewQuestions.length > 0}
                  >
                    <BookOpen className="mr-1.5 h-3.5 w-3.5" />
                    {reviewMode ? "Reviewing…" : "Review mistakes"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-xl text-xs"
                    onClick={clearAllWrong}
                    title="Clear all saved wrong questions"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Source document (optional)
              </Label>
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md,application/pdf,text/plain"
                className="hidden"
                id="doc-upload"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              {!docMode ? (
                <button
                  type="button"
                  onClick={() => document.getElementById("doc-upload")?.click()}
                  disabled={docExtracting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-60"
                >
                  {docExtracting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Reading…
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" /> Upload PDF, DOCX, or TXT
                    </>
                  )}
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{docName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {docText.length.toLocaleString()} chars
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDocText("");
                      setDocName("");
                      setDocError(null);
                    }}
                    className="rounded-md p-1 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Works best with text-based PDFs, DOCX, or TXT (lecture notes, past papers).
                Scanned images and password-protected files aren't supported.
              </p>
              {docError && <p className="text-xs text-destructive">{docError}</p>}
            </div>

            {!docMode && (
              <div className="space-y-2">
                <Label
                  htmlFor="topic"
                  className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Topic
                </Label>
                <Input
                  id="topic"
                  placeholder="e.g. Data Structures"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="h-11 rounded-xl"
                  disabled={hasWrongPending}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Difficulty
                </Label>
                <Select
                  value={difficulty}
                  onValueChange={(v) => setDifficulty(v as Difficulty)}
                  disabled={hasWrongPending}
                >
                  <SelectTrigger className="h-11 rounded-xl">
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
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Questions
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={numQuestions}
                  onChange={(e) =>
                    setNumQuestions(Math.min(200, Math.max(1, parseInt(e.target.value, 10) || 1)))
                  }
                  className="h-11 rounded-xl"
                  disabled={hasWrongPending}
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-card/70 p-4">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Auto-generate
              </span>
              <Switch
                checked={autoGenerate}
                onCheckedChange={setAutoGenerate}
                disabled={hasWrongPending}
              />
            </label>

            <Button
              type="button"
              onClick={run}
              disabled={
                mutation.isPending ||
                docExtracting ||
                (!docMode && !topic.trim()) ||
                !canGenerateNew
              }
              className="h-12 w-full rounded-2xl font-semibold"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                </>
              ) : !canGenerateNew ? (
                <>
                  <BookOpen className="mr-2 h-4 w-4" /> Review mistakes first
                </>
              ) : questions.length > 0 && !reviewMode ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" /> Regenerate
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" /> Generate exam
                </>
              )}
            </Button>

            {questions.length > 0 && !reviewMode && (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full rounded-xl text-xs font-bold uppercase tracking-widest"
                onClick={() =>
                  downloadExamPdf(questions, {
                    title: docMode ? docName : topic.trim() || "Generated exam",
                    difficulty,
                  })
                }
              >
                <Download className="mr-2 h-4 w-4" /> Download PDF
              </Button>
            )}

            {questions.length > 0 && (
              <p className="text-center text-sm text-muted-foreground">
                {reviewMode ? "Review" : "Score"}: {correctCount}/{questions.length}
              </p>
            )}
          </div>
        </aside>

        <main className="flex flex-col gap-5">
          {mutation.isError && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {(mutation.error as Error).message}
            </div>
          )}

          {mutation.isPending && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-border bg-card py-24 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="text-sm">Drafting your exam…</p>
            </div>
          )}

          {!mutation.isPending && questions.length === 0 && !mutation.isError && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-border bg-card py-24 text-center text-muted-foreground">
              {hasWrongPending ? (
                <>
                  <BookOpen className="h-5 w-5 text-amber-600" />
                  <p className="text-sm max-w-sm">
                    You have {wrongQuestions.length} saved wrong question
                    {wrongQuestions.length !== 1 ? "s" : ""}. Review and answer them correctly to
                    unlock generating new questions.
                  </p>
                  <Button type="button" className="mt-2 rounded-xl" onClick={startReview}>
                    <BookOpen className="mr-2 h-4 w-4" /> Review mistakes
                  </Button>
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5 text-primary" />
                  <p className="text-sm">
                    {docMode
                      ? "Click Generate exam to create questions from your document."
                      : "Set a topic and click Generate exam."}
                  </p>
                </>
              )}
            </div>
          )}

          {!mutation.isPending && currentQuestion && (
            <>
              {/* Mode badge */}
              {reviewMode && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-2.5 text-sm text-amber-900 dark:text-amber-100">
                  <span className="font-semibold">Review mode</span> — answer correctly to remove
                  from your mistake list. Once all are correct, you can generate new questions.
                </div>
              )}

              {/* Progress indicator */}
              <div className="flex items-center justify-between px-1">
                <p className="text-sm font-medium text-muted-foreground">
                  {reviewMode ? "Review" : "Question"} {currentIndex + 1} of {questions.length}
                </p>
                <div className="flex h-2 flex-1 mx-4 max-w-[200px] overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{
                      width: `${((currentIndex + 1) / questions.length) * 100}%`,
                    }}
                  />
                </div>
              </div>

              {/* Single question card */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Question {currentQuestion.question_number}
                  {reviewMode && (
                    <span className="ml-2 text-amber-600">· previously missed</span>
                  )}
                </p>
                <p className="mb-4 text-base leading-relaxed">{currentQuestion.question}</p>
                <div className="space-y-2">
                  {currentQuestion.options.map((opt, i) => {
                    const letter = String.fromCharCode(65 + i);
                    const selected = answers[currentQuestion.question_number];
                    const isRevealed = revealed[currentQuestion.question_number];
                    const isSelected = selected === opt;
                    const isAnswer = opt === currentQuestion.correct_answer;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={isRevealed}
                        onClick={() => handleAnswer(currentQuestion, opt)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                          "border-border hover:border-foreground",
                          isSelected && !isRevealed && "border-foreground bg-secondary",
                          isRevealed && isAnswer && "border-emerald-600 bg-emerald-50",
                          isRevealed && isSelected && !isAnswer && "border-destructive bg-red-50",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                            isRevealed &&
                              isAnswer &&
                              "border-emerald-700 bg-emerald-700 text-white",
                            isRevealed &&
                              isSelected &&
                              !isAnswer &&
                              "border-destructive bg-destructive text-white",
                          )}
                        >
                          {letter}
                        </span>
                        <span className="flex-1 pt-0.5 text-sm">{opt}</span>
                        {isRevealed && isAnswer && (
                          <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                        )}
                        {isRevealed && isSelected && !isAnswer && (
                          <XCircle className="h-5 w-5 text-destructive" />
                        )}
                      </button>
                    );
                  })}
                </div>
                {revealed[currentQuestion.question_number] && (
                  <div
                    className={cn(
                      "mt-4 rounded-xl border-l-4 bg-secondary/60 p-4",
                      answers[currentQuestion.question_number] ===
                        currentQuestion.correct_answer
                        ? "border-emerald-700"
                        : "border-amber-600",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                      <Info className="h-3.5 w-3.5" />
                      {answers[currentQuestion.question_number] ===
                      currentQuestion.correct_answer
                        ? reviewMode
                          ? "Correct — removed from mistakes"
                          : "Correct"
                        : `Answer: ${currentQuestion.correct_answer}`}
                    </div>
                    <p className="text-sm leading-relaxed">{currentQuestion.explanation}</p>
                  </div>
                )}
              </div>

              {/* Previous / Next navigation */}
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl px-5"
                  disabled={isFirst}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="mr-1.5 h-4 w-4" />
                  Previous
                </Button>

                <span className="text-xs text-muted-foreground tabular-nums">
                  {currentIndex + 1} / {questions.length}
                </span>

                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl px-5"
                  disabled={isLast}
                  onClick={() =>
                    setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))
                  }
                >
                  Next
                  <ChevronRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
