import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LayoutDashboard, Building2, FileText, Settings, LogOut, Plus, Trash2, BookOpen, Shield, Pencil, X, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Catalog, Department, TabId } from "@/components/admin-types";
import { uniqueDeptId } from "@/components/admin-catalog";
import { AdminCatalogActions } from "@/components/AdminCatalogActions";
import { apiAdminLogin, apiGetCatalog, apiSaveCatalog } from "@/lib/admin-api";
import { AdminExamManagement } from "@/components/AdminExamManagement";

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
  const [tab, setTab] = useState<TabId>("overview");
  const [catalog, setCatalog] = useState<Catalog>(EMPTY);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [newDeptName, setNewDeptName] = useState("");
  const [saving, setSaving] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [appUrl, setAppUrl] = useState("https://exit.sites.bd");
  const [channelUrl, setChannelUrl] = useState("https://t.me/exitexamto");
  const [channelUsername, setChannelUsername] = useState("@exitexamto");

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const t = sessionStorage.getItem(TOKEN_KEY);
        if (t) { setToken(t); setAuthed(true); }
      } catch {}
      try {
        const res = await apiGetCatalog();
        if (!c) {
          setCatalog(toCat(res));
          const cat = res?.catalog as { appUrl?: string; channelUrl?: string; channelUsername?: string } | undefined;
          if (cat?.appUrl) setAppUrl(String(cat.appUrl));
          if (cat?.channelUrl) setChannelUrl(String(cat.channelUrl));
          if (cat?.channelUsername) setChannelUsername(String(cat.channelUsername));
        }
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
        appUrl: appUrl.trim() || "https://exit.sites.bd",
        channelUrl: channelUrl.trim() || "https://t.me/exitexamto",
        channelUsername: channelUsername.trim() || "@exitexamto",
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
  }, [token, saving, appUrl, channelUrl, channelUsername]);

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
    { id: "exams", label: "Exam management", icon: FileText },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  const totalExams = depts.reduce((s, d) => s + (d.exams || []).length, 0);
  const readyExams = depts.reduce((s, d) => s + (d.exams || []).filter((e) => e.questions && e.questions.length > 0).length, 0);
  const totalQs = depts.reduce((s, d) => s + (d.exams || []).reduce((a, e) => a + (e.questions?.length || 0), 0), 0);

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
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">Overview</h1>
                <p className="mt-1 text-sm text-muted-foreground">Catalog status and quick actions for stored practice exams.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Departments", value: depts.length },
                  { label: "Exams", value: totalExams },
                  { label: "Ready quizzes", value: readyExams },
                  { label: "Questions", value: totalQs },
                ].map((s) => (
                  <div key={s.label} className="rounded-2xl border bg-card p-4 shadow-sm">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
                <p className="text-sm font-semibold">Workflow</p>
                <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <li><span className="font-medium text-foreground">1.</span> Add a department</li>
                  <li><span className="font-medium text-foreground">2.</span> Create an exam with a public PDF/DOCX link</li>
                  <li><span className="font-medium text-foreground">3.</span> Generate all questions once and store them</li>
                  <li><span className="font-medium text-foreground">4.</span> Users open Department → Exam → Start quiz</li>
                </ol>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => setTab("departments")}><Building2 className="mr-1.5 h-4 w-4" /> Departments</Button>
                <Button type="button" variant="outline" onClick={() => setTab("exams")}><FileText className="mr-1.5 h-4 w-4" /> Exam management</Button>
                <Button type="button" variant="outline" onClick={() => setTab("settings")}><Settings className="mr-1.5 h-4 w-4" /> Settings</Button>
                <Link to="/" className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"><BookOpen className="mr-1.5 h-4 w-4" /> Open practice site</Link>
              </div>
              {catalog.updatedAt && catalog.updatedAt !== new Date(0).toISOString() && (
                <p className="text-[11px] text-muted-foreground">Catalog updated {new Date(catalog.updatedAt).toLocaleString()}</p>
              )}
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
            <AdminExamManagement catalog={catalog} saving={saving} persist={persist} />
          )}

          {tab === "settings" && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
                <p className="mt-1 text-sm text-muted-foreground">App links and catalog backup / import.</p>
              </div>
              <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
                <p className="text-sm font-semibold">App links</p>
                <div className="space-y-2">
                  <Label>App URL</Label>
                  <Input value={appUrl} onChange={(e) => setAppUrl(e.target.value)} className="h-10 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label>Channel URL</Label>
                  <Input value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} className="h-10 rounded-xl" />
                </div>
                <div className="space-y-2">
                  <Label>Channel username</Label>
                  <Input value={channelUsername} onChange={(e) => setChannelUsername(e.target.value)} className="h-10 rounded-xl" />
                </div>
                <Button type="button" disabled={saving} onClick={async () => {
                  if (await persist({ ...catalog, updatedAt: new Date().toISOString() })) toast.success("Settings saved");
                }}>
                  <Save className="mr-1.5 h-4 w-4" /> Save settings
                </Button>
              </div>
              <AdminCatalogActions
                catalog={catalog}
                saving={saving}
                persist={persist}
                onReload={async () => {
                  const res = await apiGetCatalog();
                  setCatalog(toCat(res));
                  const cat = res?.catalog as { appUrl?: string; channelUrl?: string; channelUsername?: string } | undefined;
                  if (cat?.appUrl) setAppUrl(String(cat.appUrl));
                  if (cat?.channelUrl) setChannelUrl(String(cat.channelUrl));
                  if (cat?.channelUsername) setChannelUsername(String(cat.channelUsername));
                  toast.success("Reloaded from server");
                }}
              />
              <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
                <p className="text-sm font-semibold">Session</p>
                <Button type="button" variant="outline" className="text-destructive" onClick={() => {
                  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
                  setToken(null); setAuthed(false); toast.success("Signed out");
                }}>
                  <LogOut className="mr-1.5 h-4 w-4" /> Sign out
                </Button>
              </div>
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
              <Button onClick={async () => {
                const name = editingDept.name.trim();
                if (!name) return toast.error("Name required");
                if (await persist({
                  ...catalog,
                  departments: depts.map((d) => d.id === editingDept.id ? { ...editingDept, name } : d),
                })) { setEditingDept(null); toast.success("Saved"); }
              }}><Save className="mr-1 h-4 w-4" /> Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
