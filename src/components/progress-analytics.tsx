import { useMemo, useState, useEffect } from "react";
import {
  loadExamHistory,
  clearExamHistory,
  computeProgressStats,
  type ExamSessionRecord,
} from "@/lib/exam-history";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Trash2,
  TrendingUp,
  Target,
  Award,
  BookOpen,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

export function ProgressAnalytics({
  refreshKey = 0,
  className = "",
}: {
  refreshKey?: number;
  className?: string;
}) {
  const [history, setHistory] = useState<ExamSessionRecord[]>([]);

  useEffect(() => {
    setHistory(loadExamHistory());
  }, [refreshKey]);

  const stats = useMemo(() => computeProgressStats(history), [history]);

  const onClear = () => {
    if (!confirm("Clear all score history on this device?")) return;
    clearExamHistory();
    setHistory([]);
  };

  if (stats.sessions === 0) {
    return (
      <div
        className={`rounded-2xl border border-border bg-card/80 p-5 text-center ${className}`}
        role="region"
        aria-label="Progress analytics"
      >
        <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-sm font-medium text-foreground">No sessions yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Finish a quiz attempt to start tracking scores and trends.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`space-y-4 rounded-2xl border border-border bg-card/90 p-4 shadow-sm sm:p-5 ${className}`}
      role="region"
      aria-label="Progress analytics"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold tracking-tight">Your progress</h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground hover:text-destructive"
          onClick={onClear}
          aria-label="Clear score history"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          icon={<BookOpen className="h-3.5 w-3.5" />}
          label="Sessions"
          value={String(stats.sessions)}
        />
        <StatCard
          icon={<Target className="h-3.5 w-3.5" />}
          label="Questions"
          value={String(stats.totalQuestions)}
        />
        <StatCard
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Average"
          value={`${stats.averagePercent}%`}
        />
        <StatCard
          icon={<Award className="h-3.5 w-3.5" />}
          label="Best"
          value={`${stats.bestPercent}%`}
        />
      </div>

      {stats.trend.length >= 2 && (
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Score trend
          </p>
          <div className="h-36 w-full" role="img" aria-label="Line chart of recent scores">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.trend} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                  }}
                  formatter={(value: number) => [`${value}%`, "Score"]}
                />
                <Line
                  type="monotone"
                  dataKey="percent"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {stats.byDifficulty.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            By difficulty
          </p>
          <div className="h-28 w-full" role="img" aria-label="Bar chart of average score by difficulty">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.byDifficulty} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                  }}
                  formatter={(value: number) => [`${value}%`, "Avg score"]}
                />
                <Bar dataKey="avg" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Recent attempts
        </p>
        <ul className="max-h-40 space-y-1.5 overflow-y-auto text-xs">
          {stats.recent.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{s.title}</p>
                <p className="text-[10px] text-muted-foreground">
                  {s.difficulty} · {new Date(s.timestamp).toLocaleString()}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${
                  s.percent >= 70
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : s.percent >= 40
                      ? "bg-amber-500/15 text-amber-800 dark:text-amber-400"
                      : "bg-red-500/15 text-red-700 dark:text-red-400"
                }`}
              >
                {s.correct}/{s.total} ({s.percent}%)
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}
