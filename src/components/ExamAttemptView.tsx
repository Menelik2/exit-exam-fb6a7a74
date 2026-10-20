import { Button } from "@/components/ui/button";
import {
  MoodleQuestionInfo,
  MoodleOption,
  moodleLetter,
  type MoodleNavState,
} from "@/components/moodle-quiz-ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ExamQuestion } from "@/lib/exam.functions";
import { isOptionCorrect } from "@/lib/exam-page-helpers";

type AttemptProps = {
  phase: "setup" | "attempt" | "summary" | "review";
  docMode: boolean;
  docName: string;
  topic: string;
  difficulty: string;
  questions: ExamQuestion[];
  answers: Record<number, string>;
  currentIndex: number;
  currentQuestion: ExamQuestion;
  correctCount: number;
  incorrectCount: number;
  scorePercent: number;
  flagged: Record<number, boolean>;
  isFirst: boolean;
  isLast: boolean;
  setCurrentIndex: (i: number | ((prev: number) => number)) => void;
  setFlagged: (fn: (prev: Record<number, boolean>) => Record<number, boolean>) => void;
  selectAnswer: (q: ExamQuestion, opt: string) => void;
  finishAttempt: () => void;
  navState: (q: ExamQuestion) => MoodleNavState;
  setSettingsOpen: (v: boolean | ((o: boolean) => boolean)) => void;
};

export function ExamAttemptView(p: AttemptProps) {
  const {
    phase, docMode, docName, topic, difficulty, questions, answers,
    currentIndex, currentQuestion, correctCount, incorrectCount, scorePercent, flagged,
    isFirst, isLast, setCurrentIndex, setFlagged, selectAnswer, finishAttempt, setSettingsOpen,
  } = p;

  const selected = answers[currentQuestion.question_number];
  const options = currentQuestion.options ?? [];

  return (
    <div className="pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-4">
      {phase === "review" && (
        <div className="mb-4 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
          <div className="border-b border-border/60 bg-muted/25 px-5 py-4">
            <h2 className="font-display text-lg font-semibold tracking-tight">Your results</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {docMode ? docName || "Document quiz" : topic || "Quiz"} · {difficulty}
            </p>
          </div>
          <div className="flex flex-col items-center gap-1.5 px-4 py-6">
            <p className="font-display text-5xl font-bold tabular-nums tracking-tight">{scorePercent}%</p>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{correctCount}/{questions.length}</span> correct
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2.5 border-t border-border/60 p-4">
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 py-3 text-center">
              <p className="font-display text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{correctCount}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Correct</p>
            </div>
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 py-3 text-center">
              <p className="font-display text-xl font-semibold tabular-nums text-red-700 dark:text-red-400">{incorrectCount}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Incorrect</p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-muted/15 py-3 text-center">
              <p className="font-display text-xl font-semibold tabular-nums">{questions.length}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Total</p>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
        <div className="flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-start md:gap-6 md:p-6">
          <MoodleQuestionInfo
            number={currentQuestion.question_number}
            status={
              phase === "review"
                ? selected != null && isOptionCorrect(currentQuestion, selected)
                  ? "Correct"
                  : "Incorrect"
                : selected != null
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
          />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-relaxed sm:text-base">{currentQuestion.question}</p>
            <div className="mt-4 space-y-2">
              {options.map((opt, i) => (
                <MoodleOption
                  key={i}
                  letter={moodleLetter(i)}
                  label={opt}
                  selected={selected === opt}
                  disabled={phase !== "attempt"}
                  reviewState={
                    phase === "review"
                      ? isOptionCorrect(currentQuestion, opt)
                        ? "correct"
                        : selected === opt
                          ? ("incorrect" as const)
                          : undefined
                      : undefined
                  }
                  onSelect={() => selectAnswer(currentQuestion, opt)}
                />
              ))}
            </div>
            {phase === "review" && currentQuestion.explanation && (
              <div className="mt-4 rounded-2xl border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                <span className="font-semibold text-foreground">Explanation: </span>
                {currentQuestion.explanation}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/60 bg-card/90 px-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_40px_rgba(0,0,0,0.06)] backdrop-blur-2xl lg:static lg:mt-4 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 lg:max-w-none">
          <Button
            type="button"
            variant="outline"
            className="h-12 flex-1 rounded-2xl border-border/80 shadow-sm lg:h-11"
            disabled={isFirst}
            onClick={() => setCurrentIndex((i) => Math.max(0, (typeof i === "number" ? i : 0) - 1))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
          </Button>
          {phase === "attempt" && isLast ? (
            <Button
              type="button"
              className="h-12 flex-1 rounded-2xl font-semibold shadow-md shadow-primary/15 lg:h-11"
              onClick={finishAttempt}
            >
              Finish attempt…
            </Button>
          ) : phase === "review" && isLast ? (
            <Button
              type="button"
              className="h-12 flex-1 rounded-2xl font-semibold shadow-md shadow-primary/15 lg:h-11"
              onClick={() => setSettingsOpen(true)}
            >
              Done
            </Button>
          ) : (
            <Button
              type="button"
              className="h-12 flex-1 rounded-2xl font-semibold shadow-md shadow-primary/15 lg:h-11"
              disabled={isLast}
              onClick={() => setCurrentIndex((i) => (typeof i === "number" ? i : 0) + 1)}
            >
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
