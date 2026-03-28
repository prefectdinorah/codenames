const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const words = require('./words');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

const TEAM_IDS = ['red', 'blue', 'green', 'orange', 'purple'];
const TEAM_INFO = {
  red: { name: 'Красные', color: '#e74c3c' },
  blue: { name: 'Синие', color: '#3498db' },
  green: { name: 'Зелёные', color: '#2ecc71' },
  orange: { name: 'Оранжевые', color: '#e67e22' },
  purple: { name: 'Фиолетовые', color: '#9b59b6' },
};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function defaultGrid(teamCount) {
  switch (teamCount) {
    case 2: return [5, 5];
    case 3: return [6, 5];
    case 4: return [6, 6];
    case 5: return [7, 6];
    default: return [5, 5];
  }
}

function createGame(settings) {
  const { teamCount, gridRows, gridCols } = settings;
  const totalCards = gridRows * gridCols;
  const selected = shuffle(words).slice(0, totalCards);
  const teams = TEAM_IDS.slice(0, teamCount);
  const shuffledTeams = shuffle([...teams]);
  const firstTeam = shuffledTeams[0];

  const perTeam = Math.floor((totalCards - 1) / (teamCount + 1));
  const distribution = [];
  for (let i = 0; i < perTeam + 1; i++) distribution.push(firstTeam);
  for (const t of teams.filter((t) => t !== firstTeam)) {
    for (let i = 0; i < perTeam; i++) distribution.push(t);
  }
  distribution.push('assassin');
  while (distribution.length < totalCards) distribution.push('neutral');

  const types = shuffle(distribution);
  const cards = selected.map((word, i) => ({
    word,
    type: types[i],
    revealed: false,
  }));

  const totals = {};
  const scores = {};
  for (const t of teams) {
    totals[t] = types.filter((tp) => tp === t).length;
    scores[t] = 0;
  }

  return {
    cards,
    teams,
    turn: firstTeam,
    firstTeam,
    clue: null,
    winner: null,
    assassinLoser: false,
    scores,
    totals,
    clueHistory: [],
    paused: true,
    timerEnd: null,
    timerRemaining: null,
    playerVotes: {},
    confirmingCard: null,
    confirmAt: null,
  };
}

// ===== Room management =====

function createRoom(hostId) {
  const code = generateRoomCode();
  const settings = { teamCount: 2, gridRows: 5, gridCols: 5, timerDuration: 0 };
  const room = {
    code,
    hostId,
    players: new Map(),
    settings,
    game: createGame(settings),
    timerTimeout: null,
    confirmTimeout: null,
  };
  rooms.set(code, room);
  return room;
}

// ===== Timer =====

function clearTimer(room) {
  if (room.timerTimeout) {
    clearTimeout(room.timerTimeout);
    room.timerTimeout = null;
  }
  room.game.timerEnd = null;
  room.game.timerRemaining = null;
}

function startTimer(room) {
  clearTimer(room);
  const duration = room.settings.timerDuration;
  if (!duration || duration <= 0) return;
  room.game.timerEnd = Date.now() + duration * 1000;
  room.game.timerRemaining = duration;
  room.timerTimeout = setTimeout(() => {
    if (room.game.winner || room.game.paused) return;
    clearVotes(room);
    nextTurn(room);
    broadcastRoom(room);
  }, duration * 1000);
}

function pauseTimer(room) {
  if (!room.game.timerEnd) return;
  const remaining = Math.max(0, Math.ceil((room.game.timerEnd - Date.now()) / 1000));
  room.game.timerRemaining = remaining;
  room.game.timerEnd = null;
  if (room.timerTimeout) {
    clearTimeout(room.timerTimeout);
    room.timerTimeout = null;
  }
}

function resumeTimer(room) {
  const remaining = room.game.timerRemaining;
  if (!remaining || remaining <= 0 || !room.settings.timerDuration) return;
  room.game.timerEnd = Date.now() + remaining * 1000;
  room.timerTimeout = setTimeout(() => {
    if (room.game.winner || room.game.paused) return;
    clearVotes(room);
    nextTurn(room);
    broadcastRoom(room);
  }, remaining * 1000);
}

