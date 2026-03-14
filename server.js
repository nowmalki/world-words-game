// ╔══════════════════════════════════════════════════════╗
// ║  🌍 WORLD WORDS + Server                             ║
// ║  Node.js + Socket.io + AI Judge                      ║
// ╚══════════════════════════════════════════════════════╝

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ===================================================================
// GAME STATE MANAGEMENT
// ===================================================================

const ROUND_TIME = 60;
const MAX_ROUNDS = 5;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

const HEBREW_LETTERS = "אבגדהוזחטיכלמנסעפצקרשת".split("");
const ENGLISH_LETTERS = "ABCDEFGHIJKLMNOPRSTUVW".split("");

const FLAG_POOL = ["🇮🇱","🇯🇵","🇺🇸","🇧🇷","🇫🇷","🇩🇪","🇮🇳","🇬🇧","🇰🇷","🇲🇽","🇮🇹","🇪🇸","🇦🇺","🇨🇦","🇷🇺"];
const AVATAR_COLORS = ["#00e5ff","#ff6090","#7c4dff","#00e676","#ffab40","#ff5252"];

const CATEGORIES = {
  he: [
    { id: "country", name: "ארץ", icon: "🌍" },
    { id: "city", name: "עיר", icon: "🏙️" },
    { id: "animal", name: "חי", icon: "🦁" },
    { id: "plant", name: "צומח", icon: "🌿" },
    { id: "object", name: "דומם", icon: "🪨" },
    { id: "food", name: "אוכל", icon: "🍕" },
  ],
  en: [
    { id: "country", name: "Country", icon: "🌍" },
    { id: "city", name: "City", icon: "🏙️" },
    { id: "animal", name: "Animal", icon: "🦁" },
    { id: "plant", name: "Plant", icon: "🌿" },
    { id: "object", name: "Object", icon: "🪨" },
    { id: "food", name: "Food", icon: "🍕" },
  ],
};

// Room storage
const rooms = new Map();

function createRoom(hostId) {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  rooms.set(code, {
    code,
    hostId,
    players: [],
    state: 'lobby', // lobby | spinning | playing | judging | scoreboard | gameover
    currentRound: 0,
    currentLetter: null,
    usedLetters: [],
    answers: {}, // { playerId: { categoryId: "answer" } }
    results: {}, // { playerId: { categoryId: { valid, score, rarity } } }
    timerEnd: null,
    lang: 'he',
    categories: CATEGORIES.he,
  });
  return code;
}

function addPlayer(roomCode, playerId, name, flag) {
  const room = rooms.get(roomCode);
  if (!room || room.players.length >= MAX_PLAYERS || room.state !== 'lobby') return null;

  const colorIndex = room.players.length % AVATAR_COLORS.length;
  const player = {
    id: playerId,
    name: name || `Player ${room.players.length + 1}`,
    flag: flag || FLAG_POOL[Math.floor(Math.random() * FLAG_POOL.length)],
    avatar: (name || "P")[0].toUpperCase(),
    color: AVATAR_COLORS[colorIndex],
    totalScore: 0,
    roundScores: [],
    isHost: room.players.length === 0,
    connected: true,
  };

  room.players.push(player);
  return player;
}

// ===================================================================
// AI JUDGE MODULE
// ===================================================================
// In production: replace with real LLM API call
// This module is designed to be swappable

