import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard, Building2, FileText, Settings, LogOut, Plus, Trash2,
  ExternalLink, MessageCircle, BookOpen, Shield, Search, Pencil, X, Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Catalog, Department, ExamEntry, TabId } from "@/components/admin-types";
import {
  ADMIN_SESSION_KEY, SEED, loadCatalog, saveCatalog, getPin, slugify, exportDepartmentsJson,
} from "@/components/admin-catalog";

export function AdminDashboard() {
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [tab, setTab] = useState<TabId>("overview");
  const [catalog, setCatalog] = useState<Catalog>(SEED);
  const [search, setSearch] = useState("");
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [editingExam, setEditingExam] = useState<{ deptId: string; exam: ExamEntry } | null>(null);
  const [newDeptName, setNewDeptName] = useState("");

  useEffect(() => {
    try {
      if (sessionStorage.getItem(ADMIN_SESSION_KEY) === "1") setAuthed(true);
    } catch { /* ignore */ }
    setCatalog(loadCatalog());
  }, []);

  const persist = useCallback((next: Catalog) => setCatalog(saveCatalog(next)), []);

  const stats = useMemo(() => {
    const depts = catalog.departments.length;
    const exams = catalog.departments.reduce((n, d) => n + d.exams.length, 0);
    const withPdf = catalog.departments.reduce(
      (n, d) => n + d.exams.filter((e) => e.pdfUrl || e.telegramFileId).length, 0,
    );
    return { depts, exams, withPdf, missing: exams - withPdf };
  }, [catalog]);

  const filteredDepts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog.departments;
    return catalog.departments.filter(
      (d) => d.name.toLowerCase().includes(q) || d.id.includes(q) ||
        d.exams.some((e) => e.title.toLowerCase().includes(q)),
    );
  }, [catalog, search]);

  const login = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === getPin()) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
      setAuthed(true);
      setPinError("");
      setPin("");
    } else setPinError("Incorrect password");
  };

  const logout = () => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    setAuthed(false);
  };

  const addDepartment = () => {
    const name = newDeptName.trim();
    if (!name) return;
    const id = slugify(name);
    if (catalog.departments.some((d) => d.id === id)) return alert("Department id already exists");
    persist({ ...catalog, departments: [...catalog.departments, { id, name, emoji: "📘", exams: [] }] });
    setNewDeptName("");
  };

  const removeDepartment = (id: string) => {
    if (!confirm("Delete this department and all its exams?")) return;
    persist({ ...catalog, departments: catalog.departments.filter((d) => d.id !== id) });
  };

  const saveDepartment = (dept: Department) => {
    persist({ ...catalog, departments: catalog.departments.map((d) => (d.id === dept.id ? dept : d)) });
    setEditingDept(null);
  };

  const addExam = (deptId: string) => {
    const exam: ExamEntry = {
      id: `${deptId}-${Date.now()}`, title: "New exam PDF", year: new Date().getFullYear(),
      pdfUrl: null, telegramFileId: null,
    };
    persist({
      ...catalog,
      departments: catalog.departments.map((d) =>
        d.id === deptId ? { ...d, exams: [...d.exams, exam] } : d),
    });
    setEditingExam({ deptId, exam });
  };

  const saveExam = (deptId: string, exam: ExamEntry) => {
    persist({
      ...catalog,
      departments: catalog.departments.map((d) =>
        d.id === deptId ? { ...d, exams: d.exams.map((e) => (e.id === exam.id ? exam : e)) } : d),
    });
    setEditingExam(null);
  };

  const removeExam = (deptId: string, examId: string) => {
    if (!confirm("Delete this exam entry?")) return;
    persist({
      ...catalog,
      departments: catalog.departments.map((d) =>
        d.id === deptId ? { ...d, exams: d.exams.filter((e) => e.id !== examId) } : d),
    });
  };

  if (!authed) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <form onSubmit={login} className="w-full max-w-sm space-y-5 rounded-3xl border border-border/70 bg-card p-8 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Shield className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight">Admin login</h1>
              <p className="text-xs text-muted-foreground">Exit Exam dashboard</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pin">Password</Label>
            <Input id="pin" type="password" value={pin} onChange={(e) => setPin(e.target.value)}
              className="h-11 rounded-2xl" autoFocus placeholder="Enter admin password" />
            {pinError && <p className="text-xs text-destructive">{pinError}</p>}
          </div>
          <Button type="submit" className="h-11 w-full rounded-2xl font-semibold">Sign in</Button>
          <p className="text-center text-[11px] text-muted-foreground">
            Default: <code className="rounded bg-muted px-1">admin123</code>
          </p>
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
          <a href="https://t.me/exitexamto" target="_blank" rel="noreferrer"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
            <MessageCircle className="h-3.5 w-3.5 text-[#229ED9]" /> Telegram
          </a>
          <Link to="/" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
            <BookOpen className="h-3.5 w-3.5" /> Open practice app
          </Link>
          <button type="button" onClick={logout}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/60 bg-card/90 px-3 py-3 backdrop-blur lg:hidden">
          <p className="font-display text-sm font-semibold">Admin</p>
          <div className="flex gap-1 overflow-x-auto">
            {nav.map((item) => (
              <button key={item.id} type="button" onClick={() => setTab(item.id)}
                className={cn("rounded-full px-3 py-1.5 text-[11px] font-medium",
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
                <p className="mt-1 text-sm text-muted-foreground">Manage departments and exam PDFs for the app & Telegram bot.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Departments", value: stats.depts, c: "text-violet-800" },
                  { label: "Exam entries", value: stats.exams, c: "text-sky-800" },
                  { label: "With PDF / file_id", value: stats.withPdf, c: "text-emerald-800" },
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
                    <Button variant="outline" className="rounded-xl" onClick={() => exportDepartmentsJson(catalog)}>Export JSON</Button>
                  </div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
                  <h2 className="font-display text-base font-semibold">Links</h2>
                  <ul className="mt-3 space-y-2 text-sm">
                    <li><a className="inline-flex items-center gap-1 text-[#0b6bcb] hover:underline" href="https://yeniexams.vercel.app" target="_blank" rel="noreferrer">Practice app <ExternalLink className="h-3 w-3" /></a></li>
                    <li><a className="inline-flex items-center gap-1 text-[#229ED9] hover:underline" href="https://t.me/exitexamto" target="_blank" rel="noreferrer">Telegram @exitexamto <ExternalLink className="h-3 w-3" /></a></li>
                    <li className="text-xs text-muted-foreground">Last saved: {new Date(catalog.updatedAt).toLocaleString()}</li>
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
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-10 w-48 rounded-xl pl-9" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 rounded-2xl border border-dashed border-border bg-muted/20 p-3">
                <Input value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="New department name"
                  className="h-10 max-w-xs rounded-xl" onKeyDown={(e) => e.key === "Enter" && addDepartment()} />
                <Button type="button" className="h-10 rounded-xl" onClick={addDepartment}><Plus className="mr-1 h-4 w-4" /> Add</Button>
              </div>
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border/60 bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Department</th>
                      <th className="px-4 py-3 font-medium">ID</th>
                      <th className="px-4 py-3 font-medium">Exams</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDepts.map((d) => (
                      <tr key={d.id} className="border-b border-border/40 last:border-0">
                        <td className="px-4 py-3"><span className="mr-2">{d.emoji}</span>{d.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{d.id}</td>
                        <td className="px-4 py-3 tabular-nums">{d.exams.length}</td>
                        <td className="px-4 py-3 text-right">
                          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg" onClick={() => setEditingDept({ ...d })}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg text-destructive" onClick={() => removeDepartment(d.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </td>
                      </tr>
                    ))}
                    {filteredDepts.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No departments yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "exams" && (
            <div className="space-y-5">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">Exam PDFs</h1>
                <p className="mt-1 text-sm text-muted-foreground">Link each paper to a <code className="rounded bg-muted px-1">pdfUrl</code> or Telegram <code className="rounded bg-muted px-1">file_id</code>.</p>
              </div>
              {catalog.departments.map((d) => (
                <div key={d.id} className="rounded-2xl border border-border/70 bg-card shadow-sm">
                  <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                    <h2 className="font-display text-sm font-semibold">{d.emoji} {d.name}</h2>
                    <Button type="button" size="sm" className="h-8 rounded-lg" onClick={() => addExam(d.id)}><Plus className="mr-1 h-3.5 w-3.5" /> Add exam</Button>
                  </div>
                  <ul className="divide-y divide-border/40">
                    {d.exams.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted-foreground">No exams</li>}
                    {d.exams.map((exam) => (
                      <li key={exam.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{exam.title}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {exam.year ?? "—"} · {exam.telegramFileId ? "Telegram file_id set" : exam.pdfUrl ? "PDF URL set" : "No file linked"}
                          </p>
                        </div>
                        <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => setEditingExam({ deptId: d.id, exam: { ...exam } })}>Edit</Button>
                        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg text-destructive" onClick={() => removeExam(d.id, exam.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {tab === "settings" && (
            <div className="max-w-xl space-y-5">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
                <p className="mt-1 text-sm text-muted-foreground">Admin access and data export.</p>
              </div>
              <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
                <div>
                  <Label>Change admin password (this browser)</Label>
                  <div className="mt-2 flex gap-2">
                    <Input type="password" id="new-pin" placeholder="New password (min 4 chars)" className="h-10 rounded-xl" />
                    <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={() => {
                      const el = document.getElementById("new-pin") as HTMLInputElement | null;
                      const v = el?.value.trim() || "";
                      if (v.length < 4) return alert("Use at least 4 characters");
                      localStorage.setItem("exit-exam-admin-pin", v);
                      alert("Password updated");
                      if (el) el.value = "";
                    }}>Save</Button>
                  </div>
                </div>
                <Button type="button" className="rounded-xl" onClick={() => exportDepartmentsJson(catalog)}>Download departments.json</Button>
                <p className="text-[11px] text-muted-foreground">
                  Use exported JSON in <code className="rounded bg-muted px-1">telegram-bot/departments.json</code>.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {editingDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold">Edit department</h3>
              <button type="button" onClick={() => setEditingDept(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2"><Label>Name</Label>
              <Input value={editingDept.name} onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })} className="h-10 rounded-xl" />
            </div>
            <div className="space-y-2"><Label>Emoji</Label>
              <Input value={editingDept.emoji} onChange={(e) => setEditingDept({ ...editingDept, emoji: e.target.value })} className="h-10 rounded-xl" />
            </div>
            <Button className="w-full rounded-xl" onClick={() => saveDepartment(editingDept)}><Save className="mr-2 h-4 w-4" /> Save</Button>
          </div>
        </div>
      )}

      {editingExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold">Edit exam</h3>
              <button type="button" onClick={() => setEditingExam(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2"><Label>Title</Label>
              <Input value={editingExam.exam.title} onChange={(e) => setEditingExam({ ...editingExam, exam: { ...editingExam.exam, title: e.target.value } })} className="h-10 rounded-xl" />
            </div>
            <div className="space-y-2"><Label>Year</Label>
              <Input type="number" value={editingExam.exam.year ?? ""} onChange={(e) => setEditingExam({ ...editingExam, exam: { ...editingExam.exam, year: e.target.value ? Number(e.target.value) : null } })} className="h-10 rounded-xl" />
            </div>
            <div className="space-y-2"><Label>PDF URL</Label>
              <Input value={editingExam.exam.pdfUrl ?? ""} onChange={(e) => setEditingExam({ ...editingExam, exam: { ...editingExam.exam, pdfUrl: e.target.value || null } })} placeholder="https://…" className="h-10 rounded-xl" />
            </div>
            <div className="space-y-2"><Label>Telegram file_id</Label>
              <Input value={editingExam.exam.telegramFileId ?? ""} onChange={(e) => setEditingExam({ ...editingExam, exam: { ...editingExam.exam, telegramFileId: e.target.value || null } })} placeholder="BQACAg…" className="h-10 rounded-xl" />
            </div>
            <Button className="w-full rounded-xl" onClick={() => saveExam(editingExam.deptId, editingExam.exam)}><Save className="mr-2 h-4 w-4" /> Save</Button>
          </div>
        </div>
      )}
    </div>
  );
}
