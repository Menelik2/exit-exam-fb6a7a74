/**
 * Exit Exam Practice — Telegram bot
 *
 * Features:
 *  - /start, /help, /app, /channel
 *  - Department menu → list exams → send PDF (url or file_id)
 *  - Links to web app + support channel
 *
 * Setup:
 *  1. Create bot via @BotFather, put token in .env as TELEGRAM_BOT_TOKEN
 *  2. Edit departments.json (add departments + pdfUrl or telegramFileId)
 *  3. npm install && npm start
 *
 * PDF delivery:
 *  - pdfUrl: public HTTPS link (Supabase Storage, R2, S3, …)
 *  - telegramFileId: after first successful send, save file_id for faster resend
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Telegraf, Markup } from "telegraf";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN || TOKEN.length < 20) {
  console.error(
    "Missing TELEGRAM_BOT_TOKEN.\n" +
      "1. Open @BotFather → /newbot or /token\n" +
      "2. Copy telegram-bot/.env.example to telegram-bot/.env\n" +
      "3. Set TELEGRAM_BOT_TOKEN=...\n" +
      "4. Never commit .env or paste the token in chat/GitHub."
  );
  process.exit(1);
}

const configPath =
  process.env.DEPARTMENTS_CONFIG || join(__dirname, "departments.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const APP_URL = config.appUrl || "https://yeniexams.vercel.app";
const CHANNEL_URL = config.channelUrl || "https://t.me/exitexamto";
const departments = Array.isArray(config.departments) ? config.departments : [];

const bot = new Telegraf(TOKEN);

function deptById(id) {
  return departments.find((d) => d.id === id);
}

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📚 Choose department", "menu:departments")],
    [Markup.button.url("🌐 Practice online", APP_URL)],
    [Markup.button.url("📢 Support channel", CHANNEL_URL)],
    [Markup.button.callback("❓ Help", "menu:help")],
  ]);
}

function departmentsKeyboard() {
  const rows = [];
  for (let i = 0; i < departments.length; i += 2) {
    const row = [];
    const a = departments[i];
    row.push(
      Markup.button.callback(
        `${a.emoji || "📘"} ${a.name}`,
        `dept:${a.id}`
      )
    );
    const b = departments[i + 1];
    if (b) {
      row.push(
        Markup.button.callback(
          `${b.emoji || "📘"} ${b.name}`,
          `dept:${b.id}`
        )
      );
    }
    rows.push(row);
  }
  rows.push([Markup.button.callback("« Back", "menu:home")]);
  return Markup.inlineKeyboard(rows);
}

function examsKeyboard(dept) {
  const rows = (dept.exams || []).map((exam) => [
    Markup.button.callback(
      exam.year ? `${exam.title} (${exam.year})` : exam.title,
      `exam:${dept.id}:${exam.id}`
    ),
  ]);
  if (rows.length === 0) {
    rows.push([
      Markup.button.callback("No PDFs yet — contact support", "menu:help"),
    ]);
  }
  rows.push([Markup.button.callback("« Departments", "menu:departments")]);
  rows.push([Markup.button.url("Practice this topic online", APP_URL)]);
  return Markup.inlineKeyboard(rows);
}

const welcomeText =
  `🎓 *Exit Exam Practice*\n\n` +
  `Get past papers by department, or practice quizzes online.\n\n` +
  `• Select a department to receive PDFs\n` +
  `• Open the web app to generate & practice MCQs\n` +
  `• Join the channel for support: ${config.channelUsername || CHANNEL_URL}`;

bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(welcomeText, mainMenu());
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `Commands:\n` +
      `/start — main menu\n` +
      `/departments — list departments\n` +
      `/app — open practice website\n` +
      `/channel — support channel\n` +
      `/help — this message\n\n` +
      `Support: ${CHANNEL_URL}\n` +
      `App: ${APP_URL}`,
    mainMenu()
  );
});

bot.command("app", async (ctx) => {
  await ctx.reply(`Practice online:\n${APP_URL}`, mainMenu());
});

bot.command("channel", async (ctx) => {
  await ctx.reply(`Support channel:\n${CHANNEL_URL}`, mainMenu());
});

bot.command("departments", async (ctx) => {
  if (departments.length === 0) {
    await ctx.reply("No departments configured yet. Edit departments.json.");
    return;
  }
  await ctx.reply("Select your department:", departmentsKeyboard());
});

bot.action("menu:home", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(welcomeText, {
    parse_mode: "Markdown",
    ...mainMenu(),
  });
});

bot.action("menu:help", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `Need help?\n\n1. Pick your department for PDFs\n2. Practice quizzes: ${APP_URL}\n3. Channel: ${CHANNEL_URL}`
  );
});

bot.action("menu:departments", async (ctx) => {
  await ctx.answerCbQuery();
  if (departments.length === 0) {
    await ctx.reply("No departments configured yet.");
    return;
  }
  try {
    await ctx.editMessageText("Select your department:", departmentsKeyboard());
  } catch {
    await ctx.reply("Select your department:", departmentsKeyboard());
  }
});

bot.action(/^dept:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const dept = deptById(id);
  await ctx.answerCbQuery();
  if (!dept) {
    await ctx.reply("Department not found.");
    return;
  }
  const count = (dept.exams || []).length;
  const text =
    `${dept.emoji || "📘"} *${dept.name}*\n\n` +
    (count
      ? `Choose an exam PDF (${count} available):`
      : `No PDFs uploaded for this department yet.\nAsk in ${CHANNEL_URL} or practice online.`);
  try {
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...examsKeyboard(dept),
    });
  } catch {
    await ctx.replyWithMarkdown(text, examsKeyboard(dept));
  }
});

bot.action(/^exam:([^:]+):(.+)$/, async (ctx) => {
  const deptId = ctx.match[1];
  const examId = ctx.match[2];
  const dept = deptById(deptId);
  const exam = dept?.exams?.find((e) => e.id === examId);
  await ctx.answerCbQuery();

  if (!exam) {
    await ctx.reply("Exam not found.");
    return;
  }

  const caption = `${dept.emoji || "📘"} ${dept.name}\n${exam.title}${
    exam.year ? ` (${exam.year})` : ""
  }\n\nPractice online: ${APP_URL}`;

  try {
    if (exam.telegramFileId) {
      await ctx.replyWithDocument(exam.telegramFileId, { caption });
    } else if (exam.pdfUrl) {
      await ctx.replyWithDocument(
        { url: exam.pdfUrl, filename: `${exam.id}.pdf` },
        { caption }
      );
    } else {
      await ctx.reply(
        `📄 *${exam.title}*\n\n` +
          (exam.note || "PDF not linked yet.") +
          `\n\nAdd \`pdfUrl\` or \`telegramFileId\` in departments.json for this exam.\n\n` +
          `Meanwhile practice online:\n${APP_URL}`,
        { parse_mode: "Markdown", ...examsKeyboard(dept) }
      );
      return;
    }
    await ctx.reply("Need another paper?", examsKeyboard(dept));
  } catch (err) {
    console.error("send document failed", err.message);
    await ctx.reply(
      `Could not send the PDF. Check the link or file_id.\n\n${exam.pdfUrl || ""}\n\nPractice online: ${APP_URL}`
    );
  }
});

bot.catch((err, ctx) => {
  console.error("Bot error", err);
  ctx?.reply?.("Something went wrong. Try /start or ask in the support channel.").catch(() => {});
});

bot.launch().then(() => {
  console.log("Exit Exam Telegram bot is running.");
  console.log(`Departments loaded: ${departments.length}`);
  console.log(`App: ${APP_URL}`);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