function addTime(room, seconds) {
  if (!room.game.timerEnd) return;
  room.game.timerEnd += seconds * 1000;
  room.game.timerRemaining = Math.max(0, Math.ceil((room.game.timerEnd - Date.now()) / 1000));
  if (room.timerTimeout) {
    clearTimeout(room.timerTimeout);
    const remaining = room.game.timerEnd - Date.now();
    if (remaining > 0) {
      room.timerTimeout = setTimeout(() => {
        if (room.game.winner || room.game.paused) return;
        clearVotes(room);
        nextTurn(room);
        broadcastRoom(room);
      }, remaining);
    }
  }
}

// ===== Turn management =====

function nextTurn(room) {
  const game = room.game;
  const idx = game.teams.indexOf(game.turn);
  game.turn = game.teams[(idx + 1) % game.teams.length];
  game.clue = null;
  clearVotes(room);
  startTimer(room);
}

function checkWin(game) {
  for (const t of game.teams) {
    if (game.scores[t] >= game.totals[t]) {
      game.winner = t;
      return;
    }
  }
}

// ===== Vote / confirmation system =====

function getTeamOperatives(room, teamId) {
  const ops = [];
  for (const [id, p] of room.players) {
    if (p.team === teamId && p.role === 'operative') ops.push(id);
  }
  return ops;
}

function clearVotes(room) {
  room.game.playerVotes = {};
  cancelConfirmation(room);
}

function cancelConfirmation(room) {
  if (room.confirmTimeout) {
    clearTimeout(room.confirmTimeout);
    room.confirmTimeout = null;
  }
  room.game.confirmingCard = null;
  room.game.confirmAt = null;
}

function checkVoteConsensus(room) {
  const game = room.game;
  const operatives = getTeamOperatives(room, game.turn);
  if (operatives.length === 0) return;

  const votes = operatives.map((id) => game.playerVotes[id]).filter((v) => v !== undefined);

  if (votes.length === operatives.length && new Set(votes).size === 1) {
    const cardIndex = votes[0];
    if (game.confirmingCard !== cardIndex) {
      startConfirmation(room, cardIndex);
    }
  } else {
    if (game.confirmingCard !== null) {
      cancelConfirmation(room);
    }
  }
}

function startConfirmation(room, cardIndex) {
  cancelConfirmation(room);
  room.game.confirmingCard = cardIndex;
  room.game.confirmAt = Date.now() + 1000;
  room.confirmTimeout = setTimeout(() => {
    executeGuess(room, cardIndex);
    broadcastRoom(room);
  }, 1000);
  broadcastRoom(room);
}

function executeGuess(room, cardIndex) {
  const game = room.game;
  const card = game.cards[cardIndex];
  if (!card || card.revealed) return;

  card.revealed = true;
  clearVotes(room);

  if (card.type === 'assassin') {
    if (game.teams.length === 2) {
      game.winner = game.teams.find((t) => t !== game.turn);
    } else {
      game.winner = game.turn;
      game.assassinLoser = true;
    }
    clearTimer(room);
    return;
  }

  if (game.teams.includes(card.type)) {
    game.scores[card.type]++;
  }

  checkWin(game);
  if (game.winner) {
    clearTimer(room);
    return;
  }

  if (card.type === game.turn) {
    // Correct guess — stay on turn, +15 seconds
    addTime(room, 15);
  } else {
    // Wrong color — end turn
    nextTurn(room);
  }
}

// ===== State broadcasting =====

function getCardVoteCounts(room) {
  const counts = {};
  for (const cardIndex of Object.values(room.game.playerVotes)) {
    counts[cardIndex] = (counts[cardIndex] || 0) + 1;
  }
  return counts;
}

