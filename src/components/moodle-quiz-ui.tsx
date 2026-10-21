import { cn } from "@/lib/utils";
import { Flag } from "lucide-react";

export type MoodleNavState = "todo" | "answered" | "correct" | "incorrect" | "partial";

/**
 * Moodle quiz navigation button.
 * Matches core Moodle states:
 * - todo: white
 * - answered: bottom half grey
 * - correct (review): bottom half green + tick
 * - incorrect (review): bottom half red
 * - flagged: red triangle top-right
 * - thispage: thicker border
 */
export function MoodleNavButton({
  number,
  state,
  flagged,
  isCurrent,
  onClick,
  disabled,
}: {
  number: number;
  state: MoodleNavState;
  flagged?: boolean;
  isCurrent?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`Question ${number}${flagged ? ", flagged" : ""}, ${state}${isCurrent ? ", current" : ""}`}
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "relative h-11 w-9 shrink-0 overflow-hidden rounded-sm border bg-white text-sm font-normal text-slate-800 transition active:scale-[0.96] dark:bg-card dark:text-foreground",
        isCurrent ? "border-[3px] border-slate-800 dark:border-slate-100" : "border border-slate-400 dark:border-border",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {state === "answered" && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-slate-300 dark:bg-slate-600" aria-hidden />
      )}
      {state === "correct" && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex h-1/2 items-center justify-center bg-emerald-600" aria-hidden>
          <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6.5 L5 9.5 L10 3" />
          </svg>
        </span>
      )}
      {state === "incorrect" && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-red-600" aria-hidden />
      )}
      {state === "partial" && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex h-1/2 items-center justify-center bg-amber-500" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-white" />
        </span>
      )}

      <span className="relative z-10 flex h-full items-start justify-center pt-1.5 text-[13px] leading-none">{number}</span>

      {flagged && (
        <span
          className="absolute right-0 top-0 z-20 h-0 w-0 border-l-[12px] border-t-[12px] border-l-transparent border-t-red-600"
          aria-hidden
        />
      )}
    </button>
  );
}

/** Left-side question info box (Moodle question number / status / marks / flag) */
export function MoodleQuestionInfo({
  number,
  status,
  marks = "1.00",
  flagged,
  onToggleFlag,
  showFlag = true,
  reviewMarks,
}: {
  number: number;
  status: "Not yet answered" | "Answer saved" | "Correct" | "Incorrect" | "Partially correct";
  marks?: string;
  flagged?: boolean;
  onToggleFlag?: () => void;
  showFlag?: boolean;
  /** When reviewing, show points awarded e.g. "1.00 / 1.00" */
  reviewMarks?: string;
}) {
  const statusColor =
    status === "Correct"
      ? "text-emerald-700"
      : status === "Incorrect"
        ? "text-red-700"
        : status === "Partially correct"
          ? "text-amber-800"
          : status === "Answer saved"
            ? "text-slate-600"
            : "text-slate-500";

  return (
    <div className="w-full shrink-0 rounded-sm border border-slate-300 bg-white p-3.5 text-sm shadow-sm dark:border-border dark:bg-card sm:w-44 md:w-48">
      <p className="font-semibold text-slate-900 dark:text-slate-100">Question {number}</p>
      <p className={cn("mt-1 text-xs", statusColor)}>{status}</p>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
        {reviewMarks ? (
          <>
            Mark <strong className="text-slate-900 dark:text-slate-200">{reviewMarks}</strong>
          </>
        ) : (
          <>
            Marked out of <strong className="text-slate-900 dark:text-slate-200">{marks}</strong>
          </>
        )}
      </p>
      {showFlag && onToggleFlag && (
        <button
          type="button"
          onClick={onToggleFlag}
          className={cn(
            "mt-3 inline-flex items-center gap-1.5 text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6bcb]/40",
            flagged ? "text-red-600" : "text-[#0b6bcb]",
          )}
          aria-pressed={!!flagged}
        >
          <Flag className={cn("h-3.5 w-3.5", flagged && "fill-red-600")} />
          {flagged ? "Remove flag" : "Flag question"}
        </button>
      )}
    </div>
  );
}

/** Moodle-style multichoice option row (radio / checkbox look) */
export function MoodleOption({
  label,
  letter,
  selected,
  disabled,
  onSelect,
  reviewState,
}: {
  label: string;
  letter?: string;
  selected: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** During review */
  reviewState?: "correct" | "incorrect" | "neutral";
}) {
  return (
    <label
      className={cn(
        "flex min-h-10 cursor-pointer items-start gap-2.5 rounded-sm px-1 py-1.5 text-sm text-slate-900 transition-colors dark:text-slate-100",
        disabled ? "cursor-default" : "hover:bg-white/40",
      )}
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {reviewState === "correct" ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-sm border border-slate-400 bg-white">
            <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M2 6.5 L5 9.5 L10 3" />
            </svg>
          </span>
        ) : reviewState === "incorrect" && selected ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-sm border border-slate-400 bg-white">
            <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 text-red-600" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M3 3 L9 9 M9 3 L3 9" />
            </svg>
          </span>
        ) : (
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded-full border-2 bg-white",
              selected ? "border-slate-700" : "border-slate-400",
            )}
          >
            {selected && <span className="h-2 w-2 rounded-full bg-slate-700" />}
          </span>
        )}
      </span>
      <input
        type="radio"
        className="sr-only"
        checked={selected}
        disabled={disabled}
        onChange={() => onSelect?.()}
      />
      <span className="flex-1 leading-snug">
        {letter && <span className="mr-1.5 font-medium text-slate-600">{letter}.</span>}
        {label}
        {reviewState === "correct" && (
          <span className="ml-1.5 inline text-emerald-600" aria-hidden>✓</span>
        )}
        {reviewState === "incorrect" && selected && (
          <span className="ml-1.5 inline text-red-600" aria-hidden>✗</span>
        )}
      </span>
    </label>
  );
}

const LETTERS = ["a", "b", "c", "d", "e", "f"];

export function moodleLetter(index: number) {
  return LETTERS[index] ?? String(index + 1);
}
