/** Optional MCQ bank stored with an exam (users can practice without AI). */
export type StoredQuestion = {
  question_number: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
};

export type ExamEntry = {
  id: string;
  title: string;
  year: number | null;
  pdfUrl: string | null;
  telegramFileId: string | null;
  note?: string;
  /** When set, users can take this quiz without generating. */
  questions?: StoredQuestion[];
};

export type Department = {
  id: string;
  name: string;
  emoji: string;
  exams: ExamEntry[];
};

export type Catalog = {
  departments: Department[];
  updatedAt: string;
};

export type TabId = "overview" | "departments" | "exams" | "settings";
