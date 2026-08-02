import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { saveGeminiKey, getGeminiKeyStatus, deleteGeminiKey } from "@/lib/user-key.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, KeyRound, LogOut, CheckCircle2, ExternalLink, UserCircle2 } from "lucide-react";

type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; email: string };

export function AccountPanel({ onAuthChange }: { onAuthChange?: (signedIn: boolean) => void }) {
  const navigate = useNavigate();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [keyStatus, setKeyStatus] = useState<
    { loading: true } | { loading: false; hasKey: boolean; last4?: string }
  >({ loading: true });
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const saveFn = useServerFn(saveGeminiKey);
  const statusFn = useServerFn(getGeminiKeyStatus);
  const deleteFn = useServerFn(deleteGeminiKey);

  const refreshKey = async () => {
    try {
      const s = await statusFn();
      setKeyStatus({ loading: false, hasKey: s.hasKey, last4: s.hasKey ? s.last4 : undefined });
    } catch {
      setKeyStatus({ loading: false, hasKey: false });
    }
  };

  useEffect(() => {
    const sync = async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setAuth({ status: "signed_in", email: data.user.email ?? "" });
        onAuthChange?.(true);
        await refreshKey();
      } else {
        setAuth({ status: "signed_out" });
        onAuthChange?.(false);
      }
    };
    sync();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") sync();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await saveFn({ data: { apiKey: apiKey.trim() } });
      setApiKey("");
      setEditing(false);
      await refreshKey();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onSignOut = async () => {
    await supabase.auth.signOut();
    setKeyStatus({ loading: false, hasKey: false });
    setAuth({ status: "signed_out" });
    onAuthChange?.(false);
  };

  const onRemoveKey = async () => {
    if (!confirm("Remove your saved Gemini API key?")) return;
    await deleteFn();
    await refreshKey();
  };

  if (auth.status === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading account…
      </div>
    );
  }

  if (auth.status === "signed_out") {
    return (
      <div className="rounded-2xl border border-border bg-card/70 p-4">
        <div className="flex items-center gap-2 mb-2">
          <UserCircle2 className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Sign in to generate exams</p>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Every user brings their own free Gemini API key.
        </p>
        <Button
          type="button"
          onClick={() => navigate({ to: "/auth" })}
          className="h-10 w-full rounded-xl"
        >
          Sign in / Sign up
        </Button>
      </div>
    );
  }

  const showForm = editing || (keyStatus.loading === false && !keyStatus.hasKey);

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card/70 p-4">
      <div className="space-y-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <UserCircle2 className="h-3 w-3" /> Signed in
          </p>
          <p className="truncate text-sm font-semibold text-foreground">{auth.email}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onSignOut}
          className="h-9 w-full rounded-lg text-xs text-destructive hover:text-destructive gap-1.5"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </Button>
      </div>

      <div className="border-t border-border pt-3">
        {keyStatus.loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Checking Gemini key…
          </div>
        ) : keyStatus.hasKey && !editing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span className="font-semibold text-foreground">Gemini key connected</span>
              <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ••••{keyStatus.last4}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-8 flex-1 rounded-lg text-xs"
                onClick={() => setEditing(true)}
              >
                Replace
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-8 flex-1 rounded-lg text-xs text-destructive hover:text-destructive"
                onClick={onRemoveKey}
              >
                Remove
              </Button>
            </div>
          </div>
        ) : null}

        {showForm && (
          <form onSubmit={onSave} className="space-y-2">
            <div className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-primary" />
              <Label htmlFor="gkey" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Your Gemini API key
              </Label>
            </div>
            <Input
              id="gkey"
              type="password"
              placeholder="AIza..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="h-10 rounded-xl bg-card font-mono text-xs"
              required
              autoComplete="off"
            />
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              Get a free key from Google AI Studio <ExternalLink className="h-3 w-3" />
            </a>
            {err && <p className="text-xs text-destructive">{err}</p>}
            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={saving || apiKey.trim().length < 20} className="h-9 flex-1 rounded-lg text-xs">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save key"}
              </Button>
              {editing && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg text-xs"
                  onClick={() => { setEditing(false); setApiKey(""); setErr(null); }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
