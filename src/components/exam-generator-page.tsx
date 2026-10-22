import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
/** Match Tailwind lg breakpoint — Setup sheet is mobile-only below this. */
function useIsLgUp() {
  const [isLg, setIsLg] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsLg(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return isLg;
}
import type { ExamQuestion } from "@/lib/exam.functions";
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
  isOptionCorrect,
} from "@/lib/exam-page-helpers";
import { toast } from "sonner";
import { ExamQuizBody } from "@/components/ExamQuizBody";

export function ExamGeneratorPage() {
  const isLgUp = useIsLgUp();
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("Intermediate");
  const [numQuestions, setNumQuestions] = useState(10);
  const [apiKey, setApiKey] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider>("gemini");
  const [docText, setDocText] = useState("");
  const [docName, setDocName] = useState("");
  const [docError, setDocError] = useState("");
  const [docExtracting, setDocExtracting] = useState(false);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<"setup" | "attempt" | "summary" | "review">("setup");
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const [navOpen, setNavOpen] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const docMode = docText.trim().length > 40;

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        topic: topic.trim() || undefined,
        difficulty,
        numQuestions,
        documentText: docMode ? docText : undefined,
      };
      if (apiKey) {
        body.apiKey = apiKey;
        body.provider = aiProvider;
      }
      const res = await fetch("/api/generate-exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || "Failed to generate exam");
      const qs = data?.questions || data?.exam?.questions;
      if (!Array.isArray(qs) || qs.length === 0) throw new Error("No questions returned");
      return qs as ExamQuestion[];
    },
    onSuccess: (qs) => {
      setQuestions(qs.map((q, i) => ({ ...q, question_number: q.question_number ?? i + 1 })));
      setAnswers({});
      setCurrentIndex(0);
      setPhase("attempt");
      setFlagged({});
      setConfirmSubmit(false);
      setSettingsOpen(false);
      toast.success(`Generated ${qs.length} questions`);
    },
    onError: (e: Error) => toast.error(e.message || "Generation failed"),
  });

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setDocError("");
    setDocExtracting(true);
    try {
      const text = await extractDocumentText(file);
      if (!text || text.trim().length < 40) throw new Error("Could not extract enough text from this file");
      setDocText(text);
      setDocName(file.name);
      toast.success("Document loaded");
    } catch (e) {
      setDocError((e as Error).message || "Failed to read file");
      setDocText("");
      setDocName("");
    } finally {
      setDocExtracting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clearDoc = () => {
    setDocText("");
    setDocName("");
    setDocError("");
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
            {docExtracting ? "Reading…" : "Upload PDF / DOCX / DOC / TXT"}
            <input type="file" className="sr-only" accept=".pdf,.docx,.doc,.txt,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={docExtracting} onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
          </label>
          {docName && (
            <Button type="button" variant="outline" className="h-11 rounded-2xl" onClick={clearDoc}>
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
          <Select value={difficulty} onValueChange={setDifficulty}>
            <SelectTrigger className="h-11 rounded-2xl border-border/80 bg-background shadow-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Beginner">Beginner</SelectItem>
              <SelectItem value="Intermediate">Intermediate</SelectItem>
              <SelectItem value="Advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Questions</Label>
          <Select value={String(numQuestions)} onValueChange={(v) => setNumQuestions(Number(v))}>
            <SelectTrigger className="h-11 rounded-2xl border-border/80 bg-background shadow-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[5, 10, 15, 20, 25, 30, 40, 50].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        type="button"
        className="h-12 w-full rounded-2xl text-sm font-semibold"
        disabled={mutation.isPending || (!docMode && !topic.trim())}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>) : questions.length > 0 ? (<><RefreshCw className="mr-2 h-4 w-4" /> Start new attempt</>) : (<><Sparkles className="mr-2 h-4 w-4" /> Attempt quiz now</>)}
      </Button>
    </div>
  );

  return (
    <div className="min-h-dvh w-full bg-background text-foreground selection:bg-primary/15">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-card/80 pt-[env(safe-area-inset-top)] shadow-[0_1px_0_0_rgba(0,0,0,0.03)] backdrop-blur-2xl supports-[backdrop-filter]:bg-card/70">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:px-5 lg:px-6">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-3 rounded-2xl outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Back to homepage"
          >
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
          </Link>
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
            <button
              type="button"
              aria-pressed={settingsOpen}
              className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium shadow-sm transition active:scale-[0.97] ${
                settingsOpen
                  ? "border-foreground/30 bg-muted"
                  : "border-border/80 bg-card/90 hover:bg-muted"
              }`}
              onClick={() => {
                setSettingsOpen((o) => {
                  const next = !o;
                  if (next && typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
                    requestAnimationFrame(() => {
                      document.getElementById("quiz-setup-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }
                  return next;
                });
              }}
            >
              <Settings2 className="h-4 w-4" /> Setup
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-5 sm:py-6 lg:px-6 lg:py-8">
        {!hasActiveQuiz && !showSummary && settingsOpen && (
          <section id="quiz-setup-panel" className="mb-5 overflow-hidden rounded-3xl border border-border/70 bg-card p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.02] sm:p-6">
            <div className="mb-5">
              <h2 className="font-display text-lg font-semibold tracking-tight">Quiz setup</h2>
              <p className="mt-1 text-xs text-muted-foreground">Pick a topic or upload a document, then generate questions</p>
            </div>
            {setupFields}
          </section>
        )}

        <Sheet open={settingsOpen && (hasActiveQuiz || showSummary) && !isLgUp} onOpenChange={setSettingsOpen}>
          <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-3xl border-border/60 lg:hidden">
            <SheetHeader className="text-left">
              <SheetTitle className="font-display">Quiz setup</SheetTitle>
              <SheetDescription>Change topic or start a new attempt</SheetDescription>
            </SheetHeader>
            <div className="mt-4 pb-[env(safe-area-inset-bottom)]">{setupFields}</div>
          </SheetContent>
        </Sheet>

        {settingsOpen && (hasActiveQuiz || showSummary) && isLgUp && (
          <section id="quiz-setup-panel" className="mb-5 overflow-hidden rounded-3xl border border-border/70 bg-card p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.02] sm:p-6 lg:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">Quiz setup</h2>
                <p className="mt-1 text-xs text-muted-foreground">Change topic or start a new attempt</p>
              </div>
              <button type="button" className="shrink-0 rounded-full border border-border/80 px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={() => setSettingsOpen(false)}>Close</button>
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

        {!mutation.isPending && (hasActiveQuiz || showSummary) && (
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
            setPhase={(p) => setPhase(p as "attempt" | "summary" | "review")}
            setCurrentIndex={setCurrentIndex}
            setNavOpen={setNavOpen}
            setFlagged={setFlagged}
            selectAnswer={selectAnswer}
            finishAttempt={finishAttempt}
            submitAllAndFinish={submitAllAndFinish}
            navState={navState}
            setSettingsOpen={setSettingsOpen}
          />
        )}
      </div>
    </div>
  );
}
