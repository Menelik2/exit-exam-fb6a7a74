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
};

export function ExamQuizBody(p: Props) {
  const {
    showSummary, hasActiveQuiz, phase, docMode, docName, topic, difficulty,
    questions, answers, currentIndex, currentQuestion, answeredCount, notAnsweredCount,
    correctCount, scorePercent, confirmSubmit, flagged, navOpen, isFirst, isLast,
    setConfirmSubmit, setPhase, setCurrentIndex, setNavOpen, setFlagged,
    selectAnswer, finishAttempt, submitAllAndFinish, navState,
  } = p;

  return (
    <>
