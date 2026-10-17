import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { generateExam, generateExamFromDocument, type ExamQuestion } from "@/lib/exam.functions";
import { extractDocumentText } from "@/lib/extract-document";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, RefreshCw, ChevronLeft, ChevronRight, Settings2, ListChecks, Menu, Upload, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiKeyPanel, type AiProvider } from "@/components/api-key-panel";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { toast } from "sonner";

type Difficulty = "Beginner" | "Intermediate" | "Advanced";
type QuizPhase = "setup" | "attempt" | "summary" | "review";

export function ExamGeneratorPage() {
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Beginner");
  const [numQuestionsText, setNumQuestionsText] = useState("5");
  const [docName, setDocName] = useState("");
  const [docText, setDocText] = useState("");
  const [docExtracting, setDocExtracting] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider>("gemini");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<QuizPhase>("setup");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const [seenQuestions, setSeenQuestions] = useState<string[]>([]);
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  useEffect(() => {
    setSeenQuestions(loadSeenQuestions());
  }, []);

  const generateFn = useServerFn(generateExam);
  const generateDocFn = useServerFn(generateExamFromDocument);
  const docMode = docText.length > 0;

  const mutation = useMutation({
    mutationFn: async (count: number) => {
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
        setSettingsOpen(false);
        setNavOpen(false);
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
    },
  });

  const questions: ExamQuestion[] = useMemo(
    () => (mutation.data?.questions ?? []).map((q, i) => ({ ...q, question_number: i + 1 })),
    [mutation.data?.questions],
  );

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setDocError(null);
    setDocExtracting(true);
    try {
      const text = await extractDocumentText(file);
      if (!text || text.length < 20) throw new Error("Couldn't extract readable text from this file.");
      setDocText(text.length > 190000 ? text.slice(0, 190000) : text);
      setDocName(file.name);
      toast.success(`Loaded ${file.name}`);
    } catch (e) {
      setDocError((e as Error).message || "Failed to read document.");
      setDocText("");
      setDocName("");
    } finally {
      setDocExtracting(false);
    }
  };

  const run = useCallback(() => {
    if (!docMode && !topic.trim()) return;
    let n = parseInt(numQuestionsText, 10);
    if (Number.isNaN(n) || n < 1) n = 1;
    if (n > 200) n = 200;
    mutation.mutate(n);
  }, [docMode, topic, numQuestionsText, mutation]);

  const selectAnswer = (q: ExamQuestion, opt: string) => {
    if (phase !== "attempt") return;
    setAnswers((a) => ({ ...a, [q.question_number]: opt }));
  };

  const finishAttempt = () => {
    setPhase("summary");
    setConfirmSubmit(false);
    setSettingsOpen(false);
  };

  const submitAllAndFinish = () => {
    const wrong: ExamQuestion[] = [];
    for (const q of questions) {
      const selected = answers[q.question_number];
      if (!selected || !isOptionCorrect(q, selected)) wrong.push(q);
    }
    if (wrong.length) {
      const prev = loadWrongQuestions();
      const merged = [...prev];
      for (const q of wrong) {
        if (!merged.some((w) => isSimilarQuestion(w.question, q.question))) merged.push(q);
      }
      saveWrongQuestions(merged.map((q, i) => ({ ...q, question_number: i + 1 })));
    }
    setPhase("review");
    setConfirmSubmit(false);
    setCurrentIndex(0);
    setSettingsOpen(false);
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

  const setupFields = (
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
          placeholder="e.g. Computer parts"
          className="h-11 rounded-xl text-base"
          disabled={docMode}
        />
      </div>
      <div className="space-y-2">
        <Label>Or upload a document</Label>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-medium hover:bg-muted">
            <Upload className="h-3.5 w-3.5" />
            {docExtracting ? "Reading…" : "Upload PDF / DOCX / TXT"}
            <input
              type="file"
              className="sr-only"
              accept=".pdf,.docx,.txt,.md,application/pdf,text/plain"
              disabled={docExtracting}
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {docName && (
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl text-xs"
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
            {docName} · {Math.round(docText.length / 1000)}k chars
          </p>
        )}
        {docError && <p className="text-xs text-destructive">{docError}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Difficulty</Label>
          <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
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
          <Label htmlFor="nq">Questions</Label>
          <Input
            id="nq"
            value={numQuestionsText}
            onChange={(e) => setNumQuestionsText(e.target.value)}
            className="h-11 rounded-xl text-base"
            inputMode="numeric"
          />
        </div>
      </div>
      <Button
        type="button"
        className="h-12 w-full rounded-xl text-[15px] font-semibold"
        disabled={mutation.isPending || (!docMode && !topic.trim())}
        onClick={() => {
          run();
          setSettingsOpen(false);
        }}
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
      {mutation.isError && (
        <p className="text-xs text-destructive">{(mutation.error as Error)?.message || "Failed"}</p>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh w-full bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/80 bg-card/90 pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ListChecks className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {hasActiveQuiz || showSummary ? (docMode ? docName || topic || "Document quiz" : topic || "Quiz") : "Exit Exam Practice"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {phase === "attempt"
                  ? `${difficulty} · Q${currentIndex + 1}/${questions.length}`
                  : phase === "summary"
                    ? "Summary of attempt"
                    : phase === "review"
                      ? `Review · ${correctCount}/${questions.length}`
                      : "Moodle-style quiz"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {hasActiveQuiz && (
              <button
                type="button"
                className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium lg:hidden"
                onClick={() => setNavOpen(true)}
              >
                <Menu className="h-4 w-4" />
                Nav
              </button>
            )}
            <button
              type="button"
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <Settings2 className="h-4 w-4" />
              Setup
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-5">
        {settingsOpen && !hasActiveQuiz && !showSummary && (
          <section className="mb-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">Quiz setup</h2>
            {setupFields}
          </section>
        )}

        <Sheet open={settingsOpen && (hasActiveQuiz || showSummary)} onOpenChange={setSettingsOpen}>
          <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl lg:hidden">
            <SheetHeader className="text-left">
              <SheetTitle>Quiz setup</SheetTitle>
              <SheetDescription>Change topic or start a new attempt</SheetDescription>
            </SheetHeader>
            <div className="mt-4 pb-[env(safe-area-inset-bottom)]">{setupFields}</div>
          </SheetContent>
        </Sheet>

        {settingsOpen && (hasActiveQuiz || showSummary) && (
          <section className="mb-4 hidden overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm lg:block">
            <h2 className="mb-3 text-sm font-semibold">Quiz setup</h2>
            {setupFields}
          </section>
        )}

        {mutation.isPending && (
          <div className="flex flex-col items-center gap-3 py-20" role="status">
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
            <p className="text-sm font-medium">Generating questions…</p>
          </div>
        )}

        {!mutation.isPending && questions.length === 0 && phase === "setup" && !settingsOpen && (
          <div className="rounded-2xl border border-dashed border-border px-4 py-16 text-center">
            <p className="text-sm font-semibold">No active attempt</p>
            <p className="mt-1 text-xs text-muted-foreground">Tap Setup to start a quiz</p>
          </div>
        )}

        {showSummary && (
          <div className="space-y-4 pb-8">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="border-b border-border/80 bg-muted/30 px-4 py-3">
                <h2 className="text-base font-semibold">Summary of attempt</h2>
                <p className="text-xs text-muted-foreground">{docMode ? docName || topic : topic}</p>
              </div>
              <div className="grid grid-cols-3 gap-3 p-4">
                <div className="rounded-xl border border-border bg-muted/20 py-3 text-center">
                  <p className="text-2xl font-semibold tabular-nums">{questions.length}</p>
                  <p className="text-[11px] text-muted-foreground">Questions</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 py-3 text-center">
                  <p className="text-2xl font-semibold tabular-nums text-emerald-600">{answeredCount}</p>
                  <p className="text-[11px] text-muted-foreground">Answered</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 py-3 text-center">
                  <p className="text-2xl font-semibold tabular-nums text-amber-600">{notAnsweredCount}</p>
                  <p className="text-[11px] text-muted-foreground">Not answered</p>
                </div>
              </div>
            </div>
            {confirmSubmit ? (
              <div className="space-y-3 rounded-2xl border border-destructive/40 bg-card p-4">
                <p className="text-sm font-semibold">Submit this attempt?</p>
                <p className="text-xs text-muted-foreground">You will see correct answers and feedback.</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button className="h-12 flex-1 rounded-xl font-semibold" onClick={submitAllAndFinish}>
                    Submit and view results
                  </Button>
                  <Button variant="outline" className="h-12 flex-1 rounded-xl" onClick={() => setConfirmSubmit(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" className="h-12 flex-1 rounded-xl" onClick={() => setPhase("attempt")}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Return to attempt
                </Button>
                <Button className="h-12 flex-1 rounded-xl font-semibold" onClick={() => setConfirmSubmit(true)}>
                  Submit all and finish
                </Button>
              </div>
            )}
          </div>
        )}

        {hasActiveQuiz && currentQuestion && (
          <div className="pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-4">
            {phase === "review" && (
              <div className="mb-3 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="border-b border-border/80 bg-muted/30 px-4 py-3">
                  <h2 className="text-base font-semibold">Your results</h2>
                  <p className="text-xs text-muted-foreground">{docMode ? docName || "Document quiz" : topic || "Quiz"} · {difficulty}</p>
                </div>
                <div className="flex flex-col items-center gap-1 px-4 py-5">
                  <p className="text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
                    {scorePercent}%
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {correctCount}/{questions.length}
                    </span>{" "}
                    correct
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 border-t border-border/80 p-3 sm:gap-3 sm:p-4">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-center">
                    <p className="text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {correctCount}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Correct</p>
                  </div>
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 py-2.5 text-center">
                    <p className="text-xl font-semibold tabular-nums text-red-700 dark:text-red-400">
                      {incorrectCount}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Incorrect</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 py-2.5 text-center">
                    <p className="text-xl font-semibold tabular-nums">{questions.length}</p>
                    <p className="text-[11px] text-muted-foreground">Total</p>
                  </div>
                </div>
              </div>
            )}
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
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
                  <p className="text-[15px] leading-relaxed sm:text-base">{currentQuestion.question}</p>
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
                </div>
              </div>
            </div>

            <div className="mt-3 hidden rounded-xl border border-border bg-card p-3 lg:block">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Quiz navigation</p>
              <div className="flex flex-wrap gap-1.5">
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
            </div>

            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/80 bg-card/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl lg:static lg:mt-3 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <div className="mx-auto flex max-w-3xl gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 flex-1 rounded-xl lg:h-11"
                  disabled={isFirst}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" /> Prev
                </Button>
                {!isLast ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 flex-1 rounded-xl lg:h-11"
                    onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                  >
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : phase === "attempt" ? (
                  <Button type="button" className="h-12 flex-1 rounded-xl font-semibold lg:h-11" onClick={finishAttempt}>
                    Finish attempt
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 flex-1 rounded-xl lg:h-11"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Done
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        <Sheet open={navOpen && hasActiveQuiz} onOpenChange={setNavOpen}>
          <SheetContent side="bottom" className="max-h-[70dvh] overflow-y-auto rounded-t-2xl lg:hidden">
            <SheetHeader className="text-left">
              <SheetTitle>Quiz navigation</SheetTitle>
              <SheetDescription>
                {phase === "review"
                  ? `Score ${correctCount}/${questions.length}`
                  : `${answeredCount} of ${questions.length} answered`}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 flex flex-wrap gap-2 pb-[env(safe-area-inset-bottom)]">
              {questions.map((q, idx) => (
                <MoodleNavButton
                  key={q.question_number}
                  number={idx + 1}
                  state={navState(q)}
                  flagged={!!flagged[q.question_number]}
                  isCurrent={idx === currentIndex}
                  onClick={() => {
                    setCurrentIndex(idx);
                    setNavOpen(false);
                  }}
                />
              ))}
            </div>
            {phase === "attempt" && (
              <Button
                type="button"
                className="mt-4 h-11 w-full rounded-xl font-semibold"
                onClick={() => {
                  setNavOpen(false);
                  finishAttempt();
                }}
              >
                Finish attempt…
              </Button>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
