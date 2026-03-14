const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const ROUND_TIME = 60;
const MAX_ROUNDS = 5;

const CATEGORIES = [
  { id: 'country', name: 'Country', nameHe: '××¨×¥' },
  { id: 'city', name: 'City', nameHe: '×¢××¨' },
  { id: 'animal', name: 'Animal', nameHe: '××' },
  { id: 'plant', name: 'Plant', nameHe: '×¦×××' },
  { id: 'object', name: 'Object', nameHe: '××××' }
];

const LETTERS_HE = '×××××××××××××× ×¡×¢×¤×¦×§×¨×©×ª'.split('');
const LETTERS_EN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function isValid(answer, letter) {
  if (!answer || !answer.trim()) return false;
  return answer.trim().toLowerCase().startsWith(letter.toLowerCase());
}

function createRoom(lang) {
  const code = generateCode();
  rooms[code] = {
    code,
    players: [],
    state: 'waiting',
    hostId: null,
    currentLetter: null,
    currentRound: 0,
    maxRounds: MAX_ROUNDS,
    lang,
    answers: {},
    scores: {},
    isActive: false,
    timer: null
  };
  return rooms[code];
}

function broadcastRoomState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit('game_update', room);
}

function autoStopRound(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.isActive) return;
  room.isActive = false;
  io.to(roomCode).emit('stop_round');
  setTimeout(() => judgeAndBroadcast(roomCode), 1000);
}

function judgeAndBroadcast(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const results = {};
  const categoryScores = {};

  Object.keys(room.answers).forEach(playerId => {
    results[playerId] = {};
    room.players.forEach(p => {
      if (p.id === playerId) {
        CATEGORIES.forEach(cat => {
          const answer = room.answers[playerId][cat.id] || '';
          const valid = isValid(answer, room.currentLetter);
          results[playerId][cat.id] = { valid, score: valid ? 10 : 0 };
          room.scores[playerId] = (room.scores[playerId] || 0) + (valid ? 10 : 0);
        });
      }
    });
  });

  room.state = 'results';
  io.to(roomCode).emit('results', {
    results,
    scores: room.scores,
    letter: room.currentLetter
  });
}

function startRound(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.currentRound >= room.maxRounds) return;

  room.currentRound++;
  room.answers = {};
  room.state = 'playing';
  room.isActive = true;

  const letters = room.lang === 'he' ? LETTERS_HE : LETTERS_EN;
  room.currentLetter = letters[Math.floor(Math.random() * letters.length)];

  broadcastRoomState(roomCode);

  clearTimeout(room.timer);
  room.timer = setTimeout(() => autoStopRound(roomCode), ROUND_TIME * 1000);
}

// REST Endpoints
app.use(express.static('public'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Socket.IO
io.on('connection', (socket) => {
  socket.on('join_room', ({ name, code, lang = 'en' }) => {
    let room;

    if (code && rooms[code]) {
      room = rooms[code];
      if (room.players.length >= MAX_PLAYERS) {
        socket.emit('error', { message: 'Room full' });
        return;
      }
    } else {
      room = createRoom(lang);
    }

    socket.join(room.code);
    room.players.push({ id: socket.id, name });
    room.scores[socket.id] = 0;

    if (!room.hostId) room.hostId = socket.id;

    socket.emit('game_update', room);
    broadcastRoomState(room.code);
  });

  socket.on('start_game', () => {
    const roomCode = Array.from(socket.rooms)[1];
    const room = rooms[roomCode];

    if (!room || room.hostId !== socket.id) {
      socket.emit('error', { message: 'Not host' });
      return;
    }

    startRound(roomCode);
  });

  socket.on('submit_answers', ({ answers }) => {
    const roomCode = Array.from(socket.rooms)[1];
    const room = rooms[roomCode];

    if (!room || room.state !== 'playing') {
      socket.emit('error', { message: 'Round not active' });
      return;
    }

    room.answers[socket.id] = answers;
  });

  socket.on('stop_game', () => {
    const roomCode = Array.from(socket.rooms)[1];
    const room = rooms[roomCode];

    if (!room) return;

    room.isActive = false;
    io.to(roomCode).emit('stop_round');
    setTimeout(() => judgeAndBroadcast(roomCode), 1000);
  });

  socket.on('next_round', () => {
    const roomCode = Array.from(socket.rooms)[1];
    const room = rooms[roomCode];

    if (!room || room.hostId !== socket.id) {
      socket.emit('error', { message: 'Not host' });
      return;
    }

    if (room.currentRound >= room.maxRounds) {
      const winner = Object.entries(room.scores).reduce((a, b) =>
        a[1] > b[1] ? a : b
      );
      room.state = 'finished';
      const winnerPlayer = room.players.find(p => p.id === winner[0]);
      io.to(roomCode).emit('game_over', {
        scores: room.scores,
        winner: winnerPlayer
      });
      return;
    }

    startRound(roomCode);
  });

  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          clearTimeout(room.timer);
          delete rooms[code];
        } else {
          if (room.hostId === socket.id && room.players.length > 0) {
            room.hostId = room.players[0].id;
          }
          broadcastRoomState(code);
        }
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`World Words+ server running on port ${PORT}`);
});
