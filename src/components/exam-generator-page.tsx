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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiKeyPanel, type AiProvider } from "@/components/api-key-panel";
import { downloadExamPdf } from "@/lib/exam-pdf";

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

export function ExamGeneratorPage() {
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Intermediate");
  const [numQuestions, setNumQuestions] = useState(5);
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProvider>("openrouter");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [docName, setDocName] = useState("");
  const [docText, setDocText] = useState("");
  const [docExtracting, setDocExtracting] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

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
    },
  });

  const questions: ExamQuestion[] = mutation.data?.questions ?? [];

  const run = useCallback(() => {
    if (!docMode && !topic.trim()) return;
    if (numQuestions < 1) return;
    mutation.mutate();
  }, [docMode, topic, numQuestions, mutation]);

  useEffect(() => {
    if (!autoGenerate) return;
    if (!docMode && !topic.trim()) return;
    // OpenRouter can use server env key; other providers need a browser key
    if (!apiKey && aiProvider !== "openrouter") return;
    const t = setTimeout(() => run(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, difficulty, numQuestions, autoGenerate, aiProvider, apiKey, docMode]);

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

  const correctCount = useMemo(
    () =>
      questions.filter(
        (q) => revealed[q.question_number] && answers[q.question_number] === q.correct_answer,
      ).length,
    [questions, revealed, answers],
  );

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
              <p className="text-xs text-muted-foreground">OpenRouter · AI MCQ drafting</p>
            </div>
          </div>

          <ApiKeyPanel
            onKeyChange={(key, provider) => {
              setApiKey(key);
              setAiProvider(provider);
            }}
          />

          <div className="space-y-4">
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
                    <p className="text-[10px] text-muted-foreground">{docText.length.toLocaleString()} chars</p>
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
              {docError && <p className="text-xs text-destructive">{docError}</p>}
            </div>

            {!docMode && (
              <div className="space-y-2">
                <Label htmlFor="topic" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Topic
                </Label>
                <Input
                  id="topic"
                  placeholder="e.g. Data Structures"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Difficulty</Label>
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
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Questions</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={numQuestions}
                  onChange={(e) => setNumQuestions(Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className="h-11 rounded-xl"
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-card/70 p-4">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Auto-generate
              </span>
              <Switch checked={autoGenerate} onCheckedChange={setAutoGenerate} />
            </label>

            <Button
              type="button"
              onClick={run}
              disabled={mutation.isPending || docExtracting || (!docMode && !topic.trim())}
              className="h-12 w-full rounded-2xl font-semibold"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…
                </>
              ) : questions.length > 0 ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" /> Regenerate
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" /> Generate exam
                </>
              )}
            </Button>

            {questions.length > 0 && (
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
                Score: {correctCount}/{questions.length}
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
              <p className="text-sm">Drafting your exam via OpenRouter…</p>
            </div>
          )}

          {!mutation.isPending && questions.length === 0 && !mutation.isError && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-border bg-card py-24 text-center text-muted-foreground">
              <Sparkles className="h-5 w-5 text-primary" />
              <p className="text-sm">Set a topic and click Generate exam.</p>
              <p className="max-w-sm text-xs">
                Provider defaults to <strong>OpenRouter</strong>. Paste a key in the panel, or set{" "}
                <code className="rounded bg-muted px-1">OPENROUTER_API_KEY</code> on the server.
              </p>
            </div>
          )}

          {!mutation.isPending &&
            questions.map((q) => {
              const selected = answers[q.question_number];
              const isRevealed = revealed[q.question_number];
              const isCorrect = selected === q.correct_answer;
              return (
                <div
                  key={q.question_number}
                  className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
                >
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Question {q.question_number}
                  </p>
                  <p className="mb-4 text-base leading-relaxed">{q.question}</p>
                  <div className="space-y-2">
                    {q.options.map((opt, i) => {
                      const letter = String.fromCharCode(65 + i);
                      const isSelected = selected === opt;
                      const isAnswer = opt === q.correct_answer;
                      return (
                        <button
                          key={i}
                          type="button"
                          disabled={isRevealed}
                          onClick={() => {
                            setAnswers((a) => ({ ...a, [q.question_number]: opt }));
                            setRevealed((r) => ({ ...r, [q.question_number]: true }));
                          }}
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
                              isRevealed && isAnswer && "border-emerald-700 bg-emerald-700 text-white",
                              isRevealed && isSelected && !isAnswer && "border-destructive bg-destructive text-white",
                            )}
                          >
                            {letter}
                          </span>
                          <span className="flex-1 pt-0.5 text-sm">{opt}</span>
                          {isRevealed && isAnswer && <CheckCircle2 className="h-5 w-5 text-emerald-700" />}
                          {isRevealed && isSelected && !isAnswer && (
                            <XCircle className="h-5 w-5 text-destructive" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {isRevealed && (
                    <div
                      className={cn(
                        "mt-4 rounded-xl border-l-4 bg-secondary/60 p-4",
                        isCorrect ? "border-emerald-700" : "border-amber-600",
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                        <Info className="h-3.5 w-3.5" />
                        {isCorrect ? "Correct" : `Answer: ${q.correct_answer}`}
                      </div>
                      <p className="text-sm leading-relaxed">{q.explanation}</p>
                    </div>
                  )}
                </div>
              );
            })}
        </main>
      </div>
    </div>
  );
}
