/**
 * PDF Uploader bot — collect Telegram file_ids for exam PDFs
 *
 * Use this to upload your ~500 department exam PDFs once.
 * The bot replies with file_id + a JSON snippet for departments.json.
 *
 * Optional caption format (when you send the PDF):
 *   computer-science|2019|Exit Exam 2019
 *   department_id|year|title
 *
 * Setup:
 *   1. Same TELEGRAM_BOT_TOKEN as main bot (or a dedicated uploader bot)
 *   2. Set ADMIN_TELEGRAM_IDS=your_numeric_user_id (comma-separated)
 *      Get your id: message @userinfobot
 *   3. node upload-bot.js
 *   4. Send PDFs to the bot in a private chat
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN=...
 *   ADMIN_TELEGRAM_IDS=123456789
 *   UPLOAD_AUTO_SAVE=1   (optional: append into departments.json)
 */

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Telegraf, Markup } from "telegraf";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTO_SAVE = process.env.UPLOAD_AUTO_SAVE === "1" || process.env.UPLOAD_AUTO_SAVE === "true";
const configPath =
  process.env.DEPARTMENTS_CONFIG || join(__dirname, "departments.json");

const adminIds = String(process.env.ADMIN_TELEGRAM_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => Number(s))
  .filter((n) => Number.isFinite(n));

if (!TOKEN || TOKEN.length < 20) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

if (adminIds.length === 0) {
  console.warn(
    "WARNING: ADMIN_TELEGRAM_IDS is empty. Anyone who finds the bot can upload.\n" +
      "Set ADMIN_TELEGRAM_IDS=your_id (from @userinfobot) before production use."
  );
}

function isAdmin(ctx) {
  if (adminIds.length === 0) return true; // open mode for first-time setup
  const id = ctx.from?.id;
  return id != null && adminIds.includes(id);
}

function loadConfig() {
  if (!existsSync(configPath)) {
    return {
      appUrl: "https://yeniexams.vercel.app",
      channelUrl: "https://t.me/exitexamto",
      channelUsername: "@exitexamto",
      departments: [],
    };
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function saveConfig(config) {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "exam";
}

/** Parse caption: deptId|year|title  OR  deptId|title  OR free text title */
function parseCaption(caption, fileName) {
  const raw = (caption || "").trim();
  const baseName = (fileName || "exam.pdf").replace(/\.pdf$/i, "");

  if (!raw) {
    return {
      deptId: "uncategorized",
      year: null,
      title: baseName,
      examId: slugify(baseName),
    };
  }

  const parts = raw.split("|").map((p) => p.trim());
  if (parts.length >= 3) {
    const yearNum = Number(parts[1]);
    const year = Number.isFinite(yearNum) ? yearNum : null;
    const title = parts.slice(2).join("|") || baseName;
    return {
      deptId: slugify(parts[0]) || "uncategorized",
      year,
      title,
      examId: slugify(`${parts[0]}-${parts[1]}-${title}`),
    };
  }
  if (parts.length === 2) {
    const maybeYear = Number(parts[1]);
    if (Number.isFinite(maybeYear) && maybeYear > 1990 && maybeYear < 2100) {
      return {
        deptId: slugify(parts[0]),
        year: maybeYear,
        title: `${parts[0]} ${maybeYear}`,
        examId: slugify(`${parts[0]}-${maybeYear}`),
      };
    }
    return {
      deptId: slugify(parts[0]),
      year: null,
      title: parts[1] || baseName,
      examId: slugify(`${parts[0]}-${parts[1]}`),
    };
  }

  return {
    deptId: "uncategorized",
    year: null,
    title: raw || baseName,
    examId: slugify(raw || baseName),
  };
}

function upsertExam(config, { deptId, year, title, examId, fileId, fileName }) {
  if (!Array.isArray(config.departments)) config.departments = [];

  let dept = config.departments.find((d) => d.id === deptId);
  if (!dept) {
    dept = {
      id: deptId,
      name: deptId
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      emoji: "📘",
      exams: [],
    };
    config.departments.push(dept);
  }
  if (!Array.isArray(dept.exams)) dept.exams = [];

  const existing = dept.exams.find((e) => e.id === examId);
  const entry = {
    id: examId,
    title,
    year,
    pdfUrl: null,
    telegramFileId: fileId,
    fileName: fileName || null,
  };

  if (existing) {
    Object.assign(existing, entry);
  } else {
    dept.exams.push(entry);
  }
  return { dept, entry, isNew: !existing };
}

const bot = new Telegraf(TOKEN);

bot.start(async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.reply("This uploader is private. Use the main exam bot for practice.");
    return;
  }
  await ctx.reply(
    `📤 *PDF Uploader*\n\n` +
      `Send exam PDFs here.\n\n` +
      `*Caption format (recommended):*\n` +
      `\`department-id|year|Title\`\n\n` +
      `Examples:\n` +
      `\`computer-science|2019|Exit Exam 2019\`\n` +
      `\`nursing|2020|Nursing Exit\`\n` +
      `\`law|2018|Law Exit Exam\`\n\n` +
      `You can also send a PDF with no caption.\n` +
      (AUTO_SAVE
        ? `\n✅ Auto-save is ON → writes to departments.json`
        : `\n💾 Auto-save is OFF → copy the JSON snippet into departments.json\nSet UPLOAD_AUTO_SAVE=1 to enable.`),
    { parse_mode: "Markdown" }
  );
});

