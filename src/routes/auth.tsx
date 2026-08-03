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
      if (data.user) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  // Email-only sign-in: no password to remember, no verification email.
  // A deterministic passphrase is derived from the address so the same email
  // always returns to the same account.
  const passphraseFor = (address: string) =>
    `exam-gen::${btoa(unescape(encodeURIComponent(address.toLowerCase())))}::v1`;

  // The session is written to localStorage asynchronously; wait for it so the
  // redirect never lands on the app before the session exists.
  const waitForSession = async () => {
    for (let i = 0; i < 25; i++) {
      const { data } = await supabase.auth.getSession();
      if (data.session) return data.session;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  };

  const onEmailContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    setError(null);
    setLinkBusy(true);
    try {
      const password = passphraseFor(address);

      // 1) Existing account → straight in.
      let { error: signInError } = await supabase.auth.signInWithPassword({
        email: address,
        password,
      });

      // 2) New account → create it, then sign in.
      if (signInError) {
        const signUp = await supabase.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        const alreadyRegistered =
          signUp.error && /already registered|already exists/i.test(signUp.error.message);
        if (signUp.error && !alreadyRegistered) throw signUp.error;

        if (!signUp.data?.session) {
          const retry = await supabase.auth.signInWithPassword({ email: address, password });
          if (retry.error) throw retry.error;
        }
      }

      const session = await waitForSession();
      if (!session) {
        throw new Error(
          "Signed in, but the session didn't persist. Allow site data/cookies for this site and try again.",
        );
      }

      setLinkSent(true);
      navigate({ to: "/", replace: true });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      setError(
        /provider is not enabled|Email logins are disabled|Email signups are disabled/i.test(message)
          ? "Email sign-in is turned off for this project. Enable the Email provider in the backend Auth settings."
          : /Email not confirmed/i.test(message)
            ? "This address needs email confirmation. Confirm it once from the link we sent, then continue."
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
