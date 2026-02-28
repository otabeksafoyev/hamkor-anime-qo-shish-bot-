// bot.js — Telegram bot with MongoDB (Mongoose) for user states + webhook for Railway

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URL = process.env.MONGO_URL;
const ADMIN_ID = 8173188671;
const DEFAULT_CHANNEL = '@Sakuramibacent';

if (!BOT_TOKEN || !MONGO_URL || !ADMIN_ID) {
  console.error('BOT_TOKEN, MONGO_URL yoki ADMIN_ID to‘ldirilmagan!');
  process.exit(1);
}

// MongoDB ulanish
mongoose.connect(MONGO_URL)
  .then(() => console.log('MongoDB ga ulandi → Database: ' + mongoose.connection.name))
  .catch(err => {
    console.error('MongoDB ulanish xatosi:', err.message);
    process.exit(1);
  });

// Schemalar
const userSchema = new mongoose.Schema({
  _id: { type: Number, required: true },
  channelId: { type: String, default: null },
  currentId: { type: String, default: '' },
  startPart: { type: Number, default: 1 },
  endPart: { type: Number, default: 0 },
  currentPart: { type: Number, default: 0 },
  mode: { type: String, default: 'idle' },
}, { timestamps: true });

const globalSchema = new mongoose.Schema({
  _id: { type: String, default: 'global' },
  defaultChannel: { type: String, default: DEFAULT_CHANNEL },
});

const User = mongoose.model('User', userSchema);
const Global = mongoose.model('Global', globalSchema);

// Bot
const bot = new TelegramBot(BOT_TOKEN);

let botId;
bot.getMe().then(me => {
  botId = me.id;
  console.log(`Bot ishga tushdi | ID: ${botId} | Admin: ${ADMIN_ID} | Default kanal: ${DEFAULT_CHANNEL}`);
}).catch(err => {
  console.error('Bot ID olish xatosi:', err.message);
  process.exit(1);
});

async function getDefaultChannel() {
  const globalDoc = await Global.findById('global');
  if (!globalDoc) {
    await new Global().save();
    return DEFAULT_CHANNEL;
  }
  return globalDoc.defaultChannel;
}

async function getUserState(userId) {
  let user = await User.findById(userId);
  if (!user) {
    user = new User({ _id: userId });
    await user.save();
  }
  return user;
}

// /setchannel
bot.onText(/\/setchannel\s+(.+)/, async (msg, match) => {
  const userId = msg.from.id;
  const cid = msg.chat.id;
  let newChannel = match[1].trim();

  if (newChannel.startsWith('https://t.me/')) {
    newChannel = '@' + newChannel.split('/').pop();
  } else if (!newChannel.startsWith('@') && !/^-?\d+$/.test(newChannel)) {
    newChannel = '@' + newChannel;
  }

  try {
    const member = await bot.getChatMember(newChannel, botId);
    if (!['administrator', 'creator'].includes(member.status)) {
      return bot.sendMessage(cid, `❌ Bot "${newChannel}" da admin emas!`);
    }

    if (userId === ADMIN_ID) {
      await Global.findByIdAndUpdate('global', { defaultChannel: newChannel }, { upsert: true });
      bot.sendMessage(cid, `✅ Global kanal o'zgartirildi: ${newChannel}`);
    } else {
      const user = await getUserState(userId);
      user.channelId = newChannel;
      await user.save();
      bot.sendMessage(cid, `✅ Sizning kanalingiz saqlandi: ${newChannel}`);
    }
  } catch (err) {
    bot.sendMessage(cid, `Xato: ${err.message || 'Kanal topilmadi'}`);
  }
});

// /addid
bot.onText(/\/addid/i, async (msg) => {
  const userId = msg.from.id;
  const cid = msg.chat.id;
  const user = await getUserState(userId);

  bot.sendMessage(cid, `Seriya ID sini yuboring (masalan: OnePiece, Naruto)`);
  user.mode = 'waiting_id';
  user.currentId = '';
  user.startPart = 1;
  user.endPart = 0;
  user.currentPart = 0;
  await user.save();
});