bot.command("whoami", async (ctx) => {
  await ctx.reply(
    `Your Telegram user id: \`${ctx.from?.id}\`\n` +
      `Put this in .env:\nADMIN_TELEGRAM_IDS=${ctx.from?.id}`,
    { parse_mode: "Markdown" }
  );
});

bot.command("stats", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const config = loadConfig();
  const depts = config.departments || [];
  const total = depts.reduce((n, d) => n + (d.exams?.length || 0), 0);
  const lines = depts.map(
    (d) => `• ${d.name || d.id}: ${d.exams?.length || 0}`
  );
  await ctx.reply(
    `Catalog: *${total}* exams in *${depts.length}* departments\n\n` +
      (lines.join("\n") || "Empty"),
    { parse_mode: "Markdown" }
  );
});

bot.on("document", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.reply("Uploader is admin-only.");
    return;
  }

  const doc = ctx.message.document;
  if (!doc) return;

  const mime = doc.mime_type || "";
  const name = doc.file_name || "file";
  const isPdf =
    mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    await ctx.reply(`Skipped (not a PDF): ${name}\nMIME: ${mime || "unknown"}`);
    return;
  }

  const fileId = doc.file_id;
  const fileUniqueId = doc.file_unique_id;
  const sizeMb = doc.file_size ? (doc.file_size / (1024 * 1024)).toFixed(2) : "?";
  const caption = ctx.message.caption || "";
  const meta = parseCaption(caption, name);

  const snippet = {
    id: meta.examId,
    title: meta.title,
    year: meta.year,
    pdfUrl: null,
    telegramFileId: fileId,
  };

  let saveNote = "";
  if (AUTO_SAVE) {
    try {
      const config = loadConfig();
      const { dept, isNew } = upsertExam(config, {
        deptId: meta.deptId,
        year: meta.year,
        title: meta.title,
        examId: meta.examId,
        fileId,
        fileName: name,
      });
      saveConfig(config);
      saveNote = `\n✅ Saved to departments.json → *${dept.name}* (${isNew ? "new" : "updated"})`;
    } catch (err) {
      saveNote = `\n⚠️ Auto-save failed: ${err.message}`;
      console.error(err);
    }
  }

  const jsonBlock = JSON.stringify(snippet, null, 2);

  await ctx.reply(
    `✅ *PDF received*\n\n` +
      `File: \`${name}\`\n` +
      `Size: ${sizeMb} MB\n` +
      `Department: \`${meta.deptId}\`\n` +
      `Year: ${meta.year ?? "—"}\n` +
      `Title: ${meta.title}\n\n` +
      `*file\_id*\n\`${fileId}\`\n\n` +
      `*file\_unique\_id*\n\`${fileUniqueId}\`\n` +
      saveNote +
      `\n\n*JSON for departments.json:*\n\`\`\`\n${jsonBlock}\n\`\`\``,
    { parse_mode: "Markdown" }
  );

  // Quick re-send test
  try {
    await ctx.replyWithDocument(fileId, {
      caption: `Test resend: ${meta.title}`,
    });
  } catch (err) {
    await ctx.reply(`Could not test-resend: ${err.message}`);
  }
});

bot.on("message", async (ctx) => {
  if (!isAdmin(ctx)) return;
  if (ctx.message.document) return;
  if (ctx.message.text?.startsWith("/")) return;
  await ctx.reply(
    "Send a *PDF document*.\n\nCaption example:\n\`computer-science|2019|Exit Exam 2019\`",
    { parse_mode: "Markdown" }
  );
});

bot.catch((err) => console.error("Uploader error", err));

bot.launch().then(() => {
  console.log("PDF Uploader bot running");
  console.log(`Auto-save: ${AUTO_SAVE ? "ON → " + configPath : "OFF"}`);
  console.log(
    adminIds.length
      ? `Admins: ${adminIds.join(", ")}`
      : "Admins: (open — set ADMIN_TELEGRAM_IDS)"
  );
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