function getPlayerState(room, playerId) {
  const player = room.players.get(playerId);
  const isSpymaster = player && player.role === 'spymaster';

  const cards = room.game.cards.map((c) => ({
    word: c.word,
    revealed: c.revealed,
    type: c.revealed || isSpymaster || room.game.winner ? c.type : null,
  }));

  const players = [];
  for (const [id, p] of room.players) {
    players.push({ id, name: p.name, team: p.team, role: p.role });
  }

  return {
    type: 'state',
    roomCode: room.code,
    cards,
    gridRows: room.settings.gridRows,
    gridCols: room.settings.gridCols,
    teams: room.game.teams,
    teamInfo: TEAM_INFO,
    turn: room.game.turn,
    clue: room.game.clue,
    winner: room.game.winner,
    assassinLoser: room.game.assassinLoser,
    scores: room.game.scores,
    totals: room.game.totals,
    clueHistory: room.game.clueHistory,
    paused: room.game.paused,
    timerEnd: room.game.timerEnd,
    timerRemaining: room.game.timerRemaining,
    cardVotes: getCardVoteCounts(room),
    operativeCount: getTeamOperatives(room, room.game.turn).length,
    confirmingCard: room.game.confirmingCard,
    confirmAt: room.game.confirmAt,
    yourVote: player ? (room.game.playerVotes[playerId] !== undefined ? room.game.playerVotes[playerId] : null) : null,
    players,
    you: player ? { id: playerId, name: player.name, team: player.team, role: player.role } : null,
    hostId: room.hostId,
    settings: room.settings,
  };
}

function broadcastRoom(room) {
  for (const [id, player] of room.players) {
    if (player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(getPlayerState(room, id)));
    }
  }
}

// ===== WebSocket handling =====

let nextPlayerId = 1;