const KNOWN_ANSWERS = {
  country: {"א":["אוסטריה","אוסטרליה","אורוגוואי","אתיופיה","אנגולה","ארגנטינה","איטליה","אירלנד"],"ב":["בלגיה","בולגריה","ברזיל","בנגלדש"],"ג":["גרמניה","גאנה","גרוזיה"],"ד":["דנמרק","דרום אפריקה"],"ה":["הונגריה","הודו","הולנד"],"ו":["ונצואלה","וייטנאם"],"ז":["זמביה","זימבבואה"],"ח":[],"ט":["טורקיה","טנזניה"],"י":["יוון","ירדן","יפן","ישראל"],"כ":["כווית","כרואטיה"],"ל":["לבנון","ליטא","לטביה"],"מ":["מצרים","מקסיקו","מרוקו","מלזיה"],"נ":["נורבגיה","ניגריה","ניו זילנד"],"ס":["סין","ספרד","סרביה"],"ע":["עיראק","עומאן"],"פ":["פולין","פורטוגל","פרו","פינלנד"],"צ":["צרפת","צ'כיה","צ'ילה"],"ק":["קנדה","קולומביה","קניה","קובה"],"ר":["רוסיה","רומניה"],"ש":["שוודיה","שווייץ"],"ת":["תאילנד"]},
  city: {"א":["אילת","אשדוד","אתונה","אמסטרדם"],"ב":["באר שבע","בנגקוק","ברלין","ברצלונה"],"ג":["גבעתיים"],"ד":["דובאי","דבלין"],"ה":["הרצליה","הלסינקי"],"ו":["ונציה","וינה","וושינגטון"],"ז":["זכרון יעקב"],"ח":["חיפה","חולון"],"ט":["טבריה","טוקיו"],"י":["ירושלים"],"כ":["כפר סבא"],"ל":["לונדון","ליסבון"],"מ":["מוסקבה","מדריד","מילאנו"],"נ":["נתניה","ניו יורק"],"ס":["סידני","סן פרנסיסקו"],"ע":["עכו"],"פ":["פריז","פראג"],"צ":["צפת","ציריך"],"ק":["קהיר","קופנהגן"],"ר":["רמת גן","רומא","ראשון לציון"],"ש":["שנגחאי"],"ת":["תל אביב"]},
  animal: {"א":["אריה","אייל","ארנב"],"ב":["ברבור","בבון"],"ג":["ג'ירפה","גמל","גורילה"],"ד":["דב","דולפין"],"ה":["היפופוטם"],"ו":[],"ז":["זברה","זאב"],"ח":["חתול","חמור"],"ט":["טווס"],"י":["יען","ינשוף"],"כ":["כריש","כלב"],"ל":["לוויתן","לטאה"],"מ":["מקאו"],"נ":["נחש","נמר"],"ס":["סוס","סנאי"],"ע":["עכביש","עטלף"],"פ":["פיל","פרה","פנגווין"],"צ":["צב","צפרדע"],"ק":["קוף","קנגורו"],"ר":["רקון"],"ש":["שועל"],"ת":["תנין","תוכי"]},
  plant: {"א":["אקליפטוס","אורן"],"ב":["בננה","ברוש"],"ג":["גזר","גפן"],"ד":["דקל"],"ה":["הדס"],"ו":["ורד"],"ז":["זית"],"ח":["חמנייה"],"ט":["טוליפ"],"י":["יסמין"],"כ":["כלנית"],"ל":["לימון","לוטוס"],"מ":["מנגו","משמש"],"נ":["נרקיס","נענע"],"ס":["סחלב"],"ע":["ענבים"],"פ":["פרג"],"צ":["צבר"],"ק":["קיסוס"],"ר":["רימון","רקפת"],"ש":["שקד","שושנה"],"ת":["תפוח","תאנה"]},
  object: {"א":["אבן","אופניים"],"ב":["בקבוק"],"ג":["גלגל"],"ד":["דלת"],"ה":["הגה"],"ו":["וילון"],"ז":["זכוכית"],"ח":["חלון"],"ט":["טלפון"],"י":[],"כ":["כיסא"],"ל":["לבנה"],"מ":["מחשב","מפתח","מראה"],"נ":["נר","נייר"],"ס":["ספר","סכין"],"ע":["עט","עיפרון"],"פ":["פטיש"],"צ":["צלחת"],"ק":["קערה"],"ר":["רדיו"],"ש":["שולחן","שעון"],"ת":["תיק","תמונה"]},
  food: {"א":["אורז","אבוקדו"],"ב":["בננה","בורקס"],"ג":["גבינה","גלידה"],"ד":["דג","דבש"],"ה":["המבורגר"],"ו":["וופל"],"ז":["זיתים"],"ח":["חומוס","חציל"],"ט":["טחינה"],"י":["יוגורט"],"כ":["כריך"],"ל":["לחם"],"מ":["מרק","מנגו"],"נ":["נקניק"],"ס":["סושי","סלט"],"ע":["עוגה"],"פ":["פיצה","פלאפל"],"צ":["צ'יפס"],"ק":["קינוח"],"ר":["רימון"],"ש":["שניצל","שוקולד"],"ת":["תפוז","תפוח"]},
};

