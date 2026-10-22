import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LayoutDashboard, Building2, FileText, Settings, LogOut, Plus, Trash2, BookOpen, Shield, Pencil, X, Save, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Catalog, Department, ExamEntry, TabId } from "@/components/admin-types";
import { uniqueDeptId, exportDepartmentsJson } from "@/components/admin-catalog";
import { apiAdminLogin, apiGetCatalog, apiSaveCatalog } from "@/lib/admin-api";
import { generateAndStoreExamQuestions } from "@/lib/admin-exam-generate";
import type { StoredQuestion } from "@/components/admin-types";

const EMPTY: Catalog = { departments: [], updatedAt: new Date(0).toISOString() };
const TOKEN_KEY = "exit-exam-admin-token-v2";

function toCat(res: unknown): Catalog {
  const r = res as { catalog?: { departments?: Catalog["departments"]; updatedAt?: string } } | null;
  const depts = r?.catalog?.departments;
  return {
    departments: Array.isArray(depts)
      ? depts.map((d) => ({
          ...d,
          exams: Array.isArray(d.exams)
            ? d.exams.map((e) => ({ ...e, questions: Array.isArray(e.questions) ? e.questions : undefined }))
            : [],
        }))
      : [],
    updatedAt: r?.catalog?.updatedAt || new Date().toISOString(),
  };
}

