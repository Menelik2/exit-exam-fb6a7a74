import type { ExamQuestion } from "@/lib/exam.functions";
import type { MoodleNavState } from "@/components/moodle-quiz-ui";
import { ExamSummaryView } from "@/components/ExamSummaryView";
import { ExamAttemptView } from "@/components/ExamAttemptView";
import { ExamNavSheet } from "@/components/ExamNavSheet";

export type QuizPhase = "setup" | "attempt" | "summary" | "review";

type Props = {
  showSummary: boolean;
  hasActiveQuiz: boolean;
  phase: QuizPhase;
  docMode: boolean;
  docName: string;
  topic: string;
  difficulty: string;
  questions: ExamQuestion[];
  answers: Record<number, string>;
  currentIndex: number;
  currentQuestion: ExamQuestion | undefined;
  answeredCount: number;
  notAnsweredCount: number;
  correctCount: number;
  incorrectCount: number;
  scorePercent: number;
  confirmSubmit: boolean;
  flagged: Record<number, boolean>;
  navOpen: boolean;
  isFirst: boolean;
  isLast: boolean;
  setConfirmSubmit: (v: boolean) => void;
  setPhase: (p: QuizPhase) => void;
  setCurrentIndex: (i: number | ((prev: number) => number)) => void;
  setNavOpen: (v: boolean) => void;
  setFlagged: (fn: (prev: Record<number, boolean>) => Record<number, boolean>) => void;
  selectAnswer: (q: ExamQuestion, opt: string) => void;
  finishAttempt: () => void;
  submitAllAndFinish: () => void;
  navState: (q: ExamQuestion) => MoodleNavState;
  setSettingsOpen: (v: boolean | ((o: boolean) => boolean)) => void;
};

export function ExamQuizBody(p: Props) {
  return (
    <>
      {p.showSummary && (
        <ExamSummaryView
          docMode={p.docMode}
          docName={p.docName}
          topic={p.topic}
          questions={p.questions}
          answeredCount={p.answeredCount}
          notAnsweredCount={p.notAnsweredCount}
          confirmSubmit={p.confirmSubmit}
          setConfirmSubmit={p.setConfirmSubmit}
          setPhase={p.setPhase}
          submitAllAndFinish={p.submitAllAndFinish}
        />
      )}
      {p.hasActiveQuiz && p.currentQuestion && (
        <ExamAttemptView
          phase={p.phase}
          docMode={p.docMode}
          docName={p.docName}
          topic={p.topic}
          difficulty={p.difficulty}
          questions={p.questions}
          answers={p.answers}
          currentIndex={p.currentIndex}
          currentQuestion={p.currentQuestion}
          correctCount={p.correctCount}
          incorrectCount={p.incorrectCount}
          scorePercent={p.scorePercent}
          flagged={p.flagged}
          isFirst={p.isFirst}
          isLast={p.isLast}
          setCurrentIndex={p.setCurrentIndex}
          setFlagged={p.setFlagged}
          selectAnswer={p.selectAnswer}
          finishAttempt={p.finishAttempt}
          navState={p.navState}
          setSettingsOpen={p.setSettingsOpen}
        />
      )}
      <ExamNavSheet
        phase={p.phase}
        questions={p.questions}
        answers={p.answers}
        currentIndex={p.currentIndex}
        correctCount={p.correctCount}
        answeredCount={p.answeredCount}
        flagged={p.flagged}
        navOpen={p.navOpen}
        setNavOpen={p.setNavOpen}
        setCurrentIndex={(i) => p.setCurrentIndex(i)}
        finishAttempt={p.finishAttempt}
        navState={p.navState}
      />
    </>
  );
}
