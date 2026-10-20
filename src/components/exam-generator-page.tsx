import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { generateExam, generateExamFromDocument, type ExamQuestion } from "@/lib/exam.functions";
import { extractDocumentText } from "@/lib/extract-document";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, RefreshCw, Settings2, ListChecks, Menu, Upload, FileText, X, MessageCircle } from "lucide-react";
import { ApiKeyPanel, type AiProvider } from "@/components/api-key-panel";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { MoodleNavState } from "@/components/moodle-quiz-ui";
import {
  loadWrongQuestions, saveWrongQuestions, loadSeenQuestions, saveSeenQuestions,
  isSimilarQuestion, isSimilarToAny, isOptionCorrect, MAX_SEEN_QUESTIONS,
} from "@/lib/exam-page-helpers";
import { toast } from "sonner";
import { ExamQuizBody } from "@/components/ExamQuizBody";

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

  useEffect(() => { setSeenQuestions(loadSeenQuestions()); }, []);

  const generateFn = useServerFn(generateExam);
  const generateDocFn = useServerFn(generateExamFromDocument);
  const docMode = docText.length > 0;

  const mutation = useMutation({
    mutationFn: async (count: number) => {
      const avoid = seenQuestions.slice(-60);
      if (docMode) {
        return generateDocFn({
          data: { apiKey, provider: aiProvider, documentName: docName || "Uploaded document", documentText: docText, difficulty, numQuestions: count, nonce: `${Date.now()}`, avoid },
        });
      }
      return generateFn({
        data: { apiKey, provider: aiProvider, topic: topic.trim(), difficulty, numQuestions: count, nonce: `${Date.now()}`, avoid },
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

  const correctCount = questions.filter((q) => answers[q.question_number] != null && isOptionCorrect(q, answers[q.question_number])).length;
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
    <div className="space-y-4">
      <ApiKeyPanel onKeyChange={(k, p) => { setApiKey(k); setAiProvider(p); }} />
      <div className="space-y-2">
        <Label htmlFor="topic">Topic</Label>
        <Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Computer parts" className="h-11 rounded-2xl border-border/80 bg-background text-base shadow-sm" disabled={docMode} />
      </div>
      <div className="space-y-2">
        <Label>Or upload a document</Label>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-2xl border border-dashed border-border bg-muted/40 px-3.5 text-xs font-medium transition hover:border-foreground/30 hover:bg-muted">
            <Upload className="h-3.5 w-3.5" />
            {docExtracting ? "Reading…" : "Upload PDF / DOCX / TXT"}
            <input type="file" className="sr-only" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain" disabled={docExtracting} onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
          </label>
          {docName && (
            <Button type="button" variant="outline" className="h-11 rounded-2xl text-xs" onClick={() => { setDocText(""); setDocName(""); setDocError(null); }}>
              <X className="mr-1 h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
        {docName && <p className="text-[11px] text-muted-foreground"><FileText className="mr-1 inline h-3 w-3" />{docName} · {Math.round(docText.length / 1000)}k chars</p>}
        {docError && <p className="text-xs text-destructive">{docError}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Difficulty</Label>
          <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
            <SelectTrigger className="h-11 rounded-2xl border-border/80 bg-background shadow-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Beginner">Beginner</SelectItem>
              <SelectItem value="Intermediate">Intermediate</SelectItem>
              <SelectItem value="Advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="nq">Questions</Label>
          <Input id="nq" value={numQuestionsText} onChange={(e) => setNumQuestionsText(e.target.value)} className="h-11 rounded-2xl border-border/80 bg-background text-base shadow-sm" inputMode="numeric" />
        </div>
      </div>
      <Button type="button" className="h-12 w-full rounded-2xl text-[15px] font-semibold shadow-md shadow-primary/15 transition active:scale-[0.99]" disabled={mutation.isPending || (!docMode && !topic.trim())} onClick={() => { run(); setSettingsOpen(false); }}>
        {mutation.isPending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>) : questions.length > 0 ? (<><RefreshCw className="mr-2 h-4 w-4" /> Start new attempt</>) : (<><Sparkles className="mr-2 h-4 w-4" /> Attempt quiz now</>)}
      </Button>
      {mutation.isError && <p className="text-xs text-destructive">{(mutation.error as Error)?.message || "Failed"}</p>}
      <a href="https://t.me/exitexamto" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl border border-[#229ED9]/30 bg-[#229ED9]/8 px-4 py-3.5 transition hover:bg-[#229ED9]/14 active:scale-[0.99]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#229ED9] text-white shadow-sm"><MessageCircle className="h-5 w-5" /></span>
        <span className="min-w-0 text-left">
          <span className="block text-sm font-semibold tracking-tight text-foreground">Join Telegram for support</span>
          <span className="block text-[11px] text-muted-foreground">@exitexamto — help, tips & updates</span>
        </span>
      </a>
    </div>
  );

  return (
    <div className="min-h-dvh w-full bg-background text-foreground selection:bg-primary/15">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-card/80 pt-[env(safe-area-inset-top)] shadow-[0_1px_0_0_rgba(0,0,0,0.03)] backdrop-blur-2xl supports-[backdrop-filter]:bg-card/70">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:px-5 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-1 ring-black/5">
              <ListChecks className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-[15px] font-semibold tracking-tight">
                {hasActiveQuiz || showSummary ? (docMode ? docName || topic || "Document quiz" : topic || "Quiz") : "Exit Exam Practice"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground/90">
                {phase === "attempt" ? `${difficulty} · Q${currentIndex + 1}/${questions.length}` : phase === "summary" ? "Summary of attempt" : phase === "review" ? `Review · ${correctCount}/${questions.length}` : "Moodle-style quiz"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {hasActiveQuiz && (
              <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border/80 bg-card/90 px-3.5 text-xs font-medium shadow-sm transition active:scale-[0.97] hover:bg-muted lg:hidden" onClick={() => setNavOpen(true)}>
                <Menu className="h-4 w-4" /> Nav
              </button>
            )}
            <a href="https://t.me/exitexamto" target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[#229ED9]/35 bg-[#229ED9]/10 px-3.5 text-xs font-medium text-foreground shadow-sm transition active:scale-[0.97] hover:bg-[#229ED9]/18" title="Join Telegram for support">
              <MessageCircle className="h-4 w-4 text-[#229ED9]" />
              <span className="hidden sm:inline">Support</span>
            </a>
            <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border/80 bg-card/90 px-3.5 text-xs font-medium shadow-sm transition active:scale-[0.97] hover:bg-muted" onClick={() => setSettingsOpen((o) => !o)}>
              <Settings2 className="h-4 w-4" /> Setup
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-5 sm:py-6 lg:px-6 lg:py-8">
        {settingsOpen && !hasActiveQuiz && !showSummary && (
          <section className="mb-5 overflow-hidden rounded-3xl border border-border/70 bg-card p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.02] sm:p-6 lg:p-8">
            <div className="mb-5">
              <h2 className="font-display text-lg font-semibold tracking-tight">Quiz setup</h2>
              <p className="mt-1 text-xs text-muted-foreground">Moodle deferred feedback — answer all, then submit.</p>
            </div>
            {setupFields}
          </section>
        )}

        <Sheet open={settingsOpen && (hasActiveQuiz || showSummary)} onOpenChange={setSettingsOpen}>
          <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-3xl border-border/60 lg:hidden">
            <SheetHeader className="text-left">
              <SheetTitle className="font-display">Quiz setup</SheetTitle>
              <SheetDescription>Change topic or start a new attempt</SheetDescription>
            </SheetHeader>
            <div className="mt-4 pb-[env(safe-area-inset-bottom)]">{setupFields}</div>
          </SheetContent>
        </Sheet>

        {settingsOpen && (hasActiveQuiz || showSummary) && (
          <section className="mb-5 hidden overflow-hidden rounded-3xl border border-border/70 bg-card p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.02] lg:block sm:p-6">
            <div className="mb-5">
              <h2 className="font-display text-lg font-semibold tracking-tight">Quiz setup</h2>
              <p className="mt-1 text-xs text-muted-foreground">Change topic or start a new attempt</p>
            </div>
            {setupFields}
          </section>
        )}

        {mutation.isPending && (
          <div className="flex flex-col items-center gap-3 py-20 sm:py-28" role="status">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
            <p className="font-display text-base font-semibold tracking-tight">Generating questions…</p>
            <p className="text-xs text-muted-foreground">Usually takes a few seconds</p>
          </div>
        )}

        {!mutation.isPending && questions.length === 0 && phase === "setup" && !settingsOpen && (
          <div className="rounded-3xl border border-dashed border-border/80 bg-card/50 px-4 py-16 text-center sm:py-20">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ListChecks className="h-6 w-6" />
            </span>
            <p className="mt-4 font-display text-base font-semibold tracking-tight">No active attempt</p>
            <p className="mx-auto mt-1.5 max-w-[220px] text-xs leading-relaxed text-muted-foreground">
              Open Setup, choose a topic or document, then start your quiz.
            </p>
          </div>
        )}

        <ExamQuizBody
          showSummary={showSummary}
          hasActiveQuiz={hasActiveQuiz}
          phase={phase}
          docMode={docMode}
          docName={docName}
          topic={topic}
          difficulty={difficulty}
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
          setPhase={setPhase}
          setCurrentIndex={setCurrentIndex}
          setNavOpen={setNavOpen}
          setFlagged={setFlagged}
          selectAnswer={selectAnswer}
          finishAttempt={finishAttempt}
          submitAllAndFinish={submitAllAndFinish}
          navState={navState}
          setSettingsOpen={setSettingsOpen}
        />
      </div>
    </div>
  );
}
