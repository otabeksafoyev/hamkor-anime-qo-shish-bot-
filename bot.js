// bot.js — video alohida handler bilan tuzatilgan va multiple users + per-user channel qo'shilgan versiya (Railway webhook bilan)

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = 8173188671;
const DEFAULT_CHANNEL = '@Sakuramibacent';

if (!BOT_TOKEN || !ADMIN_ID) {
  console.error('\nBOT_TOKEN yoki ADMIN_ID to‘ldirilmagan!\n');
  process.exit(1);
}

// Polling o‘rniga webhook uchun bot yaratamiz
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

let users = {}; // userId: { channelId: '@channel', currentId: '', startPart: 1, endPart: 0, currentPart: 0, mode: 'idle' }

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
      users: users
    }, null, 2));
  } catch (e) {
    console.error('data.json saqlashda xato:', e.message);
  }
}

loadState();

function getUserState(userId) {
  if (!users[userId]) {
    users[userId] = {
      channelId: null, // null bo'lsa, default ishlatiladi
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
  } else if (input.startsWith('@')) {
    return input;
  } else if (/^-?\d+$/.test(input)) {
    return input; // Channel ID bo'lsa
  } else {
    return '@' + input; // Oddiy nom bo'lsa, @ qo'shamiz
  }
}

// ─── Kanal o'zgartirish (/setchannel) ───
bot.onText(/\/setchannel\s+(.+)/, (msg, match) => {
  const userId = msg.from.id;
  const cid = msg.chat.id;
  const rawInput = match[1].trim();
  const newChannel = parseChannelInput(rawInput);

  bot.getChatMember(newChannel, botId)
    .then(member => {
      if (['administrator', 'creator'].includes(member.status)) {
        if (userId === ADMIN_ID) {
          // Admin global default ni o'zgartiradi
          globalState.defaultChannel = newChannel;
          bot.sendMessage(cid, `✅ Global default kanal o'zgartirildi: ${newChannel}. Bu kanal qo'shmagan foydalanuvchilarga ta'sir qiladi.`);
        } else {
          // Oddiy user o'z shaxsiy kanalini o'zgartiradi
          const userState = getUserState(userId);
          userState.channelId = newChannel;
          bot.sendMessage(cid, `✅ Sizning kanalingiz o'zgartirildi: ${newChannel}. Endi seriyalaringiz shu kanalga yuklanadi.`);
        }
        saveState();
      } else {
        bot.sendMessage(cid, `❌ Bot "${newChannel}" kanalida admin emas! Iltimos, botni shu kanalga admin qiling va qayta urinib ko'ring.`);
      }
    })
    .catch(err => {
      bot.sendMessage(cid, `Xato: Kanal topilmadi yoki boshqa xato - ${err.message}. Kanal nomi, ID yoki URL (masalan: https://t.me/ongoing_ozbek) kiriting.`);
    });
});

// ─── /addid boshlash ───
bot.onText(/\/addid/i, (msg) => {
  const userId = msg.from.id;
  const cid = msg.chat.id;
  const userState = getUserState(userId);

  bot.sendMessage(cid, `Seriya ID sini yuboring (masalan: OnePiece, Naruto)`);
  userState.mode = 'waiting_id';
  userState.currentId = '';
  userState.startPart = 1;
  userState.endPart = 0;
  userState.currentPart = 0;
  saveState();
});

// ─── Matnli xabarlar (ID, start, end) ───
bot.on('text', (msg) => {
  if (msg.from.is_bot) return;
  const userId = msg.from.id;
  const cid = msg.chat.id;
  const text = msg.text.trim();
  const userState = getUserState(userId);

  if (userState.mode === 'waiting_id' && text && !text.startsWith('/')) {
    userState.currentId = text;
    userState.mode = 'waiting_start';
    bot.sendMessage(cid, 'Qaysi qismdan boshlaymiz? (masalan: 1)');
    saveState();
    return;
  }

  if (userState.mode === 'waiting_start' && text && !text.startsWith('/')) {
    const start = parseInt(text);
    if (isNaN(start) || start < 1) {
      return bot.sendMessage(cid, '1 yoki undan katta butun son kiriting.');
    }
    userState.startPart = start;
    userState.currentPart = start;
    userState.mode = 'waiting_end';
    bot.sendMessage(cid, 'Qaysi qism bilan tugatamiz? (masalan: 12)');
    saveState();
    return;
  }

  if (userState.mode === 'waiting_end' && text && !text.startsWith('/')) {
    const end = parseInt(text);
    if (isNaN(end) || end < userState.startPart) {
      return bot.sendMessage(cid, `Oxirgi qism ${userState.startPart} dan katta bo'lishi kerak.`);
    }
    userState.endPart = end;
    userState.mode = 'waiting_videos';

    const total = end - userState.startPart + 1;
    const targetChannel = userState.channelId || globalState.defaultChannel;
    bot.sendMessage(cid,
      `✅ Boshladik!\n` +
      `ID: ${userState.currentId}\n` +
      `Qismlar: ${userState.startPart} – ${end} (${total} ta)\n` +
      `Kanal: ${targetChannel}\n\n` +
      `Videolarni ketma-ket yuboring...`
    );
    bot.sendMessage(cid, `Hozir ${userState.currentPart}-qism kutilyapti`);
    saveState();
    return;
  }

  // Agar rejim faol bo'lsa va boshqa matn kelsa (buyruqlar bundan mustasno)
  if (userState.mode !== 'idle' && !text.startsWith('/')) {
    bot.sendMessage(cid, 'Iltimos, kerakli raqam yoki video yuboring.\nJarayonni qaytadan boshlash uchun /addid');
  }
});

// ─── VIDEO QABUL QILISH — ALOHIDA HANDLER ───
bot.on('video', (msg) => {
  const userId = msg.from.id;
  const userState = getUserState(userId);
  if (userState.mode !== 'waiting_videos' || userState.currentPart > userState.endPart) {
    // Agar jarayon faol bo'lmasa, video qabul qilinmaydi
    return;
  }

  const cid = msg.chat.id;
  const targetChannel = userState.channelId || globalState.defaultChannel;
  const caption = `ID: ${userState.currentId}\nQism: ${userState.currentPart}`;

  // Yuklashdan oldin bot adminligini qayta tekshirish (xavfsizlik uchun)
  bot.getChatMember(targetChannel, botId)
    .then(member => {
      if (!['administrator', 'creator'].includes(member.status)) {
        return bot.sendMessage(cid, `❌ Bot "${targetChannel}" kanalida admin emas! Iltimos, botni admin qiling yoki /setchannel orqali yangilang.`);
      }

      bot.sendVideo(targetChannel, msg.video.file_id, { caption })
        .then(() => {
          bot.sendMessage(cid, `✔ ${userState.currentPart}-qism kanalga yuklandi`);
          userState.currentPart++;
          saveState();

          if (userState.currentPart > userState.endPart) {
            bot.sendMessage(cid, '✅ Hammasi yuklandi!\nYana seriya qo‘shish uchun /addid');
            userState.mode = 'idle';
            saveState();
          } else {
            bot.sendMessage(cid, `Keyingi: ${userState.currentPart}-qism kutilyapti`);
          }
        })
        .catch(err => {
          console.error('Video jo‘natish xatosi:', err.message);
          bot.sendMessage(cid, 'Videoni kanalga jo‘natib bo‘lmadi. Bot adminligini tekshiring.');
        });
    })
    .catch(err => {
      bot.sendMessage(cid, `Xato: Kanal holatini tekshirishda xato - ${err.message}.`);
    });
});

// /start yo'riqnomasi
bot.onText(/\/start/i, (msg) => {
  bot.sendMessage(msg.chat.id,
    'Seriya yuklash bot:\n\n' +
    '1. O\'z kanalingizni qo‘shing (majburiy emas): /setchannel @kanal_nomi (yoki ID, yoki https://t.me/kanal_url)\n' +
    '   - Agar qo‘shmasangiz, seriyalar admin o‘rnatgan default kanalga yuklanadi.\n' +
    '2. /addid\n' +
    '3. Seriya nomini yoz\n' +
    '4. Boshlanish qismini kiriting\n' +
    '5. Tugash qismini kiriting\n' +
    '6. Videolarni birma-bir yuboring\n\n' +
    'Admin uchun: /setchannel @kanal global default ni o‘zgartiradi.'
  );
});

// ─── Express server va webhook ───
const app = express();
const PORT = process.env.PORT || 8080;
const WEBHOOK_PATH = '/webhook';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('Bot ishlamoqda!');
});

app.listen(PORT, async () => {
  console.log(`Server ishlamoqda: port ${PORT}`);

  const hostname = process.env.RAILWAY_PUBLIC_DOMAIN;

  if (!hostname) {
    console.error('XATO: RAILWAY_PUBLIC_DOMAIN topilmadi! Railway environment variables ni tekshiring.');
    return;
  }

  const webhookUrl = `https://${hostname}${WEBHOOK_PATH}`;

  try {
    await bot.deleteWebHook();
    console.log('Eski webhook o‘chirildi');

    await bot.setWebHook(webhookUrl);
    console.log(`Webhook o‘rnatildi: ${webhookUrl}`);
  } catch (err) {
    console.error('Webhook o‘rnatishda xato:', err.message);
  }
});

console.log('Bot ishlamoqda...');