const RARITY = { common: 5, medium: 8, rare: 12, legendary: 15 };

async function judgeAnswer(category, letter, answer, lang = 'he') {
  if (!answer || !answer.trim()) return { valid: false, score: 0, rarity: null };
  const t = answer.trim();
  if (!t.startsWith(letter)) return { valid: false, score: 0, rarity: null, reason: "wrong letter" };

  // Check known database
  const kb = KNOWN_ANSWERS[category]?.[letter] || [];
  const idx = kb.findIndex(w => w === t);
  if (idx >= 0) {
    if (idx <= 1) return { valid: true, score: RARITY.common, rarity: "common" };
    if (idx <= 3) return { valid: true, score: RARITY.medium, rarity: "medium" };
    return { valid: true, score: RARITY.rare, rarity: "rare" };
  }

  // TODO: Replace with real LLM API call
  // const response = await fetch('https://api.anthropic.com/v1/messages', { ... });
  // For now: simulate LLM validation
  if (t.length >= 2) {
    const hash = t.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    if (hash % 6 !== 0) return { valid: true, score: RARITY.legendary, rarity: "legendary" };
  }
  return { valid: false, score: 0, rarity: null, reason: "not recognized" };
}

async function judgeAllAnswers(room) {
  const results = {};
  for (const player of room.players) {
    results[player.id] = {};
    const playerAnswers = room.answers[player.id] || {};
    for (const cat of room.categories) {
      const answer = playerAnswers[cat.id] || "";
      results[player.id][cat.id] = await judgeAnswer(cat.id, room.currentLetter, answer, room.lang);
    }
  }
  return results;
}

// ===================================================================
// BOT SYSTEM (fills empty seats)
// ===================================================================

const BOT_NAMES = [
  { name: "Yuki", flag: "🇯🇵" },
  { name: "Jake", flag: "🇺🇸" },
  { name: "Luna", flag: "🇧🇷" },
  { name: "Sophie", flag: "🇫🇷" },
  { name: "Hans", flag: "🇩🇪" },
];

const BOT_ANSWERS = {
  country:{"א":"אוסטריה","ב":"בלגיה","ג":"גרמניה","ד":"דנמרק","ה":"הודו","ו":"ונצואלה","ז":"זמביה","ט":"טורקיה","י":"יפן","כ":"כווית","ל":"לבנון","מ":"מצרים","נ":"נורבגיה","ס":"ספרד","ע":"עיראק","פ":"פולין","צ":"צרפת","ק":"קנדה","ר":"רוסיה","ש":"שוודיה","ת":"תאילנד"},
  city:{"א":"אמסטרדם","ב":"ברלין","ג":"גבעתיים","ד":"דובאי","ה":"הלסינקי","ו":"וינה","ח":"חיפה","ט":"טוקיו","י":"ירושלים","כ":"כפר סבא","ל":"לונדון","מ":"מדריד","נ":"ניו יורק","ס":"סידני","ע":"עכו","פ":"פריז","צ":"צפת","ק":"קהיר","ר":"רומא","ש":"שנגחאי","ת":"תל אביב"},
  animal:{"א":"אריה","ב":"ברבור","ג":"גמל","ד":"דולפין","ה":"היפופוטם","ז":"זברה","ח":"חתול","ט":"טווס","י":"ינשוף","כ":"כלב","ל":"לוויתן","נ":"נחש","ס":"סוס","ע":"עכביש","פ":"פיל","צ":"צב","ק":"קוף","ש":"שועל","ת":"תנין"},
  plant:{"א":"אורן","ב":"בננה","ג":"גפן","ד":"דקל","ה":"הדס","ו":"ורד","ז":"זית","ח":"חמנייה","ט":"טוליפ","י":"יסמין","כ":"כלנית","ל":"לימון","מ":"מנגו","נ":"נרקיס","ס":"סחלב","ע":"ענבים","פ":"פרג","צ":"צבר","ק":"קיסוס","ר":"רימון","ש":"שקד","ת":"תפוח"},
  object:{"א":"אבן","ב":"בקבוק","ג":"גלגל","ד":"דלת","ו":"וילון","ז":"זכוכית","ח":"חלון","ט":"טלפון","כ":"כיסא","מ":"מחשב","נ":"נר","ס":"ספר","ע":"עט","פ":"פטיש","צ":"צלחת","ק":"קערה","ר":"רדיו","ש":"שולחן","ת":"תיק"},
  food:{"א":"אורז","ב":"בננה","ג":"גלידה","ד":"דג","ה":"המבורגר","ו":"וופל","ז":"זיתים","ח":"חומוס","ט":"טחינה","י":"יוגורט","כ":"כריך","ל":"לחם","מ":"מרק","נ":"נקניק","ס":"סושי","ע":"עוגה","פ":"פיצה","צ":"צ'יפס","ק":"קינוח","ר":"רימון","ש":"שניצל","ת":"תפוז"},
};

