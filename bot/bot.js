const TelegramBot = require("node-telegram-bot-api");

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;

const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Отправьте свой номер", {
    reply_markup: {
      keyboard: [[{ text: "Поделиться номером", request_contact: true }]],
      one_time_keyboard: true,
    },
  });
});

bot.on("contact", (msg) => {
  const phone = msg.contact.phone_number.startsWith("+")
    ? msg.contact.phone_number
    : "+" + msg.contact.phone_number;

  bot.sendMessage(msg.chat.id, "Запустить AWR", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open App",
            web_app: { url: `${webAppUrl}?phone=${phone}` },
          },
        ],
      ],
    },
  });
});
