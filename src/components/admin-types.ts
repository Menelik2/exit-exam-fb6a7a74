export type ExamEntry = {
  id: string;
  title: string;
  year: number | null;
  pdfUrl: string | null;
  telegramFileId: string | null;
  note?: string;
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
