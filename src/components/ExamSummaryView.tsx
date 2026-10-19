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

type SummaryProps = {
  docMode: boolean;
  docName: string;
  topic: string;
  questions: ExamQuestion[];
  answeredCount: number;
  notAnsweredCount: number;
  confirmSubmit: boolean;
  setConfirmSubmit: (v: boolean) => void;
  setPhase: (p: "attempt" | "summary" | "review" | "setup") => void;
  submitAllAndFinish: () => void;
};

export function ExamSummaryView(p: SummaryProps) {
  const {
    docMode, docName, topic, questions, answeredCount, notAnsweredCount,
    confirmSubmit, setConfirmSubmit, setPhase, submitAllAndFinish,
  } = p;
  return (
    <>
      <div className="space-y-4 pb-8">
        <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-[0_8px_30px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.02]">
          <div className="border-b border-border/60 bg-muted/25 px-5 py-4">
            <h2 className="font-display text-lg font-semibold tracking-tight">Summary of attempt</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{docMode ? docName || topic : topic}</p>
          </div>
          <div className="grid grid-cols-3 gap-2.5 p-4 sm:gap-3 sm:p-5">
            <div className="rounded-2xl border border-border/60 bg-muted/15 py-3.5 text-center">
              <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">{questions.length}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Questions</p>
            </div>
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 py-3.5 text-center">
              <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">{answeredCount}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Answered</p>
            </div>
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 py-3.5 text-center">
              <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-amber-700 dark:text-amber-400">{notAnsweredCount}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Not answered</p>
            </div>
          </div>
        </div>
        {confirmSubmit ? (
          <div className="space-y-3 rounded-3xl border border-destructive/40 bg-card p-5 shadow-sm">
            <p className="font-display text-base font-semibold">Submit this attempt?</p>
            <p className="text-xs text-muted-foreground">You will see correct answers and feedback.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="h-12 flex-1 rounded-2xl font-semibold shadow-md shadow-primary/15" onClick={submitAllAndFinish}>
                Submit and view results
              </Button>
              <Button variant="outline" className="h-12 flex-1 rounded-2xl" onClick={() => setConfirmSubmit(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="h-12 flex-1 rounded-2xl" onClick={() => setPhase("attempt")}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Return to attempt
            </Button>
            <Button className="h-12 flex-1 rounded-2xl font-semibold shadow-md shadow-primary/15" onClick={() => setConfirmSubmit(true)}>
              Submit all and finish
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
