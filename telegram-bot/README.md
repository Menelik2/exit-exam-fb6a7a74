# Exit Exam — Telegram bot

Bot for **department PDFs**, links to the practice app, and your support channel.

- App: https://yeniexams.vercel.app  
- Channel: https://t.me/exitexamto  

## 1. Create / reset token (BotFather)

1. Open [@BotFather](https://t.me/BotFather)
2. `/newbot` (or `/token` for an existing bot)
3. Copy the token

**If you ever pasted the token in chat or GitHub, revoke it with BotFather and create a new one.**

## 2. Configure

```bash
cd telegram-bot
cp .env.example .env
# edit .env — set TELEGRAM_BOT_TOKEN=...
```

Edit `departments.json`:

```json
{
  "id": "computer-science",
  "name": "Computer Science",
  "emoji": "💻",
  "exams": [
    {
      "id": "cs-2019",
      "title": "Exit Exam 2019",
      "year": 2019,
      "pdfUrl": "https://your-storage.example/exams/cs/2019.pdf",
      "telegramFileId": null
    }
  ]
}
```

- **`pdfUrl`**: public HTTPS URL (Supabase Storage, R2, S3, …) — preferred for first send  
- **`telegramFileId`**: optional; after Telegram accepts a file once, you can save `file_id` for faster resends  

Do **not** commit real tokens or private PDF credentials.

## 3. Run locally

```bash
cd telegram-bot
npm install
npm start
```

Open Telegram, find your bot, send `/start`.

## 4. Commands

| Command | Action |
|---------|--------|
| `/start` | Welcome + menu |
| `/departments` | Department list |
| `/app` | Practice website |
| `/channel` | Support channel |
| `/help` | Help text |

## 5. Adding your ~500 PDFs

1. Upload PDFs to **Supabase Storage / R2 / S3** (not the Git repo)  
2. Fill `departments.json` (or generate it with a script)  
3. Restart the bot  

GitHub is for **code + this JSON catalog**, not hundreds of binary PDFs.

## 6. Production

Keep the process running (Railway, Render, Fly.io, a VPS, etc.):

```bash
TELEGRAM_BOT_TOKEN=... npm start
```

For a **webhook** on Vercel later, we can add an API route; long polling (`bot.launch()`) is fine for a first version.

## Security

- Token only in `.env` or host secrets  
- Never commit `.env`  
- Only share PDFs you are allowed to distribute  
