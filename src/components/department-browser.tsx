import { useEffect, useMemo, useState } from "react";
import { apiGetCatalog } from "@/lib/admin-api";
import { extractDocumentText } from "@/lib/extract-document";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Building2,
  ChevronLeft,
  ExternalLink,
  FileText,
  Loader2,
  MessageCircle,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

type Exam = {
  id: string;
  title: string;
  year?: number | null;
  pdfUrl?: string | null;
  telegramFileId?: string | null;
  note?: string;
};

type Dept = {
  id: string;
  name: string;
  emoji?: string;
  exams: Exam[];
};

type View = "list" | "dept";

/** Fetch exam document text via Vercel API (reliable) + browser PDF extraction. */
async function loadExamText(exam: Exam): Promise<string> {
  const res = await fetch("/api/exam-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: exam.title,
      pdfUrl: exam.pdfUrl ?? null,
      telegramFileId: exam.telegramFileId ?? null,
    }),
    cache: "no-store",
  });

  const ctype = (res.headers.get("content-type") || "").toLowerCase();

  // JSON path: text already extracted (DOCX/TXT) or error
  if (ctype.includes("application/json")) {
    const data = (await res.json()) as {
      ok?: boolean;
      kind?: string;
      text?: string;
      error?: string;
    };
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Server error (${res.status})`);
    }
    if (typeof data.text === "string" && data.text.trim().length > 0) {
      return data.text.trim();
    }
    throw new Error(data.error || "Server did not return exam text");
  }

  // Binary PDF path: extract in the browser with pdfjs (already works for uploads)
  if (!res.ok) {
    const fallback = await res.text().catch(() => "");
    throw new Error(fallback.slice(0, 200) || `Download failed (${res.status})`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength < 50) throw new Error("Downloaded file is empty");

  const header = new Uint8Array(buf.slice(0, 5));
  const magic = String.fromCharCode(...header);
  if (magic !== "%PDF-") {
    throw new Error(
      "Downloaded file is not a PDF (often a Google Drive login page). Set the file to Anyone with the link.",
    );
  }

  const nameHeader = res.headers.get("X-Exam-Filename");
  let filename = `${exam.title || "exam"}.pdf`;
  if (nameHeader) {
    try {
      filename = decodeURIComponent(nameHeader);
    } catch {
      filename = nameHeader;
    }
  }
  if (!filename.toLowerCase().endsWith(".pdf")) filename += ".pdf";

  const file = new File([buf], filename, { type: "application/pdf" });
  return await extractDocumentText(file);
}

export function DepartmentBrowser({
  onUseTopic,
  onLoadExamDocument,
}: {
  onUseTopic?: (topic: string) => void;
  onLoadExamDocument?: (payload: { name: string; text: string; topic: string }) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<Dept | null>(null);
  const [busyExamId, setBusyExamId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGetCatalog();
        if (cancelled) return;
        const depts = res?.catalog?.departments;
        setDepartments(Array.isArray(depts) ? (depts as Dept[]) : []);
      } catch (e) {
        if (!cancelled) toast.error((e as Error).message || "Could not load departments");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.id.includes(q) ||
        d.exams.some((e) => e.title.toLowerCase().includes(q)),
    );
  }, [departments, search]);

  const openDept = (d: Dept) => {
    setSelected(d);
    setView("dept");
  };

  const back = () => {
    setView("list");
    setSelected(null);
  };

  const generateFromExam = async (exam: Exam, deptName: string) => {
    if (!onLoadExamDocument) {
      toast.message("Open Setup to generate a quiz from this exam");
      return;
    }
    if (!exam.pdfUrl && !exam.telegramFileId) {
      toast.error("No document linked for this exam yet");
      return;
    }
    setBusyExamId(exam.id);
    try {
      toast.message("Loading exam document…");
      const text = await loadExamText(exam);

      if (!text || text.trim().length < 40) {
        throw new Error(
          "Could not read enough text from this file (scanned PDFs need OCR; try DOCX/PDF with real text).",
        );
      }

      onLoadExamDocument({
        name: exam.title,
        text,
        topic: deptName,
      });
      toast.success("Document loaded — generating quiz questions");
    } catch (e) {
      const msg = (e as Error)?.message || "Failed to load exam document";
      toast.error(msg);
    } finally {
      setBusyExamId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card px-4 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading departments…
      </div>
    );
  }

  if (view === "dept" && selected) {
    return (
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2" onClick={back}>
            <ChevronLeft className="mr-0.5 h-4 w-4" /> All departments
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight">
              <span className="mr-2">{selected.emoji || "📘"}</span>
              {selected.name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {selected.exams.length} exam{selected.exams.length === 1 ? "" : "s"} — pick one to generate quiz questions
            </p>
          </div>
          {onUseTopic && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-xl"
              onClick={() => {
                onUseTopic(selected.name);
                toast.success(`Topic set to “${selected.name}”`);
              }}
            >
              Use as topic only
            </Button>
          )}
        </div>

        {selected.exams.length === 0 ? (
          <p className="rounded-xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
            No exam documents linked yet for this department.
          </p>
        ) : (
          <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
            {selected.exams.map((exam) => {
              const hasPdf = Boolean(exam.pdfUrl);
              const hasTg = Boolean(exam.telegramFileId);
              const canGenerate = hasPdf || hasTg;
              const busy = busyExamId === exam.id;
              const meta = [
                exam.year != null ? String(exam.year) : null,
                hasPdf ? "Document URL" : null,
                hasTg ? "Telegram file" : null,
                !canGenerate ? "Not linked yet" : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={exam.id} className="flex flex-col gap-2 px-3 py-3 sm:px-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{exam.title}</p>
                      {meta && <p className="text-[11px] text-muted-foreground">{meta}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pl-7">
                    {canGenerate && onLoadExamDocument && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 rounded-lg"
                        disabled={busy}
                        onClick={() => void generateFromExam(exam, selected.name)}
                      >
                        {busy ? (
                          <>
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Loading…
                          </>
                        ) : (
                          <>
                            <Sparkles className="mr-1 h-3.5 w-3.5" /> Generate all questions
                          </>
                        )}
                      </Button>
                    )}
                    {hasPdf && (
                      <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg" asChild>
                        <a href={exam.pdfUrl!} target="_blank" rel="noreferrer">
                          Open file <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                      </Button>
                    )}
                    {hasTg && (
                      <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg" asChild>
                        <a href="https://t.me/exitexamto" target="_blank" rel="noreferrer">
                          <MessageCircle className="mr-1 h-3.5 w-3.5 text-[#229ED9]" /> Telegram
                        </a>
                      </Button>
                    )}
                    {!canGenerate && (
                      <span className="text-[11px] text-muted-foreground">Coming soon</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-display text-base font-semibold tracking-tight">Select by department</h3>
            <p className="text-[11px] text-muted-foreground">
              Choose a department → exam (PDF/DOCX/DOC) → generate all questions
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-9 w-40 rounded-xl pl-8 text-sm sm:w-48"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No departments found</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => openDept(d)}
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-background px-3 py-3 text-left transition hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-xl leading-none">{d.emoji || "📘"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{d.name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {d.exams.length} exam{d.exams.length === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
