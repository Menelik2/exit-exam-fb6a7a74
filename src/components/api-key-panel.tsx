import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

export type AiProvider = "openrouter" | "gemini" | "openai" | "deepseek";

export const OPENROUTER_LS_KEY = "exam-gen-openrouter-key-v1";
export const GEMINI_LS_KEY = "exam-gen-gemini-key-v1";
export const OPENAI_LS_KEY = "exam-gen-openai-key-v1";
export const DEEPSEEK_LS_KEY = "exam-gen-deepseek-key-v1";
export const PROVIDER_LS_KEY = "exam-gen-provider-v1";

const LS_KEY: Record<AiProvider, string> = {
  openrouter: OPENROUTER_LS_KEY,
  gemini: GEMINI_LS_KEY,
  openai: OPENAI_LS_KEY,
  deepseek: DEEPSEEK_LS_KEY,
};

const META: Record<
  AiProvider,
  { label: string; placeholder: string; link: string; linkLabel: string }
> = {
  openrouter: {
    label: "OpenRouter",
    placeholder: "sk-or-v1-...",
    link: "https://openrouter.ai/keys",
    linkLabel: "Get a key from OpenRouter",
  },
  gemini: {
    label: "Google Gemini",
    placeholder: "AIza...",
    link: "https://aistudio.google.com/apikey",
    linkLabel: "Get a free key from Google AI Studio",
  },
  openai: {
    label: "OpenAI (ChatGPT)",
    placeholder: "sk-...",
    link: "https://platform.openai.com/api-keys",
    linkLabel: "Get a key from the OpenAI dashboard",
  },
  deepseek: {
    label: "DeepSeek",
    placeholder: "sk-...",
    link: "https://platform.deepseek.com/api_keys",
    linkLabel: "Get a key from the DeepSeek platform",
  },
};

export function readProvider(): AiProvider {
  try {
    const p = localStorage.getItem(PROVIDER_LS_KEY);
    if (p === "openrouter" || p === "openai" || p === "deepseek" || p === "gemini") return p;
    return "openrouter";
  } catch {
    return "openrouter";
  }
}

export function readKey(provider: AiProvider): string {
  try {
    return localStorage.getItem(LS_KEY[provider]) ?? "";
  } catch {
    return "";
  }
}

export function readGeminiKey(): string {
  return readKey("gemini");
}

async function validateKey(provider: AiProvider, key: string) {
  if (provider === "gemini") {
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
    return;
  }

  if (provider === "openrouter") {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? "That key was rejected by OpenRouter. Check it and try again."
          : "Couldn't verify the key right now. Try again in a moment.",
      );
    }
    return;
  }

  const base =
    provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1";
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? `That key was rejected by ${META[provider].label}. Check it and try again.`
        : "Couldn't verify the key right now. Try again in a moment.",
    );
  }
}

export function ApiKeyPanel({
  onKeyChange,
}: {
  onKeyChange?: (key: string, provider: AiProvider) => void;
}) {
  const [provider, setProvider] = useState<AiProvider>("openrouter");
  const [saved, setSaved] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const p = readProvider();
    const k = readKey(p);
    setProvider(p);
    setSaved(k || null);
    setReady(true);
    onKeyChange?.(k, p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchProvider = (p: AiProvider) => {
    setProvider(p);
    setErr(null);
    setApiKey("");
    setEditing(false);
    try {
      localStorage.setItem(PROVIDER_LS_KEY, p);
    } catch {
      /* ignore */
    }
    const k = readKey(p);
    setSaved(k || null);
    onKeyChange?.(k, p);
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = apiKey.trim();
    setErr(null);
    setChecking(true);
    try {
      await validateKey(provider, key);
      localStorage.setItem(LS_KEY[provider], key);
      localStorage.setItem(PROVIDER_LS_KEY, provider);
      setSaved(key);
      setApiKey("");
      setEditing(false);
      onKeyChange?.(key, provider);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const onRemove = () => {
    if (!confirm(`Remove your ${META[provider].label} API key from this browser?`)) return;
    localStorage.removeItem(LS_KEY[provider]);
    setSaved(null);
    setEditing(false);
    onKeyChange?.("", provider);
  };

  if (!ready) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const showForm = editing || !saved;
  const meta = META[provider];
  const providers: AiProvider[] = ["openrouter", "gemini", "openai", "deepseek"];

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card/70 p-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:grid-cols-4">
        {providers.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => switchProvider(p)}
            className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
              provider === p
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p === "openrouter"
              ? "OpenRouter"
              : p === "gemini"
                ? "Gemini"
                : p === "openai"
                  ? "ChatGPT"
                  : "DeepSeek"}
          </button>
        ))}
      </div>

      {saved && !editing ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground">{meta.label} connected</span>
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
              Your {meta.label} API key
            </Label>
          </div>
          <Input
            id="gkey"
            type="password"
            placeholder={meta.placeholder}
            value={apiKey}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
            className="h-10 rounded-xl bg-card font-mono text-xs"
            required
            autoComplete="off"
          />
          <a
            href={meta.link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            {meta.linkLabel} <ExternalLink className="h-3 w-3" />
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
