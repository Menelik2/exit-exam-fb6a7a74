# Import JSON guide (Admin → Settings → Import JSON)

Use this format to import **departments**, **exams**, and optional **stored questions**.

## Quick steps

1. Open **Admin → Settings**
2. Click **Import JSON**
3. Choose a `.json` file (see `catalog-import-sample.json`)
4. Choose:
   - **OK** = **Merge** (same `id` updates existing dept/exam)
   - **Cancel** = **Replace** entire catalog with this file

## Minimal example (one department, one exam, no questions)

```json
{
  "departments": [
    {
      "id": "nursing",
      "name": "Nursing",
      "emoji": "🩺",
      "exams": [
        {
          "id": "nursing-2016",
          "title": "BSC Nurse January 2016",
          "year": 2016,
          "pdfUrl": "https://your-public-link.com/exam.pdf",
          "telegramFileId": null
        }
      ]
    }
  ]
}
```

After import, open **Exam management** → **Gen all Qs** on that exam.

## Full example (with stored questions)

See **`catalog-import-sample.json`** in this folder.

Users can start the quiz immediately if `questions` is filled — no generate step needed.

## Field reference

### Catalog

| Field | Required | Description |
|-------|----------|-------------|
| `departments` | Yes | Array of departments |
| `updatedAt` | No | ISO date string |

### Department

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique slug, e.g. `nursing` |
| `name` | Yes | Display name |
| `emoji` | No | Default `📘` |
| `exams` | Yes | Array (can be empty `[]`) |

### Exam

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique, e.g. `nursing-2016-jan` |
| `title` | Yes | Shown to users |
| `year` | No | Number or `null` |
| `pdfUrl` | No | Public PDF/DOCX URL |
| `telegramFileId` | No | Optional Telegram file id |
| `note` | No | Admin-only note |
| `questions` | No | Stored MCQs for users |

### Question

| Field | Required | Description |
|-------|----------|-------------|
| `question` | Yes | Question text |
| `options` | Yes | Array of at least 2 strings |
| `correct_answer` | Yes | Must match one option (exact text) |
| `explanation` | No | Shown after answer |
| `question_number` | No | Auto-normalized on import |

## Tips

- **`id` values** control merge: same department/exam `id` → update; new `id` → add.
- **`pdfUrl`** must be publicly reachable if you plan to **Gen all Qs**.
- You can import exams **without** `questions`, then generate in Exam management.
- Or import with full `questions` so users can practice immediately.
- Export first (**Export JSON**) as a backup before Replace.
