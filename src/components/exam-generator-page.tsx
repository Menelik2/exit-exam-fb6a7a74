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
    // Wrong answers are already persisted in handleAnswer; only mark the attempt finished.
    setExamFinished(true);
  }, [allAnswered, examFinished, reviewMode]);

  // RESTORE_MARKER_CONTINUE
}
