import { useState } from "react";
import { MessageCircle, ListChecks, Settings2 } from "lucide-react";

export function ExamGeneratorPage() {
  const [settingsOpen, setSettingsOpen] = useState(true);
  return (
    <div className="min-h-dvh w-full bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-card/80 pt-[env(safe-area-inset-top)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
              <ListChecks className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-[15px] font-semibold tracking-tight">Exit Exam Practice</p>
              <p className="truncate text-[11px] text-muted-foreground/90">Moodle-style quiz</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href="https://t.me/exitexamto"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-[#229ED9]/35 bg-[#229ED9]/10 px-3.5 text-xs font-medium shadow-sm"
              title="Join Telegram for support"
            >
              <MessageCircle className="h-4 w-4 text-[#229ED9]" />
              <span className="hidden sm:inline">Support</span>
            </a>
            <button
              type="button"
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border/80 bg-card/90 px-3.5 text-xs font-medium shadow-sm"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <Settings2 className="h-4 w-4" />
              Setup
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-5">
        {settingsOpen && (
          <section className="mb-5 overflow-hidden rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
            <h2 className="font-display text-lg font-semibold tracking-tight">Quiz setup</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Full exam generator is being restored. Meanwhile join Telegram for support.
            </p>
            <a
              href="https://t.me/exitexamto"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center gap-3 rounded-2xl border border-[#229ED9]/30 bg-[#229ED9]/8 px-4 py-3.5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#229ED9] text-white">
                <MessageCircle className="h-5 w-5" />
              </span>
              <span className="min-w-0 text-left">
                <span className="block text-sm font-semibold">Join Telegram for support</span>
                <span className="block text-[11px] text-muted-foreground">@exitexamto — help, tips &amp; updates</span>
              </span>
            </a>
            <p className="mt-4 text-xs text-muted-foreground">
              If the quiz is missing, refresh in a minute — full version is being pushed.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
