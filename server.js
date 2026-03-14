// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// â  ð WORLD WORDS + Server                             â
// â  Node.js + Socket.io + AI Judge                      â
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

const HEBREW_LETTERS = "×××××××××××××× ×¡×¢×¤×¦×§×¨×©×ª".split("");
const ENGLISH_LETTERS = "ABCDEFGHIJKLMNOPRSTUVW".split("");

const FLAG_POOL = ["ð®ð±","ð¯ðµ","ðºð¸","ð§ð·","ð«ð·","ð©ðª","ð®ð³","ð¬ð§","ð°ð·","ð²ð½","ð®ð¹","ðªð¸","ð¦ðº","ð¨ð¦","ð·ðº"];
const AVATAR_COLORS = ["#00e5ff","#ff6090","#7c4dff","#00e676","#ffab40","#ff5252"];

const CATEGORIES = {
  he: [
    { id: "country", name: "××¨×¥", icon: "ð" },
    { id: "city", name: "×¢××¨", icon: "ðï¸" },
    { id: "animal", name: "××", icon: "ð¦" },
    { id: "plant", name: "×¦×××", icon: "ð¿" },
    { id: "object", name: "××××", icon: "ðª¨" },
    { id: "food", name: "××××", icon: "ð" },
  ],
  en: [
    { id: "country", name: "Country", icon: "ð" },
    { id: "city", name: "City", icon: "ðï¸" },
    { id: "animal", name: "Animal", icon: "ð¦" },
    { id: "plant", name: "Plant", icon: "ð¿" },
    { id: "object", name: "Object", icon: "ðª¨" },
    { id: "food", name: "Food", icon: "ð" },
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
// Uses Claude Haiku API for real-time multilingual validation
// Falls back to local dictionary + heuristic if API unavailable

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const KNOWN_ANSWERS = {
  country: {"×":["×××¡××¨××","×××¡××¨×××","×××¨××××××","××ª×××¤××","×× ××××","××¨×× ××× ×","××××××","×××¨×× ×"],"×":["×××××","×××××¨××","××¨×××","×× ××××©"],"×":["××¨×× ××","××× ×","××¨××××"],"×":["×× ××¨×§","××¨×× ××¤×¨××§×"],"×":["××× ××¨××","××××","×××× ×"],"×":["×× ×¦××××","××××× ××"],"×":["×××××","××××××××"],"×":[],"×":["×××¨×§××","×× ×× ××"],"×":["××××","××¨××","××¤×","××©×¨××"],"×":["×××××ª","××¨×××××"],"×":["××× ××","××××","×××××"],"×":["××¦×¨××","××§×¡××§×","××¨××§×","×××××"],"× ":["× ××¨××××","× ×××¨××","× ×× ×××× ×"],"×¡":["×¡××","×¡×¤×¨×","×¡×¨×××"],"×¢":["×¢××¨××§","×¢××××"],"×¤":["×¤××××","×¤××¨××××","×¤×¨×","×¤×× ×× ×"],"×¦":["×¦×¨×¤×ª","×¦'×××","×¦'×××"],"×§":["×§× ××","×§×××××××","×§× ××","×§×××"],"×¨":["×¨××¡××","×¨××× ××"],"×©":["×©×××××","×©×××××¥"],"×ª":["×ª×××× ×"]},
  city: {"×":["××××ª","××©×××","××ª×× ×","×××¡××¨××"],"×":["×××¨ ×©××¢","×× ××§××§","××¨×××","××¨×¦××× ×"],"×":["×××¢×ª×××"],"×":["×××××","×××××"],"×":["××¨×¦×××","×××¡×× ×§×"],"×":["×× ×¦××","××× ×","×××©×©×× ×××"],"×":["×××¨×× ××¢×§×"],"×":["×××¤×","×××××"],"×":["×××¨××","×××§××"],"×":["××¨××©×××"],"×":["××¤×¨ ×¡××"],"×":["××× ×××","×××¡×××"],"×":["×××¡×§××","×××¨××","××××× ×"],"× ":["× ×ª× ××","× ×× ×××¨×§"],"×¡":["×¡××× ×","×¡× ×¤×¨× ×¡××¡×§×"],"×¢":["×¢××"],"×¤":["×¤×¨××","×¤×¨××"],"×¦":["×¦×¤×ª","×¦××¨××"],"×§":["×§×××¨","×§××¤× ×××"],"×¨":["×¨××ª ××","×¨×××","×¨××©×× ××¦×××"],"×©":["×©× ××××"],"×ª":["×ª× ××××"]},
  animal: {"×":["××¨××","××××","××¨× ×"],"×":["××¨×××¨","××××"],"×":["×'××¨×¤×","×××","×××¨×××"],"×":["××","××××¤××"],"×":["×××¤××¤×××"],"×":[],"×":["×××¨×","×××"],"×":["××ª××","××××¨"],"×":["××××¡"],"×":["××¢×","×× ×©××£"],"×":["××¨××©","×××"],"×":["×××××ª×","××××"],"×":["××§××"],"× ":["× ××©","× ××¨"],"×¡":["×¡××¡","×¡× ××"],"×¢":["×¢××××©","×¢×××£"],"×¤":["×¤××","×¤×¨×","×¤× ×××××"],"×¦":["×¦×","×¦×¤×¨××¢"],"×§":["×§××£","×§× ×××¨×"],"×¨":["×¨×§××"],"×©":["×©××¢×"],"×ª":["×ª× ××","×ª×××"]},
  plant: {"×":["××§×××¤×××¡","×××¨×"],"×":["×× × ×","××¨××©"],"×":["×××¨","××¤×"],"×":["××§×"],"×":["×××¡"],"×":["××¨×"],"×":["×××ª"],"×":["××× ×××"],"×":["×××××¤"],"×":["××¡×××"],"×":["××× ××ª"],"×":["×××××","×××××¡"],"×":["×× ××","××©××©"],"× ":["× ×¨×§××¡","× ×¢× ×¢"],"×¡":["×¡×××"],"×¢":["×¢× ×××"],"×¤":["×¤×¨×"],"×¦":["×¦××¨"],"×§":["×§××¡××¡"],"×¨":["×¨××××","×¨×§×¤×ª"],"×©":["×©×§×","×©××©× ×"],"×ª":["×ª×¥××","×ª×× ×"]},
  object: {"×":["×××","×××¤× ×××"],"×":["××§×××§"],"×":["××××"],"×":["×××ª"],"×":["×××"],"×":["×××××"],"×":["××××××ª"],"×":["××××"],"×":["×××¤××"],"×":[],"×":["×××¡×"],"×":["××× ×"],"×":["×××©×","××¤×ª×","××¨××"],"× ":["× ×¨","× ×××¨"],"×¡":["×¡×¤×¨","×¡×××"],"×¢":["×¢×","×¢××¤×¨××"],"×¤":["×¤×××©"],"×¦":["×¦×××ª"],"×§":["×§×¢×¨×"],"×¨":["×¨×××"],"×©":["×©××××","×©×¢××"],"×ª":["×ª××§","×ª××× ×"]},
  food: {"×":["×××¨×","××××§××"],"×":["×× × ×","×××¨×§×¡"],"×":["×××× ×","×××××"],"×":["××","×××©"],"×":["×××××¨××¨"],"×":["×××¤×"],"×":["×××ª××"],"×":["×××××¡","××¦××"],"×":["×××× ×"],"×":["×××××¨×"],"×":["××¨××"],"×":["×××"],"×":["××¨×§","×× ××"],"× ":["× ×§× ××§"],"×¡":["×¡××©×","×¡××"],"×¢":["×¢×××"],"×¤":["×¤××¦×","×¤×××¤×"],"×¦":["×¦'××¤×¡"],"×§":["×§×× ××"],"×¨":["×¨××××"],"×©":["×©× ××¦×","×©××§×××"],"×ª":["×ª×¤××","×ª×¤××"]},
};

const RARITY = { common: 5, medium: 8, rare: 12, legendary: 15 };

// Real AI Judge using Claude Haiku API
async function judgeWithAI(answers, categories, letter, lang) {
  if (!ANTHROPIC_API_KEY) return null; // Fall back to local judge

  const categoryNames = categories.map(c => c.name).join(', ');
  const answerList = [];
  for (const cat of categories) {
    const answer = answers[cat.id] || '';
    if (answer.trim()) {
      answerList.push(`- Category "${cat.name}" (${cat.id}): "${answer.trim()}"`);
    }
  }
  if (answerList.length === 0) return null;

  const prompt = `You are the judge for a word game (like "Categories" / "Scattergories" / "××¨×¥ ×¢××¨ ×× ×¦××× ××××").
The current letter is "${letter}". Language: ${lang === 'he' ? 'Hebrew' : 'English'}.
Categories: ${categoryNames}.

For each answer below, determine:
1. Is it a valid answer that starts with the letter "${letter}" and belongs to the category?
2. Rate its rarity: "common" (very obvious answer), "medium" (decent answer), "rare" (creative/unusual), "legendary" (exceptionally creative/obscure but valid)

Answers to judge:
${answerList.join('\n')}

Respond ONLY with a JSON object. Keys are category IDs, values are objects with "valid" (boolean), "rarity" (string), and "reason" (short string).
Example: {"country":{"valid":true,"rarity":"rare","reason":"Valid but uncommon country"},"city":{"valid":false,"rarity":null,"reason":"Does not start with the correct letter"}}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20241022',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error(`[AI] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const results = {};
    for (const cat of categories) {
      const judgment = parsed[cat.id];
      if (judgment) {
        const rarityMap = { common: RARITY.common, medium: RARITY.medium, rare: RARITY.rare, legendary: RARITY.legendary };
        results[cat.id] = {
          valid: !!judgment.valid,
          score: judgment.valid ? (rarityMap[judgment.rarity] || RARITY.medium) : 0,
          rarity: judgment.valid ? (judgment.rarity || 'medium') : null,
          reason: judgment.reason || '',
        };
      }
    }
    return results;
  } catch (err) {
    console.error(`[AI] Judge error:`, err.message);
    return null;
  }
}

// Local fallback judge (dictionary + heuristic)
async function judgeAnswerLocal(category, letter, answer, lang = 'he') {
  if (!answer || !answer.trim()) return { valid: false, score: 0, rarity: null };
  const t = answer.trim();
  if (!t.startsWith(letter)) return { valid: false, score: 0, rarity: null, reason: "wrong letter" };

  const kb = KNOWN_ANSWERS[category]?.[letter] || [];
  const idx = kb.findIndex(w => w === t);
  if (idx >= 0) {
    if (idx <= 1) return { valid: true, score: RARITY.common, rarity: "common" };
    if (idx <= 3) return { valid: true, score: RARITY.medium, rarity: "medium" };
    return { valid: true, score: RARITY.rare, rarity: "rare" };
  }

  // Heuristic fallback for unknown answers
  if (t.length >= 2) {
    const hash = t.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    if (hash % 6 !== 0) return { valid: true, score: RARITY.legendary, rarity: "legendary" };
  }
  return { valid: false, score: 0, rarity: null, reason: "not recognized" };
}

async function judgeAllAnswers(room) {
  const results = {};
  const useAI = !!ANTHROPIC_API_KEY;

  for (const player of room.players) {
    results[player.id] = {};
    const playerAnswers = room.answers[player.id] || {};

    if (useAI) {
      // Try AI batch judge for this player
      const aiResults = await judgeWithAI(playerAnswers, room.categories, room.currentLetter, room.lang);
      if (aiResults) {
        for (const cat of room.categories) {
          results[player.id][cat.id] = aiResults[cat.id] || { valid: false, score: 0, rarity: null };
        }
        console.log(`[AI] Judged ${player.name} via Claude Haiku`);
        continue;
      }
    }

    // Fallback to local judge
    for (const cat of room.categories) {
      const answer = playerAnswers[cat.id] || "";
      results[player.id][cat.id] = await judgeAnswerLocal(cat.id, room.currentLetter, answer, room.lang);
    }
    console.log(`[AI] Judged ${player.name} via local dictionary`);
  }
  return results;
}

// ===================================================================
// BOT SYSTEM (fills empty seats)
// ===================================================================

const BOT_NAMES = [
  { name: "Yuki", flag: "ð¯ðµ" },
  { name: "Jake", flag: "ðºð¸" },
  { name: "Luna", flag: "ð§ð·" },
  { name: "Sophie", flag: "ð«ð·" },
  { name: "Hans", flag: "ð©ðª" },
];

const BOT_ANSWERS = {
  country:{"×":"×××¡××¨××","×":"×××××","×":"××¨×× ××","×":"×× ××¨×§","×":"××××","×":"×× ×¦××××","×":"×××××","×":"×××¨×§××","×":"××¤×","×":"×××××ª","×":"××× ××","×":"××¦×¨××","× ":"× ××¨××××","×¡":"×¡×¤×¨×","×¢":"×¢××¨××§","×¤":"×¤××××","×¦":"×¦×¨×¤×ª","×§":"×§× ××","×¨":"×¨××¡××","×©":"×©×××××","×ª":"×ª×××× ×"},
  city:{"×":"×××¡××¨××","×":"××¨×××","×":"×××¢×ª×××","×":"×××××","×":"×××¡×× ×§×","×":"××× ×","×":"×××¤×","×":"×××§××","×":"××¨××©×××","×":"××¤×¨ ×¡××","×":"××× ×××","×":"×××¨××","× ":"× ×× ×××¨×§","×¡":"×¡××× ×","×¢":"×¢××","×¤":"×¤×¨××","×¦":"×¦×¤×ª","×§":"×§×××¨","×¨":"×¨×××","×©":"×©× ××××","×ª":"×ª× ××××"},
  animal:{"×":"××¨××","×":"××¨×××¨","×":"×××","×":"××××¤××","×":"×××¤××¤×××","×":"×××¨×","×":"××ª××","×":"××××¡","×":"×× ×©××£","×":"×××","×":"×××××ª×","× ":"× ××©","×¡":"×¡××¡","×¢":"×¢××××©","×¤":"×¤××","×¦":"×¦×","×§":"×§××£","×©":"×©××¢×","×ª":"×ª× ××"},
  plant:{"×":"×××¨×","×":"×× × ×","×":"××¤×","×":"××§×","×":"×××¡","×":"××¨×","×":"×××ª","×":"××× ×××","×":"×××××¤","×":"××¡×××","×":"××× ××ª","×":"×××××","×":"×× ××","× ":"× ×¨×§××¡","×¡":"×¡×××","×¢":"×¢× ×××","×¤":"×¤×¨×","×¦":"×¦××¨","×§":"×§××¡××¡","×¨":"×¨××××","×©":"×©×§×","×ª":"×ª×¥××"},
  object:{"×":"×××","×":"××§×××§","×":"××××","×":"×××ª","×":"×××××","×":"××××××ª","×":"××××","×":"×××¤××","×":"×××¡×","×":"×××©×","× ":"× ×¨","×¡":"×¡×¤×¨","×¢":"×¢×","×¤":"×¤×××©","×¦":"×¦×××ª","×§":"×§×¢×¨×","×¨":"×¨×××","×©":"×©××××","×ª":"×ª××§"},
  food:{"×":"×××¨×","×":"×× × ×","×":"×××××","×":"××","×":"×××××¨××¨","×":"×××¤×","×":"×××ª××","×":"×××××¡","×":"×××× ×","×":"×××××¨×","×":"××¨××","×":"×××","×":"××¨×§","× ":"× ×§× ××§","×¡":"×¡××©×","×¢":"×¢×××","×¤":"×¤××¦×","×¦":"×¦'××¤×¡","×§":"×§×× ××","×¨":"×¨××××","×©":"×©× ××¦×","×ª":"×ª×¥××"},
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

app.get('/api/rooms/check/:code', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.json({ exists: false });
  res.json({ exists: true, state: room.state, playerCount: room.players.length, maxPlayers: MAX_PLAYERS });
});

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
  console.log(`\nð World Words+ Server running on http://localhost:${PORT}`);
  console.log(`   Rooms: 0 | Players: 0\n`);
});
