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
  MoodleQuestionInfo,
  MoodleOption,
  moodleLetter,
  type MoodleNavState,
} from "@/components/moodle-quiz-ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ExamQuestion } from "@/lib/exam.functions";
import { isOptionCorrect } from "@/lib/exam-page-helpers";
import { cn } from "@/lib/utils";

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

export function ExamNavSheet(p: NavProps) {
  const {
    phase, questions, answers, currentIndex, correctCount, answeredCount,
    flagged, navOpen, setNavOpen, setCurrentIndex, finishAttempt, navState,
  } = p;
  const hasActiveQuiz = true;
  return (
    <Sheet open={navOpen && hasActiveQuiz} onOpenChange={setNavOpen}>
      <SheetContent side="bottom" className="max-h-[70dvh] overflow-y-auto rounded-t-3xl border-border/60 lg:hidden">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display">Quiz navigation</SheetTitle>
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
            className="mt-4 h-11 w-full rounded-2xl font-semibold shadow-md shadow-primary/15"
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
  );
}
