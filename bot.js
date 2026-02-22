// bot.js — video alohida handler bilan tuzatilgan versiya

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const BOT_TOKEN = '8141515317:AAFX4Qn31GuqLr50ADB0Hi_l2-4akFHcMIg';
const ADMIN_ID = 8173188671;
const DEFAULT_CHANNEL = '@Sakuramibacent';

if (!BOT_TOKEN || !ADMIN_ID) {
  console.error('\nBOT_TOKEN yoki ADMIN_ID to‘ldirilmagan!\n');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let botId;
bot.getMe().then(me => {
  botId = me.id;
  console.log(`Bot ishga tushdi | ID: ${botId} | Admin: ${ADMIN_ID} | Kanal: ${DEFAULT_CHANNEL}`);
}).catch(err => {
  console.error('Bot ID olishda xato:', err.message);
  process.exit(1);
});

const DATA_FILE = 'data.json';

let state = {
  channelId: DEFAULT_CHANNEL,
  currentId: '',
  startPart: 1,
  endPart: 0,
  currentPart: 0,
  mode: 'idle'
};

function loadState() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      Object.assign(state, data);
      console.log('Oldingi holat yuklandi');
    } catch (e) {
      console.error('data.json o‘qishda xato:', e.message);
    }
  }
}

function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      channelId: state.channelId,
      currentId: state.currentId,
      startPart: state.startPart,
      endPart: state.endPart,
      currentPart: state.currentPart,
      mode: state.mode
    }, null, 2));
  } catch (e) {
    console.error('data.json saqlashda xato:', e.message);
  }
}

loadState();

// ─── Admin uchun kanal o'zgartirish ───
bot.onText(/\/setchannel\s+(.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) {
    bot.sendMessage(msg.chat.id, "Bu buyruq faqat admin uchun.");
    return;
  }

  const newChannel = match[1].trim();

  bot.getChatMember(newChannel, botId)
    .then(member => {
      if (['administrator', 'creator'].includes(member.status)) {
        state.channelId = newChannel;
        saveState();
        bot.sendMessage(msg.chat.id, `✅ Kanal o'zgartirildi: ${state.channelId}`);
      } else {
        bot.sendMessage(msg.chat.id, '❌ Bot bu kanalda admin emas!');
      }
    })
    .catch(err => {
      bot.sendMessage(msg.chat.id, `Xato: ${err.message}`);
    });
});

// ─── /addid boshlash ───
bot.onText(/\/addid/i, (msg) => {
  const cid = msg.chat.id;

  bot.sendMessage(cid, `Seriya ID sini yuboring (masalan: OnePiece, Naruto)`);
  state.mode = 'waiting_id';
  state.currentId = '';
  state.startPart = 1;
  state.endPart = 0;
  state.currentPart = 0;
  saveState();
});

// ─── Matnli xabarlar (ID, start, end) ───
bot.on('text', (msg) => {
  if (msg.from.is_bot) return;
  const cid = msg.chat.id;
  const text = msg.text.trim();

  if (state.mode === 'waiting_id' && text) {
    state.currentId = text;
    state.mode = 'waiting_start';
    bot.sendMessage(cid, 'Qaysi qismdan boshlaymiz? (masalan: 1)');
    saveState();
    return;
  }

  if (state.mode === 'waiting_start' && text) {
    const start = parseInt(text);
    if (isNaN(start) || start < 1) {
      return bot.sendMessage(cid, '1 yoki undan katta butun son kiriting.');
    }
    state.startPart = start;
    state.currentPart = start;
    state.mode = 'waiting_end';
    bot.sendMessage(cid, 'Qaysi qism bilan tugatamiz? (masalan: 12)');
    saveState();
    return;
  }

  if (state.mode === 'waiting_end' && text) {
    const end = parseInt(text);
    if (isNaN(end) || end < state.startPart) {
      return bot.sendMessage(cid, `Oxirgi qism ${state.startPart} dan katta bo'lishi kerak.`);
    }
    state.endPart = end;
    state.mode = 'waiting_videos';

    const total = end - state.startPart + 1;
    bot.sendMessage(cid,
      `✅ Boshladik!\n` +
      `ID: ${state.currentId}\n` +
      `Qismlar: ${state.startPart} – ${end} (${total} ta)\n\n` +
      `Videolarni ketma-ket yuboring...`
    );
    bot.sendMessage(cid, `Hozir ${state.currentPart}-qism kutilyapti`);
    saveState();
    return;
  }

  // Agar rejim faol bo'lsa va boshqa matn kelsa
  if (state.mode !== 'idle') {
    bot.sendMessage(cid, 'Iltimos, kerakli raqam yoki video yuboring.\nJarayonni qaytadan boshlash uchun /addid');
  }
});

// ─── VIDEO QABUL QILISH — ALOHIDA HANDLER ───
bot.on('video', (msg) => {
  if (state.mode !== 'waiting_videos' || state.currentPart > state.endPart) {
    // Agar jarayon faol bo'lmasa, video qabul qilinmaydi
    return;
  }

  const cid = msg.chat.id;
  const caption = `ID: ${state.currentId}\nQism: ${state.currentPart}`;

  bot.sendVideo(state.channelId, msg.video.file_id, { caption })
    .then(() => {
      bot.sendMessage(cid, `✔ ${state.currentPart}-qism kanalga yuklandi`);
      state.currentPart++;
      saveState();

      if (state.currentPart > state.endPart) {
        bot.sendMessage(cid, '✅ Hammasi yuklandi!\nYana seriya qo‘shish uchun /addid');
        state.mode = 'idle';
        saveState();
      } else {
        bot.sendMessage(cid, `Keyingi: ${state.currentPart}-qism kutilyapti`);
      }
    })
    .catch(err => {
      console.error('Video jo‘natish xatosi:', err.message);
      bot.sendMessage(cid, 'Videoni kanalga jo‘natib bo‘lmadi. Bot adminligini tekshiring.');
    });
});

// /start yo'riqnomasi
bot.onText(/\/start/i, (msg) => {
  bot.sendMessage(msg.chat.id,
    'Seriya yuklash bot:\n\n' +
    '1. /addid\n' +
    '2. Seriya nomini yoz\n' +
    '3. Boshlanish qismini kiriting\n' +
    '4. Tugash qismini kiriting\n' +
    '5. Videolarni birma-bir yuboring\n\n' +
    'Admin: /setchannel @kanal'
  );
});

console.log('Bot ishlamoqda...');