const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN || '8141515317:AAFX4Qn31GuqLr50ADB0Hi_l2-4akFHcMIg'; // Renderda env dan o‘qish tavsiya etiladi
const ADMIN_ID = 8173188671;
const DEFAULT_CHANNEL = '@Sakuramibacent';

if (!BOT_TOKEN || !ADMIN_ID) {
  console.error('\nBOT_TOKEN yoki ADMIN_ID to‘ldirilmagan!\n');
  process.exit(1);
}

// polling o‘rniga oddiy bot yaratamiz (webhook keyin o‘rnatiladi)
const bot = new TelegramBot(BOT_TOKEN);

let botId;
bot.getMe().then(me => {
  botId = me.id;
  console.log(`Bot ishga tushdi | ID: ${botId} | Admin: ${ADMIN_ID} | Default kanal: ${DEFAULT_CHANNEL}`);
}).catch(err => {
  console.error('Bot ID olishda xato:', err.message);
  process.exit(1);
});

const DATA_FILE = 'data.json';

let globalState = {
  defaultChannel: DEFAULT_CHANNEL
};

let users = {}; // userId → state

function loadState() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      Object.assign(globalState, data.global || {});
      users = data.users || {};
      console.log('Oldingi holat yuklandi');
    } catch (e) {
      console.error('data.json o‘qishda xato:', e.message);
    }
  }
}

function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      global: globalState,
      users
    }, null, 2));
  } catch (e) {
    console.error('data.json saqlashda xato:', e.message);
  }
}

loadState();

function getUserState(userId) {
  if (!users[userId]) {
    users[userId] = {
      channelId: null,
      currentId: '',
      startPart: 1,
      endPart: 0,
      currentPart: 0,
      mode: 'idle'
    };
    saveState();
  }
  return users[userId];
}

function parseChannelInput(input) {
  input = input.trim();
  if (input.startsWith('https://t.me/')) {
    return '@' + input.split('/').pop();
  }
  if (input.startsWith('@')) return input;
  if (/^-?\d+$/.test(input)) return input;
  return '@' + input;
}

// ─── /setchannel ───
bot.onText(/\/setchannel\s+(.+)/, (msg, match) => {
  const userId = msg.from.id;
  const cid = msg.chat.id;
  const rawInput = match[1].trim();
  const newChannel = parseChannelInput(rawInput);

  bot.getChatMember(newChannel, botId)
    .then(member => {
      if (['administrator', 'creator'].includes(member.status)) {
        if (userId === ADMIN_ID) {
          globalState.defaultChannel = newChannel;
          bot.sendMessage(cid, `✅ Global default kanal o'zgartirildi: ${newChannel}`);
        } else {
          const userState = getUserState(userId);
          userState.channelId = newChannel;
          bot.sendMessage(cid, `✅ Sizning kanalingiz: ${newChannel}`);
        }
        saveState();
      } else {
        bot.sendMessage(cid, `❌ Bot "${newChannel}" da admin emas!`);
      }
    })
    .catch(err => {
      bot.sendMessage(cid, `Xato: ${err.message}. Kanalni to‘g‘ri kiriting.`);
    });
});

// ─── /addid ───
bot.onText(/\/addid/i, (msg) => {
  const userId = msg.from.id;
  const cid = msg.chat.id;
  const userState = getUserState(userId);

  bot.sendMessage(cid, `Seriya ID sini yuboring (masalan: OnePiece)`);
  userState.mode = 'waiting_id';
  userState.currentId = '';
  userState.startPart = 1;
  userState.endPart = 0;
  userState.currentPart = 0;
  saveState();
});