wss.on('connection', (ws) => {
  const playerId = String(nextPlayerId++);
  let currentRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create-room') {
      const room = createRoom(playerId);
      currentRoom = room;
      room.players.set(playerId, { ws, name: msg.name || 'Игрок', team: null, role: null });
      ws.send(JSON.stringify(getPlayerState(room, playerId)));
    }

    if (msg.type === 'join-room') {
      const code = (msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' }));
        return;
      }
      currentRoom = room;
      room.players.set(playerId, { ws, name: msg.name || 'Игрок', team: null, role: null });
      broadcastRoom(room);
    }

    if (msg.type === 'change-name') {
      if (!currentRoom) return;
      const player = currentRoom.players.get(playerId);
      if (!player) return;
      player.name = (msg.name || '').trim().slice(0, 20) || 'Игрок';
      broadcastRoom(currentRoom);
    }

    if (msg.type === 'pick-team') {
      if (!currentRoom) return;
      const player = currentRoom.players.get(playerId);
      if (!player) return;
      const goingSpectator = !msg.team;
      if (currentRoom.game.paused && !goingSpectator) return;

      const team = msg.team || null;
      const role = msg.role || null;
      if (team && !currentRoom.game.teams.includes(team)) return;
      if (role && role !== 'spymaster' && role !== 'operative') return;

      // Clear vote if switching
      delete currentRoom.game.playerVotes[playerId];
      checkVoteConsensus(currentRoom);

      player.team = team;
      player.role = team ? (role || 'operative') : null;
      broadcastRoom(currentRoom);
    }

    if (msg.type === 'update-settings') {
      if (!currentRoom || playerId !== currentRoom.hostId) return;
      const teamCount = Math.max(2, Math.min(5, parseInt(msg.teamCount, 10) || 2));
      const gridRows = Math.max(4, Math.min(8, parseInt(msg.gridRows, 10) || 5));
      const gridCols = Math.max(4, Math.min(8, parseInt(msg.gridCols, 10) || 5));
      const timerDuration = Math.max(0, Math.min(300, parseInt(msg.timerDuration, 10) || 0));
      currentRoom.settings = { teamCount, gridRows, gridCols, timerDuration };
      clearTimer(currentRoom);
      clearVotes(currentRoom);
      currentRoom.game = createGame(currentRoom.settings);
      const validTeams = TEAM_IDS.slice(0, teamCount);
      for (const [, p] of currentRoom.players) {
        if (p.team && !validTeams.includes(p.team)) {
          p.team = null;
          p.role = null;
        }
      }
      broadcastRoom(currentRoom);
    }

    if (msg.type === 'toggle-pause') {
      if (!currentRoom || currentRoom.game.winner) return;
      const game = currentRoom.game;
      game.paused = !game.paused;
      if (game.paused) {
        pauseTimer(currentRoom);
      } else {
        if (game.timerRemaining > 0) {
          resumeTimer(currentRoom);
        } else {
          startTimer(currentRoom);
        }
      }
      broadcastRoom(currentRoom);
    }

    if (msg.type === 'give-clue') {
      if (!currentRoom) return;
      const game = currentRoom.game;
      if (game.paused || game.winner) return;
      const player = currentRoom.players.get(playerId);
      if (!player || player.role !== 'spymaster' || player.team !== game.turn) return;

      const count = parseInt(msg.count, 10);
      if (!msg.word || isNaN(count) || count < 0) return;

      const clue = { word: msg.word.trim(), count, team: game.turn };
      game.clue = clue;
      game.clueHistory.push(clue);
      // Timer already running from turn start — no change
      broadcastRoom(currentRoom);
    }

    if (msg.type === 'vote-card') {
      if (!currentRoom) return;
      const game = currentRoom.game;
      if (game.paused || game.winner) return;
      if (!game.clue) return;

      const player = currentRoom.players.get(playerId);
      if (!player || player.role !== 'operative' || player.team !== game.turn) return;

      const index = msg.index;
      const card = game.cards[index];
      if (!card || card.revealed) return;

      // Toggle vote
      if (game.playerVotes[playerId] === index) {
        delete game.playerVotes[playerId];
      } else {
        game.playerVotes[playerId] = index;
      }

      checkVoteConsensus(currentRoom);
      broadcastRoom(currentRoom);
    }

    if (msg.type === 'end-turn') {
      if (!currentRoom) return;
      const game = currentRoom.game;
      if (game.paused || game.winner) return;
      const player = currentRoom.players.get(playerId);
      if (!player || player.team !== game.turn) return;
      clearVotes(currentRoom);
      nextTurn(currentRoom);
      broadcastRoom(currentRoom);
    }

    if (msg.type === 'new-game') {
      if (!currentRoom || playerId !== currentRoom.hostId) return;
      clearTimer(currentRoom);
      clearVotes(currentRoom);
      currentRoom.game = createGame(currentRoom.settings);
      broadcastRoom(currentRoom);
    }

    if (msg.type === 'shuffle-players') {
      if (!currentRoom || playerId !== currentRoom.hostId) return;
      clearTimer(currentRoom);
      clearVotes(currentRoom);
      currentRoom.game = createGame(currentRoom.settings);

      // Only shuffle players who are NOT spectators
      const allIds = [...currentRoom.players.entries()]
        .filter(([, p]) => p.team !== null)
        .map(([id]) => id);
      if (allIds.length === 0) { broadcastRoom(currentRoom); return; }
      const shuffled = shuffle(allIds);
      const teams = currentRoom.game.teams;
      let idx = 0;
      for (const teamId of teams) {
        if (idx < shuffled.length) {
          const p = currentRoom.players.get(shuffled[idx]);
          p.team = teamId;
          p.role = 'spymaster';
          idx++;
        }
      }
      let teamIdx = 0;
      while (idx < shuffled.length) {
        const p = currentRoom.players.get(shuffled[idx]);
        p.team = teams[teamIdx % teams.length];
        p.role = 'operative';
        idx++;
        teamIdx++;
      }
      broadcastRoom(currentRoom);
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      delete currentRoom.game.playerVotes[playerId];
      checkVoteConsensus(currentRoom);

      currentRoom.players.delete(playerId);
      if (currentRoom.players.size === 0) {
        clearTimer(currentRoom);
        cancelConfirmation(currentRoom);
        rooms.delete(currentRoom.code);
      } else {
        if (currentRoom.hostId === playerId) {
          currentRoom.hostId = currentRoom.players.keys().next().value;
        }
        broadcastRoom(currentRoom);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Codenames server running on port ${PORT}`);
});
