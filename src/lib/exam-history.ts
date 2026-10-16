import type { ExamQuestion } from "@/lib/exam.functions";

export type ExamSessionRecord = {
  id: string;
  timestamp: number;
  title: string;
  difficulty: string;
  total: number;
  correct: number;
  percent: number;
  topic?: string;
  docName?: string;
  reviewMode?: boolean;
};

const HISTORY_KEY = "exam-generator-history-v1";
const MAX_HISTORY = 80;

export function loadExamHistory(): ExamSessionRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is ExamSessionRecord =>
          r &&
          typeof r.id === "string" &&
          typeof r.timestamp === "number" &&
          typeof r.total === "number" &&
          typeof r.correct === "number",
      )
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

export function saveExamHistory(list: ExamSessionRecord[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    /* quota or private mode */
  }
}

export function addExamSession(record: Omit<ExamSessionRecord, "id" | "percent">): ExamSessionRecord[] {
  const percent = record.total > 0 ? Math.round((record.correct / record.total) * 100) : 0;
  const entry: ExamSessionRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    percent,
  };
  const prev = loadExamHistory();
  const next = [entry, ...prev].slice(0, MAX_HISTORY);
  saveExamHistory(next);
  return next;
}

export function clearExamHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {}
}

export type ProgressStats = {
  sessions: number;
  totalQuestions: number;
  totalCorrect: number;
  averagePercent: number;
  bestPercent: number;
  recent: ExamSessionRecord[];
  byDifficulty: { name: string; avg: number; count: number }[];
  trend: { date: string; percent: number; total: number }[];
};

export function computeProgressStats(history: ExamSessionRecord[]): ProgressStats {
  if (history.length === 0) {
    return {
      sessions: 0,
      totalQuestions: 0,
      totalCorrect: 0,
      averagePercent: 0,
      bestPercent: 0,
      recent: [],
      byDifficulty: [],
      trend: [],
    };
  }

  const totalQuestions = history.reduce((s, h) => s + h.total, 0);
  const totalCorrect = history.reduce((s, h) => s + h.correct, 0);
  const averagePercent =
    totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const bestPercent = Math.max(...history.map((h) => h.percent));

  const diffMap = new Map<string, { sum: number; count: number }>();
  for (const h of history) {
    const key = h.difficulty || "Unknown";
    const cur = diffMap.get(key) ?? { sum: 0, count: 0 };
    cur.sum += h.percent;
    cur.count += 1;
    diffMap.set(key, cur);
  }
  const byDifficulty = Array.from(diffMap.entries()).map(([name, v]) => ({
    name,
    avg: Math.round(v.sum / v.count),
    count: v.count,
  }));

  // Last 15 sessions chronological for trend (oldest → newest)
  const chronological = [...history].sort((a, b) => a.timestamp - b.timestamp).slice(-15);
  const trend = chronological.map((h) => ({
    date: new Date(h.timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    percent: h.percent,
    total: h.total,
  }));

  return {
    sessions: history.length,
    totalQuestions,
    totalCorrect,
    averagePercent,
    bestPercent,
    recent: history.slice(0, 8),
    byDifficulty,
    trend,
  };
}

/** Call when an attempt is fully finished (all answered). */
export function recordFinishedAttempt(opts: {
  questions: ExamQuestion[];
  answers: Record<number, string>;
  title: string;
  difficulty: string;
  topic?: string;
  docName?: string;
  isOptionCorrect: (q: ExamQuestion, opt: string) => boolean;
}): ExamSessionRecord[] {
  const { questions, answers, title, difficulty, topic, docName, isOptionCorrect } = opts;
  let correct = 0;
  for (const q of questions) {
    const selected = answers[q.question_number];
    if (selected && isOptionCorrect(q, selected)) correct++;
  }
  return addExamSession({
    timestamp: Date.now(),
    title: title || "Quiz",
    difficulty,
    total: questions.length,
    correct,
    topic,
    docName,
  });
}