// ─── Text handler ───
bot.on('text', (msg) => {
  if (msg.from.is_bot) return;
  const userId = msg.from.id;
  const cid = msg.chat.id;
  const text = msg.text.trim();
  const userState = getUserState(userId);

  if (userState.mode === 'waiting_id' && text && !text.startsWith('/')) {
    userState.currentId = text;
    userState.mode = 'waiting_start';
    bot.sendMessage(cid, 'Qaysi qismdan boshlaymiz? (1)');
    saveState();
    return;
  }

  if (userState.mode === 'waiting_start' && text && !text.startsWith('/')) {
    const start = parseInt(text);
    if (isNaN(start) || start < 1) return bot.sendMessage(cid, '1+ butun son kiriting.');
    userState.startPart = start;
    userState.currentPart = start;
    userState.mode = 'waiting_end';
    bot.sendMessage(cid, 'Qaysi qism bilan tugatamiz?');
    saveState();
    return;
  }

  if (userState.mode === 'waiting_end' && text && !text.startsWith('/')) {
    const end = parseInt(text);
    if (isNaN(end) || end < userState.startPart) {
      return bot.sendMessage(cid, `Oxirgi qism ${userState.startPart} dan katta bo‘lishi kerak.`);
    }
    userState.endPart = end;
    userState.mode = 'waiting_videos';

    const total = end - userState.startPart + 1;
    const target = userState.channelId || globalState.defaultChannel;

    bot.sendMessage(cid,
      `✅ Boshladik!\nID: ${userState.currentId}\nQismlar: ${userState.startPart}–${end} (${total} ta)\nKanal: ${target}\n\nVideolarni yuboring...`
    );
    bot.sendMessage(cid, `Hozir ${userState.currentPart}-qism kutilyapti`);
    saveState();
    return;
  }

  if (userState.mode !== 'idle' && !text.startsWith('/')) {
    bot.sendMessage(cid, 'Raqam yoki video yuboring.\nQayta boshlash: /addid');
  }
});

// ─── Video handler ───
bot.on('video', (msg) => {
  const userId = msg.from.id;
  const userState = getUserState(userId);
  if (userState.mode !== 'waiting_videos' || userState.currentPart > userState.endPart) return;

  const cid = msg.chat.id;
  const targetChannel = userState.channelId || globalState.defaultChannel;
  const caption = `ID: ${userState.currentId}\nQism: ${userState.currentPart}`;

  bot.getChatMember(targetChannel, botId)
    .then(member => {
      if (!['administrator', 'creator'].includes(member.status)) {
        return bot.sendMessage(cid, `❌ Bot "${targetChannel}" da admin emas!`);
      }

      bot.sendVideo(targetChannel, msg.video.file_id, { caption })
        .then(() => {
          bot.sendMessage(cid, `✔ ${userState.currentPart}-qism yuklandi`);
          userState.currentPart++;
          saveState();

          if (userState.currentPart > userState.endPart) {
            bot.sendMessage(cid, '✅ Hammasi yuklandi! /addid bilan davom ettiring');
            userState.mode = 'idle';
            saveState();
          } else {
            bot.sendMessage(cid, `Keyingi: ${userState.currentPart}-qism`);
          }
        })
        .catch(err => {
          console.error('sendVideo xatosi:', err.message);
          bot.sendMessage(cid, 'Video yuklanmadi. Adminlikni tekshiring.');
        });
    })
    .catch(err => {
      bot.sendMessage(cid, `Kanal tekshirish xatosi: ${err.message}`);
    });
});

// ─── /start ───
bot.onText(/\/start/i, (msg) => {
  bot.sendMessage(msg.chat.id,
    'Anime seriya yuklash bot:\n\n' +
    '1. /setchannel @kanal_yoki_https://t.me/kanal (majburiy emas)\n' +
    '   Agar qo‘shmasangiz — default kanal ishlaydi\n' +
    '2. /addid\n' +
    '3. Anime ID (masalan: OnePiece)\n' +
    '4. Boshlanish qismi (raqam)\n' +
    '5. Tugash qismi (raqam)\n' +
    '6. Videolarni ketma-ket yuboring\n\n' +
    'Admin: /setchannel bilan global kanalni o‘zgartiradi.'
  );
});

// ─── Express + Webhook ───
const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = '/webhook';  // xohlasangiz /bot${BOT_TOKEN} qilib xavfsizroq qilishingiz mumkin

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('Bot ishlamoqda! Webhook o‘rnatilgan.');
});

// Serverni ishga tushirish va webhook o‘rnatish
app.listen(PORT, async () => {
  console.log(`Server ishlamoqda: port ${PORT}`);

  const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost';
  const webhookUrl = `https://${hostname}${WEBHOOK_PATH}`;

  try {
    await bot.deleteWebHook();           // eski webhookni o‘chirish (xavfsiz)
    await bot.setWebHook(webhookUrl);
    console.log(`Webhook o‘rnatildi: ${webhookUrl}`);
  } catch (err) {
    console.error('Webhook o‘rnatishda xato:', err.message);
  }
});

console.log('Bot (webhook rejimida) ishga tushdi...');