export function AdminDashboard() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [tab, setTab] = useState<TabId>("exams");
  const [catalog, setCatalog] = useState<Catalog>(EMPTY);
  const [editingExam, setEditingExam] = useState<{ deptId: string; exam: ExamEntry } | null>(null);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [newDeptName, setNewDeptName] = useState("");
  const [saving, setSaving] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [genId, setGenId] = useState<string | null>(null);
  const [genCount, setGenCount] = useState("0");

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const t = sessionStorage.getItem(TOKEN_KEY);
        if (t) { setToken(t); setAuthed(true); }
      } catch {}
      try {
        const res = await apiGetCatalog();
        if (!c) setCatalog(toCat(res));
      } catch (e) {
        if (!c) toast.error((e as Error).message || "Load failed");
      } finally {
        if (!c) setReady(true);
      }
    })();
    return () => { c = true; };
  }, []);

  const persist = useCallback(async (next: Catalog) => {
    if (!token) { toast.error("Sign in again"); setAuthed(false); return false; }
    if (saving) return false;
    setSaving(true);
    try {
      const res = await apiSaveCatalog(token, {
        departments: next.departments || [],
        updatedAt: new Date().toISOString(),
        appUrl: "https://yeniexams.vercel.app",
        channelUrl: "https://t.me/exitexamto",
        channelUsername: "@exitexamto",
      });
      setCatalog(toCat(res));
      return true;
    } catch (e) {
      const msg = (e as Error).message || "Save failed";
      toast.error(msg);
      if (/session|expired/i.test(msg)) {
        setAuthed(false); setToken(null);
        try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [token, saving]);

  const depts = catalog.departments || [];

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) { setPinError("Enter password"); return; }
    setLoggingIn(true); setPinError("");
    try {
      const res = await apiAdminLogin(pin.trim());
      if (!res?.ok || !res.token) { setPinError(res?.error || "Incorrect password"); return; }
      try { sessionStorage.setItem(TOKEN_KEY, res.token); } catch {}
      setToken(res.token); setAuthed(true); setPin("");
      const cat = await apiGetCatalog();
      setCatalog(toCat(cat));
      toast.success("Signed in");
    } catch (err) {
      setPinError((err as Error).message || "Login failed");
    } finally {
      setLoggingIn(false);
    }
  };

  const genStore = async (deptId: string, exam: ExamEntry) => {
    if (!exam.pdfUrl && !exam.telegramFileId) {
      toast.error("Save a public PDF/DOCX URL first");
      return;
    }
    // 0 or empty = full document (all sections, one run, up to 200 Qs)
    const raw = genCount.trim().toLowerCase();
    let n = 0;
    if (raw && raw !== "all" && raw !== "full" && raw !== "0") {
      n = parseInt(raw, 10);
      if (Number.isNaN(n) || n < 0) n = 0;
      if (n > 200) n = 200;
    }
    setGenId(exam.id);
    try {
      toast.message(n === 0 ? "Generating ALL questions from full PDF/DOCX…" : `Generating ${n} questions…`);
      const questions = await generateAndStoreExamQuestions(exam, n);
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
        toast.success(`Stored ${questions.length} questions for users`);
        setEditingExam((cur) => (cur && cur.exam.id === exam.id ? { ...cur, exam: nextExam } : cur));
      }
    } catch (e) {
      toast.error((e as Error).message || "Generate failed");
    } finally {
      setGenId(null);
    }
  };

  if (!ready) return <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">Loading…</div>;

  if (!authed) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <form onSubmit={login} className="w-full max-w-sm space-y-4 rounded-3xl border bg-card p-8 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Shield className="h-5 w-5" /></span>
            <div>
              <h1 className="font-display text-lg font-semibold">Admin login</h1>
              <p className="text-xs text-muted-foreground">Generate questions from PDFs for users</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pin">Password</Label>
            <Input id="pin" type="password" value={pin} onChange={(e) => { setPin(e.target.value); setPinError(""); }} className="h-11 rounded-2xl" autoFocus />
            {pinError && <p className="text-xs text-destructive">{pinError}</p>}
          </div>
          <Button type="submit" className="h-11 w-full rounded-2xl" disabled={loggingIn}>{loggingIn ? "Signing in…" : "Sign in"}</Button>
          <Link to="/" className="block text-center text-xs underline">← Practice app</Link>
        </form>
      </div>
    );
  }

  const nav: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "departments", label: "Departments", icon: Building2 },
    { id: "exams", label: "Exams", icon: FileText },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-card lg:flex">
        <div className="border-b px-4 py-4">
          <p className="font-display font-semibold">Admin</p>
          <p className="text-[11px] text-muted-foreground">PDF → store questions</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {nav.map((item) => (
            <button key={item.id} type="button" onClick={() => setTab(item.id)} className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-sm", tab === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              <item.icon className="h-4 w-4" />{item.label}
            </button>
          ))}
        </nav>
        <div className="space-y-1 border-t p-2">
          <Link to="/" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-muted"><BookOpen className="h-3.5 w-3.5" /> Practice</Link>
          <button type="button" onClick={() => { try { sessionStorage.removeItem(TOKEN_KEY); } catch {}; setToken(null); setAuthed(false); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-muted"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex gap-1 overflow-x-auto border-b px-3 py-2 lg:hidden">
          {nav.map((item) => (
            <button key={item.id} type="button" onClick={() => setTab(item.id)} className={cn("rounded-full px-3 py-1.5 text-[11px] whitespace-nowrap", tab === item.id ? "bg-primary text-primary-foreground" : "bg-muted")}>{item.label}</button>
          ))}
        </header>

        <main className="mx-auto max-w-4xl px-4 py-6">
          {tab === "overview" && (
            <div className="space-y-4">
              <h1 className="font-display text-2xl font-semibold">Overview</h1>
              <p className="text-sm text-muted-foreground">1) Department 2) Exam + public PDF 3) Generate ALL questions once 4) Users only Start quiz</p>
              <Button onClick={() => setTab("exams")}>Go to Exams</Button>
            </div>
          )}

          {tab === "departments" && (
            <div className="space-y-4">
              <h1 className="font-display text-2xl font-semibold">Departments</h1>
              <div className="flex flex-wrap gap-2">
                <Input value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="New department" className="h-10 max-w-xs rounded-xl" />
                <Button disabled={saving} onClick={async () => {
                  const name = newDeptName.trim();
                  if (!name) return toast.error("Enter name");
                  const id = uniqueDeptId(name, depts);
                  if (await persist({ ...catalog, departments: [...depts, { id, name, emoji: "📘", exams: [] }] })) {
                    setNewDeptName(""); toast.success("Added");
                  }
                }}><Plus className="mr-1 h-4 w-4" /> Add</Button>
              </div>
              <ul className="divide-y rounded-2xl border bg-card">
                {depts.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 px-4 py-3">
                    <span>{d.emoji || "📘"}</span>
                    <span className="flex-1 font-medium">{d.name}</span>
                    <span className="text-[11px] text-muted-foreground">{(d.exams || []).length} exams</span>
                    <Button size="sm" variant="outline" onClick={() => setEditingDept({ ...d })}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={async () => {
                      if (!confirm(`Delete ${d.name}?`)) return;
                      if (await persist({ ...catalog, departments: depts.filter((x) => x.id !== d.id) })) toast.success("Deleted");
                    }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === "exams" && (
            <div className="space-y-4">
              <div>
                <h1 className="font-display text-2xl font-semibold">Exams</h1>
                <p className="text-sm text-muted-foreground">Save PDF URL → Generate ALL questions once → users Start quiz</p>
              </div>
              {depts.map((d) => (
                <div key={d.id} className="rounded-2xl border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="font-semibold">{d.emoji} {d.name}</h2>
                    <Button size="sm" disabled={saving} onClick={async () => {
                      const exam: ExamEntry = {
                        id: `${d.id}-${Date.now()}`,
                        title: "New exam",
                        year: new Date().getFullYear(),
                        pdfUrl: null,
                        telegramFileId: null,
                      };
                      if (await persist({
                        ...catalog,
                        departments: depts.map((x) => x.id === d.id ? { ...x, exams: [...(x.exams || []), exam] } : x),
                      })) setEditingExam({ deptId: d.id, exam });
                    }}><Plus className="mr-1 h-3.5 w-3.5" /> Add exam</Button>
                  </div>
                  {(d.exams || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No exams</p>
                  ) : (
                    <ul className="divide-y rounded-xl border">
                      {(d.exams || []).map((exam) => (
                        <li key={exam.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{exam.title}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {[exam.pdfUrl ? "Has URL" : "No URL", exam.questions?.length ? `${exam.questions.length} Qs stored` : "No quiz yet"].join(" · ")}
                            </p>
                          </div>
                          <Button size="sm" disabled={!!genId || saving || !(exam.pdfUrl || exam.telegramFileId)} onClick={() => void genStore(d.id, exam)}>
                            {genId === exam.id ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />Gen…</> : <><Sparkles className="mr-1 h-3.5 w-3.5" />{exam.questions?.length ? "Re-gen all" : "Gen all Qs"}</>}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingExam({ deptId: d.id, exam: { ...exam } })}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="outline" className="text-destructive" onClick={async () => {
                            if (!confirm("Delete exam?")) return;
                            if (await persist({
                              ...catalog,
                              departments: depts.map((x) => x.id === d.id ? { ...x, exams: (x.exams || []).filter((e) => e.id !== exam.id) } : x),
                            })) toast.success("Deleted");
                          }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "settings" && (
            <div className="space-y-4">
              <h1 className="font-display text-2xl font-semibold">Settings</h1>
              <Button onClick={() => { exportDepartmentsJson(catalog); toast.success("Downloaded"); }}>Export JSON</Button>
              <Button variant="outline" onClick={async () => {
                try {
                  const res = await apiGetCatalog();
                  setCatalog(toCat(res));
                  toast.success("Reloaded");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}>Reload</Button>
            </div>
          )}
        </main>
      </div>

      {editingDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl border bg-card p-5">
            <div className="flex justify-between"><h3 className="font-semibold">Edit department</h3><button type="button" onClick={() => setEditingDept(null)}><X className="h-4 w-4" /></button></div>
            <Input value={editingDept.name} onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })} />
            <Input value={editingDept.emoji || ""} onChange={(e) => setEditingDept({ ...editingDept, emoji: e.target.value })} placeholder="Emoji" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingDept(null)}>Cancel</Button>
              <Button disabled={saving} onClick={async () => {
                const name = editingDept.name.trim();
                if (!name) return toast.error("Name required");
                if (await persist({
                  ...catalog,
                  departments: depts.map((d) => d.id === editingDept.id ? { ...d, name, emoji: editingDept.emoji || "📘" } : d),
                })) { setEditingDept(null); toast.success("Saved"); }
              }}><Save className="mr-1 h-4 w-4" /> Save</Button>
            </div>
          </div>
        </div>
      )}

      {editingExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl border bg-card p-5">
            <div className="flex justify-between"><h3 className="font-semibold">Edit exam</h3><button type="button" onClick={() => setEditingExam(null)}><X className="h-4 w-4" /></button></div>
            <div className="space-y-1"><Label>Title</Label><Input value={editingExam.exam.title} onChange={(e) => setEditingExam({ ...editingExam, exam: { ...editingExam.exam, title: e.target.value } })} /></div>
            <div className="space-y-1"><Label>PDF/DOCX public URL</Label><Input value={editingExam.exam.pdfUrl ?? ""} onChange={(e) => setEditingExam({ ...editingExam, exam: { ...editingExam.exam, pdfUrl: e.target.value || null } })} placeholder="https://…" /></div>
            <div className="space-y-1"><Label>Questions (0 = entire PDF/DOCX)</Label><Input value={genCount} onChange={(e) => setGenCount(e.target.value)} inputMode="numeric" placeholder="0 = all" /><p className="text-[10px] text-muted-foreground">Leave 0 to generate from the full document once (all sections). Optional: set a number up to 200.</p></div>
            {editingExam.exam.questions?.length ? <p className="text-[11px] text-muted-foreground">Stored {editingExam.exam.questions.length} Qs for users</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingExam(null)}>Cancel</Button>
              <Button variant="secondary" disabled={!!genId || saving || !(editingExam.exam.pdfUrl || editingExam.exam.telegramFileId)} onClick={() => void genStore(editingExam.deptId, editingExam.exam)}>
                {genId === editingExam.exam.id ? "Generating full document…" : "Generate all & store"}
              </Button>
              <Button disabled={saving || !!genId} onClick={async () => {
                const title = editingExam.exam.title.trim();
                if (!title) return toast.error("Title required");
                const exam: ExamEntry = {
                  ...editingExam.exam,
                  title,
                  pdfUrl: editingExam.exam.pdfUrl?.trim() || null,
                  telegramFileId: editingExam.exam.telegramFileId?.trim() || null,
                  questions: editingExam.exam.questions,
                };
                if (await persist({
                  ...catalog,
                  departments: depts.map((d) =>
                    d.id === editingExam.deptId
                      ? { ...d, exams: (d.exams || []).map((e) => (e.id === exam.id ? exam : e)) }
                      : d,
                  ),
                })) { setEditingExam(null); toast.success("Saved"); }
              }}><Save className="mr-1 h-4 w-4" /> Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