// Text handler
bot.on('text', async (msg) => {
  if (msg.from.is_bot) return;
  const userId = msg.from.id;
  const cid = msg.chat.id;
  const text = msg.text.trim();
  const user = await getUserState(userId);

  if (user.mode === 'waiting_id' && text && !text.startsWith('/')) {
    user.currentId = text;
    user.mode = 'waiting_start';
    await user.save();
    return bot.sendMessage(cid, 'Qaysi qismdan boshlaymiz? (masalan: 1)');
  }

  if (user.mode === 'waiting_start' && text && !text.startsWith('/')) {
    const start = parseInt(text);
    if (isNaN(start) || start < 1) return bot.sendMessage(cid, '1 yoki undan katta butun son kiriting.');
    user.startPart = start;
    user.currentPart = start;
    user.mode = 'waiting_end';
    await user.save();
    return bot.sendMessage(cid, 'Qaysi qism bilan tugatamiz? (masalan: 12)');
  }

  if (user.mode === 'waiting_end' && text && !text.startsWith('/')) {
    const end = parseInt(text);
    if (isNaN(end) || end < user.startPart) return bot.sendMessage(cid, `Oxirgi qism ${user.startPart} dan katta bo'lishi kerak.`);
    user.endPart = end;
    user.mode = 'waiting_videos';

    const total = end - user.startPart + 1;
    const target = user.channelId || await getDefaultChannel();

    bot.sendMessage(cid,
      `✅ Boshladik!\nID: ${user.currentId}\nQismlar: ${user.startPart}–${end} (${total} ta)\nKanal: ${target}\n\nVideolarni yuboring...`
    );
    bot.sendMessage(cid, `Hozir ${user.currentPart}-qism kutilyapti`);
    await user.save();
    return;
  }

  if (user.mode !== 'idle' && !text.startsWith('/')) {
    bot.sendMessage(cid, 'Raqam yoki video yuboring.\nQayta boshlash: /addid');
  }
});

// Video handler
bot.on('video', async (msg) => {
  const userId = msg.from.id;
  const user = await getUserState(userId);
  if (user.mode !== 'waiting_videos' || user.currentPart > user.endPart) return;

  const cid = msg.chat.id;
  const targetChannel = user.channelId || await getDefaultChannel();
  const caption = `ID: ${user.currentId}\nQism: ${user.currentPart}`;

  try {
    const member = await bot.getChatMember(targetChannel, botId);
    if (!['administrator', 'creator'].includes(member.status)) {
      return bot.sendMessage(cid, `❌ Bot "${targetChannel}" da admin emas!`);
    }

    await bot.sendVideo(targetChannel, msg.video.file_id, { caption });
    bot.sendMessage(cid, `✔ ${user.currentPart}-qism yuklandi`);

    user.currentPart++;
    if (user.currentPart > user.endPart) {
      bot.sendMessage(cid, '✅ Hammasi yuklandi! /addid bilan yana boshlang');
      user.mode = 'idle';
    } else {
      bot.sendMessage(cid, `Keyingi: ${user.currentPart}-qism`);
    }
    await user.save();
  } catch (err) {
    console.error('Video xatosi:', err.message);
    bot.sendMessage(cid, 'Video yuklanmadi. Adminlikni tekshiring.');
  }
});

// /start
bot.onText(/\/start/i, (msg) => {
  bot.sendMessage(msg.chat.id,
    'Seriya yuklash bot:\n\n' +
    '1. /setchannel @kanal (majburiy emas)\n' +
    '2. /addid\n' +
    '3. Seriya nomi\n' +
    '4. Boshlanish qismi\n' +
    '5. Tugash qismi\n' +
    '6. Videolarni yuboring\n\n' +
    'Admin: /setchannel bilan global kanalni o‘zgartiradi.'
  );
});

// Express + Webhook
const app = express();
const PORT = process.env.PORT || 8080;
const WEBHOOK_PATH = '/webhook';

app.use(express.json());
app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Bot ishlamoqda'));

app.listen(PORT, async () => {
  console.log(`Server ${PORT} da ishlamoqda`);

  const hostname = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (!hostname) return console.error('RAILWAY_PUBLIC_DOMAIN yo‘q!');

  const webhookUrl = `https://${hostname}${WEBHOOK_PATH}`;

  try {
    await bot.deleteWebHook();
    await bot.setWebHook(webhookUrl);
    console.log(`Webhook o‘rnatildi: ${webhookUrl}`);
  } catch (err) {
    console.error('Webhook xatosi:', err.message);
  }
});

console.log('Bot ishga tushdi...');