function generateBotAnswer(catId, letter) {
  const answer = BOT_ANSWERS[catId]?.[letter] || "";
  return Math.random() > 0.2 ? answer : ""; // 20% chance bot doesn't know
}

function addBots(room, count) {
  for (let i = 0; i < count && room.players.length < MAX_PLAYERS; i++) {
    const botInfo = BOT_NAMES[i % BOT_NAMES.length];
    const colorIndex = room.players.length % AVATAR_COLORS.length;
    room.players.push({
      id: `bot_${i}_${Date.now()}`,
      name: botInfo.name,
      flag: botInfo.flag,
      avatar: botInfo.name[0],
      color: AVATAR_COLORS[colorIndex],
      totalScore: 0,
      roundScores: [],
      isHost: false,
      isBot: true,
      connected: true,
    });
  }
}

// ===================================================================
// SOCKET.IO EVENT HANDLING
// ===================================================================

io.on('connection', (socket) => {
  console.log(`[+] Player connected: ${socket.id}`);
  let currentRoom = null;

  // Create a new room
  socket.on('create_room', ({ name, flag, lang, fillBots }) => {
    const code = createRoom(socket.id);
    currentRoom = code;
    const room = rooms.get(code);
    if (lang) {
      room.lang = lang;
      room.categories = CATEGORIES[lang] || CATEGORIES.he;
    }

    const player = addPlayer(code, socket.id, name, flag);
    socket.join(code);

    // Add bots if requested
    if (fillBots) {
      addBots(room, 3);
    }

    socket.emit('room_created', {
      code,
      player,
      room: sanitizeRoom(room),
    });

    io.to(code).emit('room_update', sanitizeRoom(room));
    console.log(`[*] Room ${code} created by ${name}`);
  });

  // Join existing room
  socket.on('join_room', ({ code, name, flag }) => {
    const room = rooms.get(code);
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.state !== 'lobby') return socket.emit('error', { message: 'Game already started' });
    if (room.players.length >= MAX_PLAYERS) return socket.emit('error', { message: 'Room is full' });

    currentRoom = code;
    const player = addPlayer(code, socket.id, name, flag);
    socket.join(code);

    socket.emit('joined_room', { player, room: sanitizeRoom(room) });
    io.to(code).emit('room_update', sanitizeRoom(room));
    console.log(`[*] ${name} joined room ${code}`);
  });

  // Start game
  socket.on('start_game', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.hostId !== socket.id) return;

    // Fill with bots if not enough players
    if (room.players.length < 4) {
      addBots(room, 4 - room.players.length);
    }

    startRound(room);
  });

  // Submit answers
  socket.on('submit_answers', ({ answers }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.state !== 'playing') return;
    room.answers[socket.id] = answers;

    // Check if all human players submitted
    const humanPlayers = room.players.filter(p => !p.isBot);
    const allSubmitted = humanPlayers.every(p => room.answers[p.id]);
    if (allSubmitted) {
      endRound(room);
    }
  });

  // Player hit STOP
  socket.on('stop_round', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.state !== 'playing') return;
    endRound(room);
  });

  // Next round
  socket.on('next_round', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    if (room.currentRound >= MAX_ROUNDS) {
      room.state = 'gameover';
      io.to(currentRoom).emit('game_over', {
        players: room.players.map(p => ({
          id: p.id, name: p.name, flag: p.flag, avatar: p.avatar,
          color: p.color, totalScore: p.totalScore, roundScores: p.roundScores,
        })),
      });
    } else {
      startRound(room);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[-] Player disconnected: ${socket.id}`);
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) player.connected = false;
        io.to(currentRoom).emit('room_update', sanitizeRoom(room));

        // Clean up empty rooms
        const connected = room.players.filter(p => p.connected && !p.isBot);
        if (connected.length === 0) {
          rooms.delete(currentRoom);
          console.log(`[x] Room ${currentRoom} deleted (empty)`);
        }
      }
    }
  });
});

// ===================================================================
// GAME FLOW
// ===================================================================

function startRound(room) {
  const letters = room.lang === 'en' ? ENGLISH_LETTERS : HEBREW_LETTERS;
  const available = letters.filter(l => !room.usedLetters.includes(l));
  const letter = available[Math.floor(Math.random() * available.length)];

  room.currentLetter = letter;
  room.usedLetters.push(letter);
  room.currentRound++;
  room.answers = {};
  room.results = {};
  room.state = 'spinning';

  io.to(room.code).emit('round_start', {
    round: room.currentRound,
    maxRounds: MAX_ROUNDS,
  });

  // After spin animation, start playing
  setTimeout(() => {
    room.state = 'playing';
    room.timerEnd = Date.now() + ROUND_TIME * 1000;

    io.to(room.code).emit('letter_revealed', {
      letter,
      timerEnd: room.timerEnd,
    });

    // Generate bot answers
    room.players.filter(p => p.isBot).forEach(bot => {
      const botAnswers = {};
      room.categories.forEach(cat => {
        botAnswers[cat.id] = generateBotAnswer(cat.id, letter);
      });
      room.answers[bot.id] = botAnswers;
    });

    // Auto-end round after timer
    setTimeout(() => {
      if (room.state === 'playing') {
        endRound(room);
      }
    }, ROUND_TIME * 1000);
  }, 2500);
}

async function endRound(room) {
  if (room.state !== 'playing') return;
  room.state = 'judging';

  io.to(room.code).emit('judging_start');

  // Judge all answers
  const results = await judgeAllAnswers(room);
  room.results = results;

  // Calculate scores
  for (const player of room.players) {
    const playerResults = results[player.id] || {};
    const roundScore = Object.values(playerResults).reduce((s, r) => s + (r?.score || 0), 0);
    player.totalScore += roundScore;
    player.roundScores.push({ letter: room.currentLetter, score: roundScore });
  }

  // Send judging animation data
  io.to(room.code).emit('judging_results', {
    results,
    answers: room.answers,
    players: room.players.map(p => ({
      id: p.id, name: p.name, flag: p.flag, avatar: p.avatar,
      color: p.color, totalScore: p.totalScore,
      roundScore: p.roundScores[p.roundScores.length - 1]?.score || 0,
    })),
    round: room.currentRound,
    maxRounds: MAX_ROUNDS,
  });

  room.state = 'scoreboard';
}

function sanitizeRoom(room) {
  return {
    code: room.code,
    state: room.state,
    players: room.players.map(p => ({
      id: p.id, name: p.name, flag: p.flag, avatar: p.avatar,
      color: p.color, totalScore: p.totalScore, isHost: p.isHost,
      isBot: !!p.isBot, connected: p.connected,
    })),
    currentRound: room.currentRound,
    maxRounds: MAX_ROUNDS,
    lang: room.lang,
    categories: room.categories,
  };
}

// ===================================================================
// API ROUTES
// ===================================================================

app.get('/api/rooms/:code', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(sanitizeRoom(room));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, uptime: process.uptime() });
});

// ===================================================================
// START SERVER
// ===================================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌍 World Words+ Server running on http://localhost:${PORT}`);
  console.log(`   Rooms: 0 | Players: 0\n`);
});
