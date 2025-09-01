
import TelegramBot from 'node-telegram-bot-api';

const BOT_TOKEN = process.env.BOT_TOKEN || 'REPLACE_WITH_BOT_TOKEN';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-domain.com'; // point to frontend hosting

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'AWR — мини‑приложение. Нажмите кнопку, чтобы открыть и поделиться номером.',
  {
    reply_markup: {
      keyboard: [[{ text: 'Открыть AWR', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
});

bot.on('contact', async (msg)=>{
  const chatId = msg.chat.id;
  const phone = msg.contact.phone_number.startsWith('+') ? msg.contact.phone_number : '+'+msg.contact.phone_number;
  // Build WebApp URL with phone as query (front will call backend to map role)
  const url = `${WEBAPP_URL}?phone=${encodeURIComponent(phone)}`;
  await bot.sendMessage(chatId, 'Открыть мини‑приложение AWR:', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Запустить AWR', web_app: { url } }]]
    }
  });
});

console.log('AWR bot started');
