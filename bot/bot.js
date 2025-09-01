const { Telegraf } = require("telegraf");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// === Telegram Bot ===
const bot = new Telegraf(process.env.BOT_TOKEN);

// Пример команды
bot.start((ctx) => ctx.reply("AWR bot started 🚀"));
bot.hears("hi", (ctx) => ctx.reply("Hello 👋"));

// Запуск бота
bot.launch().then(() => {
  console.log("AWR bot started");
});

// === Express server for Render ===
app.get("/", (req, res) => {
  res.send("AWR bot running ✅");
});

app.listen(PORT, () => {
  console.log(`Web server is listening on port ${PORT}`);
});

// Для корректного завершения
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
