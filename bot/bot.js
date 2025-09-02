import TelegramBot from 'node-telegram-bot-api';
import Database from 'better-sqlite3';

const TOKEN = process.env.BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });
const db = new Database('users.db');

// Функция нормализации номера
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '+7' + digits; // если без кода страны
  if (digits.startsWith('8') && digits.length === 11) return '+7' + digits.slice(1);
  return '+' + digits;
}

// Стартовое сообщение с выбором способа авторизации
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Привет! Выберите способ авторизации:', {
    reply_markup: {
      keyboard: [
        [{ text: 'Поделиться номером', request_contact: true }],
        [{ text: 'Ввести номер вручную' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
});

// Обработка контакта
bot.on('contact', (msg) => {
  const chatId = msg.chat.id;

  if (!msg.contact || !msg.contact.phone_number) {
    bot.sendMessage(chatId, 'Ошибка: не удалось получить номер телефона.');
    return;
  }

  const phone = normalizePhone(msg.contact.phone_number);
  authorizeUser(chatId, phone);
});

// Обработка текста (вручную введенный номер)
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // Если пользователь нажал "Ввести номер вручную", просим его ввести номер
  if (text === 'Ввести номер вручную') {
    bot.sendMessage(chatId, 'Введите ваш номер телефона (например: +7XXXXXXXXXX или 8XXXXXXXXXX):');
    return;
  }

  // Проверяем, если текст похож на номер телефона
  const phoneDigits = text.replace(/\D/g, '');
  if (phoneDigits.length >= 10 && phoneDigits.length <= 12) {
    const phone = normalizePhone(text);
    authorizeUser(chatId, phone);
  }
});

// Функция авторизации пользователя
function authorizeUser(chatId, phone) {
  const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);

  if (!user) {
    bot.sendMessage(chatId, 'Пользователь не найден в базе. Обратитесь к администратору.');
    return;
  }

  bot.sendMessage(chatId, `Привет, ${user.name}! Вы успешно авторизованы.`);
}
