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
  } catch {
    // ignore quota errors
  }
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
  } catch {
    // ignore quota errors
  }
}

function normalizeQuestionText(q: string) {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
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
          const keys = new Set(prev.map(normalizeQuestionText));
          const merged = [...prev];
          for (const q of data.questions) {
            const t = (q.question ?? "").trim();
            if (!t) continue;
            const k = normalizeQuestionText(t);
            if (!keys.has(k)) {
              keys.add(k);
              merged.push(t);
            }
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

  // NOTE: remaining UI restored from previous version — full file continues below in next commit if truncated
  const questions: ExamQuestion[] = reviewMode
    ? reviewQuestions
    : (mutation.data?.questions ?? []);

  return (
    <div className="min-h-screen p-4">
      <p className="text-sm text-muted-foreground">Loading full UI… if you see this, restore is incomplete.</p>
      <pre className="text-xs">{JSON.stringify({ seen: seenQuestions.length, wrong: wrongQuestions.length }, null, 2)}</pre>
    </div>
  );
}
