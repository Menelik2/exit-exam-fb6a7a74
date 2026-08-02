import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GraduationCap, Loader2, Mail } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Sign in — Exam Generator" },
      { name: "description", content: "Type your email to sign in, then add your own Gemini API key to generate exams." },
      { property: "og:title", content: "Sign in — Exam Generator" },
      { property: "og:description", content: "Email-only sign in. Bring your own Gemini API key." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function AuthPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/" });
    });
  }, [navigate]);

  // Email-only sign-in: no password to remember, no verification email.
  // A deterministic passphrase is derived from the address so the same email
  // always returns to the same account.
  const passphraseFor = (address: string) =>
    `exam-gen::${btoa(unescape(encodeURIComponent(address.toLowerCase())))}::v1`;

  const onEmailContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    setError(null);
    setLinkBusy(true);
    try {
      const password = passphraseFor(address);
      const signIn = await supabase.auth.signInWithPassword({ email: address, password });
      if (signIn.error) {
        const signUp = await supabase.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (signUp.error) throw signUp.error;
        if (!signUp.data.session) {
          const retry = await supabase.auth.signInWithPassword({ email: address, password });
          if (retry.error) throw retry.error;
        }
      }
      setLinkSent(true);
      navigate({ to: "/" });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      setError(
        /provider is not enabled|Email logins are disabled|Email signups are disabled/i.test(message)
          ? "Email sign-in is turned off for this project. Enable the Email provider in the backend Auth settings."
          : message,
      );
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-secondary/60 p-7">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold tracking-tight">Welcome</h1>
            <p className="text-xs text-muted-foreground">Just your email — then add your Gemini key</p>
          </div>
        </div>



        <form onSubmit={onEmailContinue} className="space-y-3">
          <label htmlFor="magic-email" className="block text-xs font-medium text-muted-foreground">
            Email address
          </label>
          <Input
            id="magic-email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            className="h-11 rounded-xl"
          />
          <Button type="submit" disabled={linkBusy || !email.trim()} className="h-11 w-full rounded-xl gap-2">
            {linkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Continue with email
          </Button>
          <p className="text-[11px] text-muted-foreground">
            No password, no verification email — just your address. Your real Gemini API key is added next.
          </p>
        </form>

        {linkSent && (
          <p className="mt-3 text-sm text-emerald-600">Signed in as {email.trim()}.</p>
        )}


        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}


        <p className="mt-6 text-center text-xs text-muted-foreground">
          After signing in, add your own Gemini API key in the sidebar.
        </p>

        <div className="mt-6 text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← Back to app
          </Link>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.5 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.9 6.1C12.3 13.3 17.7 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/>
      <path fill="#FBBC05" d="M10.4 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z"/>
      <path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.6-5.9c-2.1 1.4-4.8 2.3-7.4 2.3-6.3 0-11.7-3.8-13.6-9.4l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
    </svg>
  );
}
