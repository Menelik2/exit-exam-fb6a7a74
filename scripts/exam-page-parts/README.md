# Exam page parts

These `.b64` chunks are assembled into `src/components/exam-generator-page.tsx` at build time by `scripts/assemble-exam-page.mjs`.

If the page is missing or stubbed, run:

```bash
npm run assemble:exam
```

Or restore from git history:

```bash
git show a300e637:src/routes/index.tsx > src/components/exam-generator-page.tsx
# then export ExamGeneratorPage and remove createFileRoute from that file
```
