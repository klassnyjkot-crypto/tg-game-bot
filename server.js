// server.js
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GAME_URL = process.env.GAME_URL; // https://klassnyjkot-crypto.github.io/game/
const GAME_SHORT_NAME = process.env.GAME_SHORT_NAME; // devicegame

if (!BOT_TOKEN || !GAME_URL || !GAME_SHORT_NAME) {
  console.error('Поставь в env BOT_TOKEN, GAME_URL и GAME_SHORT_NAME');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
app.use(express.json());
app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });

// временное хранилище сессий: token -> { userId, chatId, messageId }
const sessions = {};

function genToken() {
  return Math.random().toString(36).substring(2, 12);
}

// Команда /start или /game — отправляем игру (кнопка Play)
bot.onText(/\/start|\/game/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendGame(chatId, GAME_SHORT_NAME).catch(console.error);
});

// Когда пользователь нажимает Play — приходит callback_query
bot.on('callback_query', async (q) => {
  try {
    // Убедимся что это нажатие на нашу игру
    if (!q.game_short_name || q.game_short_name !== GAME_SHORT_NAME) {
      // Если не наша игра — можно игнорировать
      return bot.answerCallbackQuery(q.id);
    }

    const userId = q.from.id;
    const message = q.message; // сообщение, где была кнопка
    const token = genToken();

    // сохраним сессию (для вызова setGameScore позже)
    sessions[token] = {
      userId,
      chatId: message.chat.id,
      messageId: message.message_id,
      created: Date.now()
    };

    // URL игры, который откроется в встроенном браузере Telegram
    const url = `${GAME_URL}?token=${token}`;

    // Ответ Telegram — откроет встроенный браузер по URL
    await bot.answerCallbackQuery(q.id, { url });

  } catch (err) {
    console.error('callback_query error', err);
  }
});

// Endpoint для получения очков от игры (игра шлёт { token, score })
app.post('/score', async (req, res) => {
  try {
    const { token, score } = req.body || {};
    if (!token || typeof score !== 'number') return res.status(400).json({ ok:false, error:'invalid' });

    const session = sessions[token];
    if (!session) return res.status(400).json({ ok:false, error:'session not found' });

    // Вызов setGameScore
    const params = {
      user_id: session.userId,
      score: Math.floor(score),
      chat_id: session.chatId,
      message_id: session.messageId,
      force: true
    };

    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setGameScore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const json = await resp.json();

    // удалим сессию, чтобы нельзя было повторно слать тот же токен
    delete sessions[token];

    return res.json({ ok:true, telegram_response: json });
  } catch (e) {
    console.error('score endpoint error', e);
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server listening on', PORT));
