import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  MoodleNavButton,
  type MoodleNavState,
} from "@/components/moodle-quiz-ui";
import type { ExamQuestion } from "@/lib/exam.functions";

type NavProps = {
  phase: "setup" | "attempt" | "summary" | "review";
  questions: ExamQuestion[];
  answers: Record<number, string>;
  currentIndex: number;
  correctCount: number;
  answeredCount: number;
  flagged: Record<number, boolean>;
  navOpen: boolean;
  setNavOpen: (v: boolean) => void;
  setCurrentIndex: (i: number) => void;
  finishAttempt: () => void;
  navState: (q: ExamQuestion) => MoodleNavState;
};

function PaletteGrid({
  questions,
  currentIndex,
  flagged,
  navState,
  onSelect,
}: {
  questions: ExamQuestion[];
  currentIndex: number;
  flagged: Record<number, boolean>;
  navState: (q: ExamQuestion) => MoodleNavState;
  onSelect: (idx: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {questions.map((q, idx) => (
        <MoodleNavButton
          key={q.question_number}
          number={idx + 1}
          state={navState(q)}
          flagged={!!flagged[q.question_number]}
          isCurrent={idx === currentIndex}
          onClick={() => onSelect(idx)}
        />
      ))}
    </div>
  );
}

export function ExamNavSheet(p: NavProps) {
  const {
    phase, questions, answers, currentIndex, correctCount, answeredCount,
    flagged, navOpen, setNavOpen, setCurrentIndex, finishAttempt, navState,
  } = p;
  const hasActiveQuiz = questions.length > 0;
  const statusText =
    phase === "review"
      ? `Score ${correctCount}/${questions.length}`
      : `${answeredCount} of ${questions.length} answered`;

  return (
    <>
      {/* Desktop: sticky side palette */}
      {hasActiveQuiz && (phase === "attempt" || phase === "review") && (
        <aside className="sticky top-[4.5rem] hidden max-h-[calc(100dvh-5.5rem)] w-full shrink-0 overflow-y-auto rounded-3xl border border-border/70 bg-card p-4 shadow-sm lg:block lg:w-56 xl:w-64">
          <div className="mb-3">
            <h3 className="font-display text-sm font-semibold tracking-tight">Quiz navigation</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{statusText}</p>
          </div>
          <PaletteGrid
            questions={questions}
            currentIndex={currentIndex}
            flagged={flagged}
            navState={navState}
            onSelect={setCurrentIndex}
          />
          {phase === "attempt" && (
            <Button
              type="button"
              className="mt-4 h-10 w-full rounded-2xl text-sm font-semibold shadow-md shadow-primary/15"
              onClick={finishAttempt}
            >
              Finish attempt…
            </Button>
          )}
          <div className="mt-4 space-y-1.5 border-t border-border/50 pt-3 text-[10px] text-muted-foreground">
            <p className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm border border-border bg-card" /> Not answered
            </p>
            <p className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm border border-border bg-slate-300/80" /> Answered
            </p>
            {phase === "review" && (
              <>
                <p className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-sm bg-emerald-600" /> Correct
                </p>
                <p className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-sm bg-red-600" /> Incorrect
                </p>
              </>
            )}
          </div>
        </aside>
      )}

      {/* Mobile: bottom sheet */}
      <Sheet open={navOpen && hasActiveQuiz} onOpenChange={setNavOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[70dvh] overflow-y-auto rounded-t-3xl border-border/60 lg:hidden"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="font-display">Quiz navigation</SheetTitle>
            <SheetDescription>{statusText}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 pb-[env(safe-area-inset-bottom)]">
            <PaletteGrid
              questions={questions}
              currentIndex={currentIndex}
              flagged={flagged}
              navState={navState}
              onSelect={(idx) => {
                setCurrentIndex(idx);
                setNavOpen(false);
              }}
            />
            {phase === "attempt" && (
              <Button
                type="button"
                className="mt-4 h-11 w-full rounded-2xl font-semibold shadow-md shadow-primary/15"
                onClick={() => {
                  setNavOpen(false);
                  finishAttempt();
                }}
              >
                Finish attempt…
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
