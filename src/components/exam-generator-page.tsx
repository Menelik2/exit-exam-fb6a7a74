import { useState } from "react";

/**
 * TEMPORARY STUB — the full page was corrupted by oversized API pushes.
 * Restore the real file locally:
 *   git checkout 2571ee8d79b4edf1bd83a5efb34a8b1821fba409 -- src/components/exam-generator-page.tsx
 *   git add src/components/exam-generator-page.tsx && git commit -m "restore full exam-generator-page" && git push
 */
export function ExamGeneratorPage() {
  const [topic, setTopic] = useState("");

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Exit Exam Practice</h1>
        <p className="text-xs text-slate-500">Temporary page — full UI restore needed</p>
      </header>
      <main className="mx-auto max-w-lg px-4 py-10">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <p className="font-semibold">Site is up, but the main quiz UI was removed by a bad commit.</p>
          <p className="mt-2">
            On your computer, run this in the repo, then push:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-white/80 p-3 text-[11px] leading-relaxed text-slate-800">
{`git checkout 2571ee8d79b4edf1bd83a5efb34a8b1821fba409 -- src/components/exam-generator-page.tsx
git add src/components/exam-generator-page.tsx
git commit -m "restore: full exam-generator-page from 2571ee8"
git push origin main`}
          </pre>
        </div>
        <label className="mt-6 block text-xs font-semibold text-slate-500">Topic (stub only)</label>
        <input
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Data Structures"
        />
      </main>
    </div>
  );
}
