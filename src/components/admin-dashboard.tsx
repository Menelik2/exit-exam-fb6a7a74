import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard, Building2, FileText, Settings, LogOut, Plus, Trash2,
  ExternalLink, MessageCircle, BookOpen, Shield, Search, Pencil, X, Save,
  Upload, RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Catalog, Department, ExamEntry, TabId } from "@/components/admin-types";
import { uniqueDeptId, exportDepartmentsJson } from "@/components/admin-catalog";
import { apiAdminLogin, apiGetCatalog, apiSaveCatalog } from "@/lib/admin-api";

const EMPTY_CATALOG: Catalog = { departments: [], updatedAt: new Date(0).toISOString() };
const ADMIN_TOKEN_KEY = "exit-exam-admin-token-v2";

function toLocalCatalog(res: unknown): Catalog {
  const r = res as { catalog?: { departments?: Catalog["departments"]; updatedAt?: string } } | null;
  const depts = r?.catalog?.departments;
  return {
    departments: Array.isArray(depts) ? depts : [],
    updatedAt: r?.catalog?.updatedAt || new Date().toISOString(),
  };
}

export function AdminDashboard() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [pin, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [tab, setTab] = useState<TabId>("overview");
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [search, setSearch] = useState("");
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [editingExam, setEditingExam] = useState<{ deptId: string; exam: ExamEntry } | null>(null);
  const [newDeptName, setNewDeptName] = useState("");
  const [saving, setSaving] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<"github" | "github-readonly" | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
        if (token) {
          setAdminToken(token);
          setAuthed(true);
        }
      } catch { /* ignore */ }
      try {
        const res = await apiGetCatalog();
        if (cancelled) return;
        setCatalog(toLocalCatalog(res));
        setStorageMode(res.storage || "github-readonly");
      } catch (e) {
        if (!cancelled) {
          setCatalog(EMPTY_CATALOG);
          toast.error((e as Error).message || "Failed to load catalog");
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(async (next: Catalog) => {
    if (!adminToken) {
      toast.error("Session expired — sign in again");
      setAuthed(false);
      return false;
    }
    try {
      const res = await apiSaveCatalog(adminToken, {
        departments: next.departments || [],
        updatedAt: next.updatedAt,
        appUrl: "https://yeniexams.vercel.app",
        channelUrl: "https://t.me/exitexamto",
        channelUsername: "@exitexamto",
      });
      setCatalog(toLocalCatalog(res));
      setStorageMode("github");
      return true;
    } catch (e) {
      const msg = (e as Error).message || "Save failed";
      toast.error(msg);
      if (msg.toLowerCase().includes("session")) {
        setAuthed(false);
        setAdminToken(null);
        try { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch {}
      }
      return false;
    }
  }, [adminToken]);

  const stats = useMemo(() => {
    const list = Array.isArray(catalog?.departments) ? catalog.departments : [];
    const depts = list.length;
    const exams = list.reduce((n, d) => n + (d.exams?.length || 0), 0);
    const withPdf = list.reduce(
      (n, d) => n + (d.exams || []).filter((e) => !!(e.pdfUrl || e.telegramFileId)).length, 0);
    return { depts, exams, withPdf, missing: Math.max(0, exams - withPdf) };
  }, [catalog]);

  const filteredDepts = useMemo(() => {
    const list = Array.isArray(catalog?.departments) ? catalog.departments : [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((d) =>
      d.name.toLowerCase().includes(q) || d.id.includes(q) ||
      (d.exams || []).some((e) => e.title.toLowerCase().includes(q)));
  }, [catalog, search]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    const entered = pin.trim();
    if (!entered) {
      setPinError("Enter password");
      return;
    }
    setLoggingIn(true);
    setPinError("");
    try {
      const res = await apiAdminLogin(entered);
      if (!res?.ok || !res.token) {
        setPinError(res?.error || "Incorrect password");
        return;
      }
      try { sessionStorage.setItem(ADMIN_TOKEN_KEY, res.token); } catch {}
      setAdminToken(res.token);
      setAuthed(true);
      setPinInput("");
      try {
        const cat = await apiGetCatalog();
        setCatalog(toLocalCatalog(cat));
        setStorageMode(cat.storage || "github-readonly");
      } catch {
        setCatalog(EMPTY_CATALOG);
      }
      toast.success("Signed in");
    } catch (err) {
      setPinError((err as Error)?.message || "Login failed");
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = () => {
    try { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch {}
    setAdminToken(null);
    setAuthed(false);
    toast.message("Signed out");
  };

  const depts = catalog.departments || [];

  const addDepartment = async () => {
    const name = newDeptName.trim();
    if (!name) return toast.error("Enter a department name");
    const id = uniqueDeptId(name, depts);
    const ok = await persist({ ...catalog, departments: [...depts, { id, name, emoji: "📘", exams: [] }] });
    if (ok) {
      setNewDeptName("");
      toast.success(`Added "${name}"`);
    }
  };

  const removeDepartment = async (id: string) => {
    const dept = depts.find((d) => d.id === id);
    if (!dept || !confirm(`Delete "${dept.name}" and ${(dept.exams || []).length} exam(s)?`)) return;
    if (await persist({ ...catalog, departments: depts.filter((d) => d.id !== id) }))
      toast.success("Department deleted");
  };

  const saveDepartment = async () => {
    if (!editingDept) return;
    const name = editingDept.name.trim();
    if (!name) return toast.error("Department name is required");
    const emoji = (editingDept.emoji || "📘").trim() || "📘";
    if (await persist({
      ...catalog,
      departments: depts.map((d) => d.id === editingDept.id ? { ...d, name, emoji } : d),
    })) {
      setEditingDept(null);
      toast.success("Department saved");
    }
  };

  const addExam = async (deptId: string) => {
    const exam: ExamEntry = {
      id: `${deptId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: "New exam document",
      year: new Date().getFullYear(),
      pdfUrl: null,
      telegramFileId: null,
    };
    if (await persist({
      ...catalog,
      departments: depts.map((d) =>
        d.id === deptId ? { ...d, exams: [...(d.exams || []), exam] } : d),
    })) setEditingExam({ deptId, exam: { ...exam } });
  };

  const saveExam = async () => {
    if (!editingExam) return;
    const title = editingExam.exam.title.trim();
    if (!title) return toast.error("Exam title is required");
    const exam: ExamEntry = {
      ...editingExam.exam,
      title,
      pdfUrl: editingExam.exam.pdfUrl?.trim() || null,
      telegramFileId: editingExam.exam.telegramFileId?.trim() || null,
      year: editingExam.exam.year == null || Number.isNaN(Number(editingExam.exam.year))
        ? null : Number(editingExam.exam.year),
    };
    if (await persist({
      ...catalog,
      departments: depts.map((d) =>
        d.id === editingExam.deptId
          ? {
              ...d,
              exams: (d.exams || []).some((e) => e.id === exam.id)
                ? (d.exams || []).map((e) => (e.id === exam.id ? exam : e))
                : [...(d.exams || []), exam],
            }
          : d),
    })) {
      setEditingExam(null);
      toast.success("Exam saved");
    }
  };

  const removeExam = async (deptId: string, examId: string) => {
    if (!confirm("Delete this exam entry?")) return;
    if (await persist({
      ...catalog,
      departments: depts.map((d) =>
        d.id === deptId ? { ...d, exams: (d.exams || []).filter((e) => e.id !== examId) } : d),
    })) toast.success("Exam deleted");
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    setSaving(true);
    try {
      const parsed = JSON.parse(await file.text()) as { departments?: Catalog["departments"] };
      if (!Array.isArray(parsed.departments)) throw new Error("Invalid JSON — need departments array");
      const ok = await persist({
        departments: parsed.departments,
        updatedAt: new Date().toISOString(),
      });
      if (ok) toast.success(`Saved ${parsed.departments.length} department(s) to server`);
    } catch (e) {
      toast.error((e as Error).message || "Import failed");
    } finally {
      setSaving(false);
    }
  };

  const reloadFromServer = async () => {
    try {
      const res = await apiGetCatalog();
      setCatalog(toLocalCatalog(res));
      setStorageMode(res.storage || "github-readonly");
      toast.success("Reloaded from server");
    } catch (e) {
      toast.error((e as Error).message || "Reload failed");
    }
  };

  if (!ready) {
    return <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Loading admin…</div>;
  }

  if (!authed) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <form onSubmit={login} className="w-full max-w-sm space-y-5 rounded-3xl border border-border/70 bg-card p-8 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><Shield className="h-5 w-5" /></span>
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight">Admin login</h1>
              <p className="text-xs text-muted-foreground">Exit Exam dashboard</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pin">Password</Label>
            <Input id="pin" type="password" value={pin} onChange={(e) => { setPinInput(e.target.value); if (pinError) setPinError(""); }}
              className="h-11 rounded-2xl" autoFocus autoComplete="current-password" placeholder="Enter admin password" />
            {pinError && <p className="text-xs text-destructive">{pinError}</p>}
          </div>
          <Button type="submit" className="h-11 w-full rounded-2xl font-semibold" disabled={loggingIn}>{loggingIn ? "Signing in…" : "Sign in"}</Button>
          <p className="text-center text-[11px] text-muted-foreground">Uses Vercel env <code className="rounded bg-muted px-1">ADMIN_PASSWORD</code>. Example: your value <code className="rounded bg-muted px-1">123!@#Linux</code></p>
          <Link to="/" className="block text-center text-xs text-muted-foreground underline">← Back to practice app</Link>
        </form>
      </div>
    );
  }

  const nav: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "departments", label: "Departments", icon: Building2 },
    { id: "exams", label: "Exam PDFs", icon: FileText },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border/70 bg-card lg:flex">
        <div className="border-b border-border/60 px-5 py-5">
          <p className="font-display text-base font-semibold tracking-tight">Admin</p>
          <p className="text-[11px] text-muted-foreground">Exit Exam Practice</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {nav.map((item) => (
            <button key={item.id} type="button" onClick={() => setTab(item.id)}
              className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                tab === item.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <item.icon className="h-4 w-4" />{item.label}
            </button>
          ))}
        </nav>
        <div className="space-y-2 border-t border-border/60 p-3">
          <a href="https://t.me/exitexamto" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
            <MessageCircle className="h-3.5 w-3.5 text-[#229ED9]" /> Telegram
          </a>
          <Link to="/" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
            <BookOpen className="h-3.5 w-3.5" /> Open practice app
          </Link>
          <button type="button" onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border/60 bg-card/90 px-3 py-3 backdrop-blur lg:hidden">
          <p className="font-display text-sm font-semibold">Admin</p>
          <div className="flex gap-1 overflow-x-auto">
            {nav.map((item) => (
              <button key={item.id} type="button" onClick={() => setTab(item.id)}
                className={cn("rounded-full px-3 py-1.5 text-[11px] font-medium whitespace-nowrap",
                  tab === item.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {tab === "overview" && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">Overview</h1>
                <p className="mt-1 text-sm text-muted-foreground">Manage departments and exam documents for the app & Telegram bot.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Departments", value: stats.depts, c: "text-violet-800" },
                  { label: "Exam entries", value: stats.exams, c: "text-sky-800" },
                  { label: "With file linked", value: stats.withPdf, c: "text-emerald-800" },
                  { label: "Missing file", value: stats.missing, c: "text-amber-800" },
                ].map((s) => (
                  <div key={s.label} className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={cn("mt-2 font-display text-3xl font-bold tabular-nums", s.c)}>{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
                  <h2 className="font-display text-base font-semibold">Quick actions</h2>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button className="rounded-xl" onClick={() => setTab("departments")}><Building2 className="mr-2 h-4 w-4" /> Departments</Button>
                    <Button variant="outline" className="rounded-xl" onClick={() => setTab("exams")}><FileText className="mr-2 h-4 w-4" /> Exam PDFs</Button>
                    <Button variant="outline" className="rounded-xl" onClick={() => { exportDepartmentsJson(catalog); toast.success("Downloaded departments.json"); }}>Export JSON</Button>
                  </div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
                  <h2 className="font-display text-base font-semibold">Links</h2>
                  <ul className="mt-3 space-y-2 text-sm">
                    <li><a className="inline-flex items-center gap-1 text-[#0b6bcb] hover:underline" href="https://yeniexams.vercel.app" target="_blank" rel="noreferrer">Practice app <ExternalLink className="h-3 w-3" /></a></li>
                    <li><a className="inline-flex items-center gap-1 text-[#229ED9] hover:underline" href="https://t.me/exitexamto" target="_blank" rel="noreferrer">Telegram @exitexamto <ExternalLink className="h-3 w-3" /></a></li>
                    <li className="text-xs text-muted-foreground">Last saved: {new Date(catalog.updatedAt).toLocaleString()}</li>
                    <li className="text-xs text-muted-foreground">Storage: {storageMode === "github" ? "Server (GitHub)" : storageMode === "github-readonly" ? "Server read-only" : "…"}</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {tab === "departments" && (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="font-display text-2xl font-semibold tracking-tight">Departments</h1>
                  <p className="mt-1 text-sm text-muted-foreground">Add or edit departments for the bot & site.</p>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-10 w-full rounded-xl pl-9 sm:w-56" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Input value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="New department name" className="h-10 max-w-xs rounded-xl" onKeyDown={(e) => { if (e.key === "Enter") void addDepartment(); }} />
                <Button className="h-10 rounded-xl" onClick={() => void addDepartment()}><Plus className="mr-1 h-4 w-4" /> Add</Button>
              </div>
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/60 bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Department</th>
                      <th className="px-4 py-3 font-medium">Exams</th>
                      <th className="px-4 py-3 font-medium">Id</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDepts.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No departments yet</td></tr>
                    ) : filteredDepts.map((d) => (
                      <tr key={d.id} className="border-b border-border/40 last:border-0">
                        <td className="px-4 py-3 font-medium">{d.emoji || "📘"} {d.name}</td>
                        <td className="px-4 py-3 tabular-nums">{(d.exams || []).length}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{d.id}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => setEditingDept({ ...d })}><Pencil className="mr-1 h-3 w-3" /> Edit</Button>
                            <Button size="sm" variant="outline" className="h-8 rounded-lg text-destructive" onClick={() => void removeDepartment(d.id)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "exams" && (
            <div className="space-y-5">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">Exam documents</h1>
                <p className="mt-1 text-sm text-muted-foreground">Link each paper via document URL or Telegram file_id.</p>
              </div>
              {(catalog.departments || []).map((d) => (
                <div key={d.id} className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-base font-semibold">{d.emoji || "📘"} {d.name}</h2>
                    <Button size="sm" className="h-8 rounded-lg" onClick={() => void addExam(d.id)}><Plus className="mr-1 h-3.5 w-3.5" /> Add exam</Button>
                  </div>
                  {(d.exams || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No exams linked yet.</p>
                  ) : (
                    <ul className="divide-y divide-border/50 rounded-xl border border-border/50">
                      {(d.exams || []).map((exam) => (
                        <li key={exam.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{exam.title}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {exam.year ?? "—"} · {exam.telegramFileId ? "Telegram file" : exam.pdfUrl ? "Document URL" : "No file linked"}
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => setEditingExam({ deptId: d.id, exam: { ...exam } })}><Pencil className="h-3 w-3" /></Button>
                            <Button size="sm" variant="outline" className="h-8 rounded-lg text-destructive" onClick={() => void removeExam(d.id, exam.id)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "settings" && (
            <div className="space-y-5">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
                <p className="mt-1 text-sm text-muted-foreground">Admin access and catalog data.</p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm space-y-4">
                <p className="text-sm text-muted-foreground">
                  Catalog is stored on the server in <code className="rounded bg-muted px-1">telegram-bot/departments.json</code>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="rounded-xl" onClick={() => { exportDepartmentsJson(catalog); toast.success("Downloaded departments.json"); }}>Download JSON</Button>
                  <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-medium hover:bg-muted">
                    <Upload className="h-4 w-4" />{saving ? "Importing…" : "Import JSON"}
                    <input type="file" className="sr-only" accept="application/json,.json" disabled={saving} onChange={(e) => void onImportFile(e.target.files?.[0] ?? null)} />
                  </label>
                  <Button type="button" variant="outline" className="rounded-xl" onClick={() => void reloadFromServer()}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Reload
                  </Button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {editingDept && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">Edit department</h3>
              <button type="button" onClick={() => setEditingDept(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2"><Label>Name</Label>
              <Input value={editingDept.name} onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })} className="h-10 rounded-xl" />
            </div>
            <div className="space-y-2"><Label>Emoji</Label>
              <Input value={editingDept.emoji || ""} onChange={(e) => setEditingDept({ ...editingDept, emoji: e.target.value })} className="h-10 rounded-xl" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setEditingDept(null)}>Cancel</Button>
              <Button className="rounded-xl" onClick={() => void saveDepartment()}><Save className="mr-1 h-4 w-4" /> Save</Button>
            </div>
          </div>
        </div>
      )}

      {editingExam && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">Edit exam</h3>
              <button type="button" onClick={() => setEditingExam(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2"><Label>Title</Label>
              <Input value={editingExam.exam.title} onChange={(e) => setEditingExam({ ...editingExam, exam: { ...editingExam.exam, title: e.target.value } })} className="h-10 rounded-xl" />
            </div>
            <div className="space-y-2"><Label>Year</Label>
              <Input type="number" value={editingExam.exam.year ?? ""} onChange={(e) => setEditingExam({ ...editingExam, exam: { ...editingExam.exam, year: e.target.value === "" ? null : Number(e.target.value) } })} className="h-10 rounded-xl" />
            </div>
            <div className="space-y-2"><Label>Document URL (PDF / DOCX / DOC)</Label>
              <Input value={editingExam.exam.pdfUrl ?? ""} onChange={(e) => setEditingExam({ ...editingExam, exam: { ...editingExam.exam, pdfUrl: e.target.value || null } })} placeholder="https://…" className="h-10 rounded-xl" />
            </div>
            <div className="space-y-2"><Label>Telegram file_id</Label>
              <Input value={editingExam.exam.telegramFileId ?? ""} onChange={(e) => setEditingExam({ ...editingExam, exam: { ...editingExam.exam, telegramFileId: e.target.value || null } })} placeholder="Optional" className="h-10 rounded-xl" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setEditingExam(null)}>Cancel</Button>
              <Button className="rounded-xl" onClick={() => void saveExam()}><Save className="mr-1 h-4 w-4" /> Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
