import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

export const GEMINI_LS_KEY = "exam-gen-gemini-key-v1";

export function readGeminiKey(): string {
  try {
    return localStorage.getItem(GEMINI_LS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function ApiKeyPanel({ onKeyChange }: { onKeyChange?: (key: string) => void }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const k = readGeminiKey();
    setSaved(k || null);
    setReady(true);
    onKeyChange?.(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = apiKey.trim();
    setErr(null);
    setChecking(true);
    try {
      // Validate directly against Google so only a real key is stored.
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      );
      if (!res.ok) {
        throw new Error(
          res.status === 400 || res.status === 401 || res.status === 403
            ? "That key was rejected by Google. Check it and try again."
            : "Couldn't verify the key right now. Try again in a moment.",
        );
      }
      localStorage.setItem(GEMINI_LS_KEY, key);
      setSaved(key);
      setApiKey("");
      setEditing(false);
      onKeyChange?.(key);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const onRemove = () => {
    if (!confirm("Remove your Gemini API key from this browser?")) return;
    localStorage.removeItem(GEMINI_LS_KEY);
    setSaved(null);
    setEditing(false);
    onKeyChange?.("");
  };

  if (!ready) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const showForm = editing || !saved;

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card/70 p-4">
      {saved && !editing ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground">Gemini key connected</span>
            <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              ••••{saved.slice(-4)}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Stored only in this browser. Nothing is saved on our servers.
          </p>
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
              onClick={onRemove}
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
            <Label
              htmlFor="gkey"
              className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
            >
              Your Gemini API key
            </Label>
          </div>
          <Input
            id="gkey"
            type="password"
            placeholder="AIza..."
            value={apiKey}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
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
            <Button
              type="submit"
              disabled={checking || apiKey.trim().length < 20}
              className="h-9 flex-1 rounded-lg text-xs"
            >
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save key"}
            </Button>
            {editing && saved && (
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg text-xs"
                onClick={() => {
                  setEditing(false);
                  setApiKey("");
                  setErr(null);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
