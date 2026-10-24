import { useMemo, useState } from "react";
import {
  FileText,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
  Save,
  ListChecks,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Catalog, Department, ExamEntry } from "@/components/admin-types";
import { generateAndStoreExamQuestions } from "@/lib/admin-exam-generate";
import type { StoredQuestion } from "@/components/admin-types";

type Props = {
  catalog: Catalog;
  saving: boolean;
  persist: (next: Catalog) => Promise<boolean>;
};

function newExamId(deptId: string) {
  return `${deptId}-${Date.now()}`;
}

export function AdminExamManagement({ catalog, saving, persist }: Props) {
  const depts = catalog.departments || [];
  const [filterDept, setFilterDept] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [genId, setGenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ deptId: string; exam: ExamEntry; isNew: boolean } | null>(
    null,
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: { dept: Department; exam: ExamEntry }[] = [];
    for (const d of depts) {
      if (filterDept !== "all" && d.id !== filterDept) continue;
      for (const exam of d.exams || []) {
        if (
          q &&
          !exam.title.toLowerCase().includes(q) &&
          !d.name.toLowerCase().includes(q) &&
          !(exam.year != null && String(exam.year).includes(q))
        ) {
          continue;
        }
        out.push({ dept: d, exam });
      }
    }
    return out;
  }, [depts, filterDept, search]);

  const openCreate = () => {
    if (!depts.length) {
      toast.error("Add a department first");
      return;
    }
    const deptId = filterDept !== "all" ? filterDept : depts[0].id;
    setEditing({
      deptId,
      isNew: true,
      exam: {
        id: newExamId(deptId),
        title: "",
        year: new Date().getFullYear(),
        pdfUrl: null,
        telegramFileId: null,
        note: "",
      },
    });
  };

  const openEdit = (deptId: string, exam: ExamEntry) => {
    setEditing({ deptId, exam: { ...exam }, isNew: false });
  };

  const saveExam = async () => {
    if (!editing) return;
    const title = editing.exam.title.trim();
    if (!title) {
      toast.error("Title is required");
      return;
    }
    if (!editing.deptId) {
      toast.error("Select a department");
      return;
    }
    const exam: ExamEntry = {
      ...editing.exam,
      title,
      pdfUrl: editing.exam.pdfUrl?.trim() || null,
      telegramFileId: editing.exam.telegramFileId?.trim() || null,
      note: editing.exam.note?.trim() || undefined,
    };

    let departments = depts.map((d) => ({ ...d, exams: [...(d.exams || [])] }));

    if (editing.isNew) {
      departments = departments.map((d) =>
        d.id === editing.deptId ? { ...d, exams: [...d.exams, exam] } : d,
      );
    } else {
      departments = departments.map((d) => {
        const without = (d.exams || []).filter((e) => e.id !== exam.id);
        if (d.id === editing.deptId) return { ...d, exams: [...without, exam] };
        return { ...d, exams: without };
      });
    }

    const ok = await persist({ ...catalog, departments });
    if (ok) {
      toast.success(editing.isNew ? "Exam created" : "Exam updated");
      setEditing(null);
    }
  };

  const deleteExam = async (deptId: string, exam: ExamEntry) => {
    if (!confirm(`Delete “${exam.title}”?`)) return;
    const ok = await persist({
      ...catalog,
      departments: depts.map((d) =>
        d.id === deptId ? { ...d, exams: (d.exams || []).filter((e) => e.id !== exam.id) } : d,
      ),
    });
    if (ok) toast.success("Exam deleted");
  };

  const clearQuestions = async () => {
    if (!editing || editing.isNew) return;
    if (!confirm("Remove all stored questions for this exam?")) return;
    const exam = { ...editing.exam, questions: undefined };
    setEditing({ ...editing, exam });
    const ok = await persist({
      ...catalog,
      departments: depts.map((d) =>
        d.id === editing.deptId
          ? { ...d, exams: (d.exams || []).map((e) => (e.id === exam.id ? exam : e)) }
          : d,
      ),
    });
    if (ok) toast.success("Questions cleared");
  };

  const genStore = async (deptId: string, exam: ExamEntry) => {
    if (!exam.pdfUrl && !exam.telegramFileId) {
      toast.error("Save a public PDF/DOCX URL first");
      return;
    }
    setGenId(exam.id);
    const toastId = toast.loading("Starting… keep this tab open for scanned PDFs");
    try {
      const questions = await generateAndStoreExamQuestions(exam, 0, (p) => {
        toast.loading(p.message || "Working…", { id: toastId });
      });
      const nextExam: ExamEntry = { ...exam, questions: questions as StoredQuestion[] };
      const ok = await persist({
        ...catalog,
        departments: depts.map((d) =>
          d.id === deptId
            ? { ...d, exams: (d.exams || []).map((e) => (e.id === exam.id ? nextExam : e)) }
            : d,
        ),
      });
      if (ok) {
        toast.success(`Stored ${questions.length} questions`, { id: toastId });
        if (editing?.exam.id === exam.id) {
          setEditing({ ...editing, exam: nextExam });
        }
      } else {
        toast.dismiss(toastId);
      }
    } catch (e) {
      const msg = (e as Error).message || "Generate failed";
      toast.error(msg, { id: toastId, duration: 12_000 });
    } finally {
      setGenId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Exam management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and edit exams, attach PDF/DOCX, generate questions for users.
          </p>
        </div>
        <Button type="button" disabled={saving || !depts.length} onClick={openCreate} className="shrink-0">
          <Plus className="mr-1.5 h-4 w-4" /> Create exam
        </Button>
      </div>

      {!depts.length ? (
        <div className="rounded-2xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          Add a department first, then create exams here.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exams…"
                className="h-10 rounded-xl pl-9"
              />
            </div>
            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
              aria-label="Filter by department"
            >
              <option value="all">All departments</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.emoji} {d.name}
                </option>
              ))}
            </select>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
              No exams match. Create one with the button above.
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map(({ dept, exam }) => {
                const qn = exam.questions?.length || 0;
                return (
                  <li
                    key={exam.id}
                    className="rounded-2xl border bg-card p-4 shadow-sm transition hover:border-primary/20"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <FileText className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold leading-snug tracking-tight">{exam.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {dept.emoji} {dept.name}
                              {exam.year != null ? ` · ${exam.year}` : ""}
                              {exam.pdfUrl ? " · Has PDF URL" : " · No PDF URL"}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {qn > 0 ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                  <ListChecks className="h-3 w-3" />
                                  {qn} questions ready
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  No quiz yet
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        <Button
                          size="sm"
                          disabled={!!genId || saving || !(exam.pdfUrl || exam.telegramFileId)}
                          onClick={() => void genStore(dept.id, exam)}
                        >
                          {genId === exam.id ? (
                            <>
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Gen…
                            </>
                          ) : (
                            <>
                              <Sparkles className="mr-1 h-3.5 w-3.5" />
                              {qn ? "Re-gen all" : "Gen all Qs"}
                            </>
                          )}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(dept.id, exam)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          disabled={saving}
                          onClick={() => void deleteExam(dept.id, exam)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border bg-card p-5 shadow-xl sm:rounded-3xl">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="font-display text-lg font-semibold">
                {editing.isNew ? "Create exam" : "Edit exam"}
              </h3>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
                onClick={() => setEditing(null)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="exam-dept">Department</Label>
                <select
                  id="exam-dept"
                  value={editing.deptId}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      deptId: e.target.value,
                      exam: {
                        ...editing.exam,
                        id: editing.isNew ? newExamId(e.target.value) : editing.exam.id,
                      },
                    })
                  }
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.emoji} {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exam-title">Title</Label>
                <Input
                  id="exam-title"
                  value={editing.exam.title}
                  onChange={(e) =>
                    setEditing({ ...editing, exam: { ...editing.exam, title: e.target.value } })
                  }
                  placeholder="e.g. BSC Nurse January 2016"
                  className="h-10 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exam-year">Year</Label>
                <Input
                  id="exam-year"
                  type="number"
                  value={editing.exam.year ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      exam: {
                        ...editing.exam,
                        year: e.target.value ? Number(e.target.value) : null,
                      },
                    })
                  }
                  className="h-10 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exam-pdf">PDF / DOCX public URL</Label>
                <Input
                  id="exam-pdf"
                  value={editing.exam.pdfUrl || ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      exam: { ...editing.exam, pdfUrl: e.target.value || null },
                    })
                  }
                  placeholder="https://…"
                  className="h-10 rounded-xl"
                />
                <p className="text-[11px] text-muted-foreground">
                  Must be a direct public link (or Google Drive “Anyone with the link”).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exam-tg">Telegram file_id (optional)</Label>
                <Input
                  id="exam-tg"
                  value={editing.exam.telegramFileId || ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      exam: { ...editing.exam, telegramFileId: e.target.value || null },
                    })
                  }
                  className="h-10 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exam-note">Note (optional)</Label>
                <Input
                  id="exam-note"
                  value={editing.exam.note || ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      exam: { ...editing.exam, note: e.target.value },
                    })
                  }
                  placeholder="Internal note"
                  className="h-10 rounded-xl"
                />
              </div>

              {!editing.isNew && (
                <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">
                    Stored questions: {editing.exam.questions?.length || 0}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        !!genId ||
                        saving ||
                        !(editing.exam.pdfUrl || editing.exam.telegramFileId)
                      }
                      onClick={() => void genStore(editing.deptId, editing.exam)}
                    >
                      {genId === editing.exam.id ? (
                        <>
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Generating…
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-1 h-3.5 w-3.5" /> Gen all Qs
                        </>
                      )}
                    </Button>
                    {(editing.exam.questions?.length || 0) > 0 && (
                      <Button type="button" size="sm" variant="outline" onClick={() => void clearQuestions()}>
                        Clear questions
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="button" disabled={saving} onClick={() => void saveExam()}>
                <Save className="mr-1.5 h-4 w-4" />
                {editing.isNew ? "Create" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
