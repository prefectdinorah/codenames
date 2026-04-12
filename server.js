const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const codenamesWords = require('./words');
const aliasWords = require('./alias-words');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// /games or /games/ROOMCODE — serve the same SPA, client reads code from URL
app.get('/games', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/games/:code', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

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

// ============================================================
// CODENAMES GAME LOGIC
// ============================================================

function createCodenamesGame(settings) {
  const { teamCount, gridRows, gridCols } = settings;
  const totalCards = gridRows * gridCols;
  const selected = shuffle(codenamesWords).slice(0, totalCards);
  const teams = TEAM_IDS.slice(0, teamCount);
  const shuffledTeams = shuffle([...teams]);
  const firstTeam = shuffledTeams[0];

  const basePerTeam = Math.floor((totalCards - 1) / (teamCount + 1));
  const distribution = [];
  for (let i = 0; i < basePerTeam + 1; i++) distribution.push(shuffledTeams[0]);
  for (let ti = 1; ti < shuffledTeams.length; ti++) {
    const count = Math.max(1, basePerTeam - (ti - 1));
    for (let i = 0; i < count; i++) distribution.push(shuffledTeams[ti]);
  }
  distribution.push('assassin');
  while (distribution.length < totalCards) distribution.push('neutral');

  const types = shuffle(distribution);
  const cards = selected.map((word, i) => ({ word, type: types[i], revealed: false }));

  const totals = {};
  const scores = {};
  for (const t of teams) {
    totals[t] = types.filter((tp) => tp === t).length;
    scores[t] = 0;
  }

  return {
    cards, teams, turn: firstTeam, firstTeam,
    clue: null, winner: null, assassinLoser: false,
    scores, totals, clueHistory: [],
    paused: true, timerEnd: null, timerRemaining: null,
    playerVotes: {}, confirmingCard: null, confirmAt: null,
  };
}

// ============================================================
// ALIAS GAME LOGIC
// ============================================================

function createAliasGame(settings) {
  const teams = TEAM_IDS.slice(0, settings.teamCount || 2);
  const difficulty = settings.difficulty || 'normal';
  const pool = difficulty === 'hard'
    ? shuffle([...aliasWords.hard, ...aliasWords.normal])
    : shuffle([...aliasWords.normal]);

  const scores = {};
  for (const t of teams) scores[t] = 0;

  return {
    teams,
    scores,
    targetScore: settings.targetScore || 30,
    difficulty,
    currentTeamIndex: 0,
    explainerId: null,
    explainerHistory: {},  // teamId -> [playerId, ...]
    phase: 'waiting',      // waiting | explaining | review | finished
    currentWord: null,
    wordPool: pool,
    wordIndex: 0,
    turnWords: [],         // [{word, result: 'correct'|'skipped'}]
    turnScore: 0,
    paused: false,
    timerDuration: settings.timerDuration || 60,
    timerEnd: null,
    timerRemaining: null,
  };
}

function aliasNextWord(game) {
  if (game.wordIndex >= game.wordPool.length) {
    game.wordPool = shuffle(game.wordPool);
    game.wordIndex = 0;
  }
  game.currentWord = game.wordPool[game.wordIndex++];
}

function aliasGetExplainer(room) {
  const game = room.game;
  const teamId = game.teams[game.currentTeamIndex];
  const teamPlayers = [];
  for (const [id, p] of room.players) {
    if (p.team === teamId) teamPlayers.push(id);
  }
  if (teamPlayers.length === 0) return null;

  const history = game.explainerHistory[teamId] || [];
  // Pick the player who has explained the fewest times
  let minCount = Infinity;
  for (const id of teamPlayers) {
    const count = history.filter((h) => h === id).length;
    if (count < minCount) minCount = count;
  }
  const candidates = teamPlayers.filter((id) => {
    return history.filter((h) => h === id).length === minCount;
  });
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ============================================================
// SHARED: Room management
// ============================================================

function createRoom(hostId, gameMode) {
  const code = generateRoomCode();
  let settings, game;

  if (gameMode === 'alias') {
    settings = { teamCount: 2, timerDuration: 60, targetScore: 30, difficulty: 'normal' };
    game = createAliasGame(settings);
  } else {
    settings = { teamCount: 2, gridRows: 5, gridCols: 5, timerDuration: 0 };
    game = createCodenamesGame(settings);
  }

  const room = {
    code, hostId, gameMode: gameMode || 'codenames',
    players: new Map(), settings, game,
    timerTimeout: null, confirmTimeout: null,
  };
  rooms.set(code, room);
  return room;
}

// ============================================================
// SHARED: Timer utilities
// ============================================================

function clearTimer(room) {
  if (room.timerTimeout) { clearTimeout(room.timerTimeout); room.timerTimeout = null; }
  room.game.timerEnd = null;
  room.game.timerRemaining = null;
}

function startCodenamesTimer(room) {
  clearTimer(room);
  const duration = room.settings.timerDuration;
  if (!duration || duration <= 0) return;
  room.game.timerEnd = Date.now() + duration * 1000;
  room.game.timerRemaining = duration;
  room.timerTimeout = setTimeout(() => {
    if (room.game.winner || room.game.paused) return;
    clearVotes(room);
    codenamesNextTurn(room);
    broadcastRoom(room);
  }, duration * 1000);
}

function startAliasTimer(room) {
  clearTimer(room);
  const duration = room.game.timerDuration;
  if (!duration || duration <= 0) return;
  room.game.timerEnd = Date.now() + duration * 1000;
  room.game.timerRemaining = duration;
  room.timerTimeout = setTimeout(() => {
    if (room.game.paused) return;
    // Timer expired — go to review
    room.game.phase = 'review';
    room.game.currentWord = null;
    clearTimer(room);
    broadcastRoom(room);
  }, duration * 1000);
}

function pauseTimer(room) {
  if (!room.game.timerEnd) return;
  const remaining = Math.max(0, Math.ceil((room.game.timerEnd - Date.now()) / 1000));
  room.game.timerRemaining = remaining;
  room.game.timerEnd = null;
  if (room.timerTimeout) { clearTimeout(room.timerTimeout); room.timerTimeout = null; }
}

function resumeTimerFor(room) {
  const remaining = room.game.timerRemaining;
  if (!remaining || remaining <= 0) return;
  room.game.timerEnd = Date.now() + remaining * 1000;

  if (room.gameMode === 'alias') {
    room.timerTimeout = setTimeout(() => {
      if (room.game.paused) return;
      room.game.phase = 'review';
      room.game.currentWord = null;
      clearTimer(room);
      broadcastRoom(room);
    }, remaining * 1000);
  } else {
    room.timerTimeout = setTimeout(() => {
      if (room.game.winner || room.game.paused) return;
      clearVotes(room);
      codenamesNextTurn(room);
      broadcastRoom(room);
    }, remaining * 1000);
  }
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
        codenamesNextTurn(room);
        broadcastRoom(room);
      }, remaining);
    }
  }
}

// ============================================================
// CODENAMES: Turn & vote logic
// ============================================================

function codenamesNextTurn(room) {
  const game = room.game;
  const idx = game.teams.indexOf(game.turn);
  game.turn = game.teams[(idx + 1) % game.teams.length];
  game.clue = null;
  clearVotes(room);
  startCodenamesTimer(room);
}

function checkCodenamesWin(game) {
  for (const t of game.teams) {
    if (game.scores[t] >= game.totals[t]) { game.winner = t; return; }
  }
}

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
  if (room.confirmTimeout) { clearTimeout(room.confirmTimeout); room.confirmTimeout = null; }
  if (room.game.confirmingCard !== undefined) room.game.confirmingCard = null;
  if (room.game.confirmAt !== undefined) room.game.confirmAt = null;
}

function checkVoteConsensus(room) {
  const game = room.game;
  const operatives = getTeamOperatives(room, game.turn);
  if (operatives.length === 0) return;
  const votes = operatives.map((id) => game.playerVotes[id]).filter((v) => v !== undefined);
  if (votes.length === operatives.length && new Set(votes).size === 1) {
    const cardIndex = votes[0];
    if (game.confirmingCard !== cardIndex) startConfirmation(room, cardIndex);
  } else {
    if (game.confirmingCard !== null) cancelConfirmation(room);
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
    if (game.teams.length === 2) game.winner = game.teams.find((t) => t !== game.turn);
    else { game.winner = game.turn; game.assassinLoser = true; }
    clearTimer(room);
    return;
  }
  if (game.teams.includes(card.type)) game.scores[card.type]++;
  checkCodenamesWin(game);
  if (game.winner) { clearTimer(room); return; }
  if (card.type === game.turn) { addTime(room, 15); }
  else { codenamesNextTurn(room); }
}

// ============================================================
// STATE BROADCASTING
// ============================================================

function getCardVoteCounts(room) {
  const counts = {};
  for (const cardIndex of Object.values(room.game.playerVotes)) {
    counts[cardIndex] = (counts[cardIndex] || 0) + 1;
  }
  return counts;
}

function getCodenamesState(room, playerId) {
  const player = room.players.get(playerId);
  const isSpymaster = player && player.role === 'spymaster';
  const cards = room.game.cards.map((c) => ({
    word: c.word, revealed: c.revealed,
    type: c.revealed || isSpymaster || room.game.winner ? c.type : null,
  }));
  return {
    cards,
    gridRows: room.settings.gridRows,
    gridCols: room.settings.gridCols,
    turn: room.game.turn,
    clue: room.game.clue,
    winner: room.game.winner,
    assassinLoser: room.game.assassinLoser,
    totals: room.game.totals,
    clueHistory: room.game.clueHistory,
    cardVotes: getCardVoteCounts(room),
    operativeCount: getTeamOperatives(room, room.game.turn).length,
    confirmingCard: room.game.confirmingCard,
    confirmAt: room.game.confirmAt,
    yourVote: player ? (room.game.playerVotes[playerId] !== undefined ? room.game.playerVotes[playerId] : null) : null,
  };
}

function getAliasState(room, playerId) {
  const game = room.game;
  const isExplainer = playerId === game.explainerId;
  return {
    phase: game.phase,
    targetScore: game.targetScore,
    difficulty: game.difficulty,
    currentTeamIndex: game.currentTeamIndex,
    explainerId: game.explainerId,
    currentWord: isExplainer && game.phase === 'explaining' ? game.currentWord : null,
    turnWords: game.phase === 'review' || game.phase === 'finished' ? game.turnWords : null,
    turnScore: game.turnScore,
    turnWordCount: game.turnWords.length,
  };
}

function getPlayerState(room, playerId) {
  const player = room.players.get(playerId);
  const players = [];
  for (const [id, p] of room.players) {
    players.push({ id, name: p.name, team: p.team, role: p.role });
  }

  const base = {
    type: 'state',
    gameMode: room.gameMode,
    roomCode: room.code,
    teams: room.game.teams,
    teamInfo: TEAM_INFO,
    scores: room.game.scores,
    paused: room.game.paused,
    timerEnd: room.game.timerEnd,
    timerRemaining: room.game.timerRemaining,
    players,
    you: player ? { id: playerId, name: player.name, team: player.team, role: player.role } : null,
    hostId: room.hostId,
    settings: room.settings,
  };

  if (room.gameMode === 'alias') {
    Object.assign(base, getAliasState(room, playerId));
  } else {
    Object.assign(base, getCodenamesState(room, playerId));
  }
  return base;
}

function broadcastRoom(room) {
  for (const [id, player] of room.players) {
    if (player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(getPlayerState(room, id)));
    }
  }
}

// ============================================================
// WEBSOCKET HANDLING
// ============================================================

let nextPlayerId = 1;

wss.on('connection', (ws) => {
  const playerId = String(nextPlayerId++);
  let currentRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // --- Shared messages ---

    if (msg.type === 'create-room') {
      const room = createRoom(playerId, msg.gameMode || 'codenames');
      currentRoom = room;
      room.players.set(playerId, { ws, name: msg.name || 'Игрок', team: null, role: null });
      ws.send(JSON.stringify(getPlayerState(room, playerId)));
    }

    if (msg.type === 'join-room') {
      const code = (msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' })); return; }
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
      if (currentRoom.game.paused && !goingSpectator && currentRoom.gameMode !== 'alias') return;

      const team = msg.team || null;
      const role = msg.role || null;
      if (team && !currentRoom.game.teams.includes(team)) return;
      if (currentRoom.gameMode === 'codenames') {
        if (role && role !== 'spymaster' && role !== 'operative') return;
        if (team && role === 'spymaster') {
          for (const [id, p] of currentRoom.players) {
            if (id !== playerId && p.team === team && p.role === 'spymaster') return;
          }
        }
        delete currentRoom.game.playerVotes[playerId];
        checkVoteConsensus(currentRoom);
        player.role = team ? (role || 'operative') : null;
      } else {
        player.role = team ? 'player' : null;
      }
      player.team = team;
      broadcastRoom(currentRoom);
    }

    if (msg.type === 'toggle-pause') {
      if (!currentRoom) return;
      if (playerId !== currentRoom.hostId) return;
      const game = currentRoom.game;
      game.paused = !game.paused;
      if (game.paused) { pauseTimer(currentRoom); }
      else { resumeTimerFor(currentRoom); }
      broadcastRoom(currentRoom);
    }

    // --- Codenames-specific ---

    if (currentRoom && currentRoom.gameMode === 'codenames') {
      handleCodenamesMsg(currentRoom, playerId, msg);
    }

    // --- Alias-specific ---

    if (currentRoom && currentRoom.gameMode === 'alias') {
      handleAliasMsg(currentRoom, playerId, msg);
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      if (currentRoom.gameMode === 'codenames' && currentRoom.game.playerVotes) {
        delete currentRoom.game.playerVotes[playerId];
        checkVoteConsensus(currentRoom);
      }
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

// ============================================================
// CODENAMES MESSAGE HANDLER
// ============================================================

function handleCodenamesMsg(room, playerId, msg) {
  if (msg.type === 'update-settings') {
    if (playerId !== room.hostId) return;
    const teamCount = Math.max(2, Math.min(5, parseInt(msg.teamCount, 10) || 2));
    const gridRows = Math.max(4, Math.min(8, parseInt(msg.gridRows, 10) || 5));
    const gridCols = Math.max(4, Math.min(8, parseInt(msg.gridCols, 10) || 5));
    const timerDuration = Math.max(0, Math.min(300, parseInt(msg.timerDuration, 10) || 0));
    room.settings = { teamCount, gridRows, gridCols, timerDuration };
    clearTimer(room); clearVotes(room);
    room.game = createCodenamesGame(room.settings);
    const validTeams = TEAM_IDS.slice(0, teamCount);
    for (const [, p] of room.players) {
      if (p.team && !validTeams.includes(p.team)) { p.team = null; p.role = null; }
    }
    broadcastRoom(room);
  }

  if (msg.type === 'give-clue') {
    const game = room.game;
    if (game.paused || game.winner) return;
    const player = room.players.get(playerId);
    if (!player || player.role !== 'spymaster' || player.team !== game.turn) return;
    const count = parseInt(msg.count, 10);
    if (!msg.word || isNaN(count) || count < 0) return;
    const clue = { word: msg.word.trim(), count, team: game.turn };
    game.clue = clue;
    game.clueHistory.push(clue);
    broadcastRoom(room);
  }

  if (msg.type === 'vote-card') {
    const game = room.game;
    if (game.paused || game.winner || !game.clue) return;
    const player = room.players.get(playerId);
    if (!player || player.role !== 'operative' || player.team !== game.turn) return;
    const card = game.cards[msg.index];
    if (!card || card.revealed) return;
    if (game.playerVotes[playerId] === msg.index) delete game.playerVotes[playerId];
    else game.playerVotes[playerId] = msg.index;
    checkVoteConsensus(room);
    broadcastRoom(room);
  }

  if (msg.type === 'end-turn') {
    const game = room.game;
    if (game.paused || game.winner) return;
    const player = room.players.get(playerId);
    if (!player || player.team !== game.turn) return;
    clearVotes(room);
    codenamesNextTurn(room);
    broadcastRoom(room);
  }

  if (msg.type === 'new-game') {
    if (playerId !== room.hostId) return;
    clearTimer(room); clearVotes(room);
    room.game = createCodenamesGame(room.settings);
    broadcastRoom(room);
  }

  if (msg.type === 'shuffle-players') {
    if (playerId !== room.hostId) return;
    clearTimer(room); clearVotes(room);
    room.game = createCodenamesGame(room.settings);
    const allIds = [...room.players.entries()].filter(([, p]) => p.team !== null).map(([id]) => id);
    if (allIds.length === 0) { broadcastRoom(room); return; }
    const shuffled = shuffle(allIds);
    const teams = room.game.teams;
    let idx = 0;
    for (const teamId of teams) {
      if (idx < shuffled.length) {
        const p = room.players.get(shuffled[idx]); p.team = teamId; p.role = 'spymaster'; idx++;
      }
    }
    let teamIdx = 0;
    while (idx < shuffled.length) {
      const p = room.players.get(shuffled[idx]);
      p.team = teams[teamIdx % teams.length]; p.role = 'operative'; idx++; teamIdx++;
    }
    broadcastRoom(room);
  }
}

// ============================================================
// ALIAS MESSAGE HANDLER
// ============================================================

function handleAliasMsg(room, playerId, msg) {
  const game = room.game;

  if (msg.type === 'update-settings') {
    if (playerId !== room.hostId) return;
    const teamCount = Math.max(2, Math.min(5, parseInt(msg.teamCount, 10) || 2));
    const timerDuration = Math.max(10, Math.min(300, parseInt(msg.timerDuration, 10) || 60));
    const targetScore = Math.max(5, Math.min(100, parseInt(msg.targetScore, 10) || 30));
    const difficulty = msg.difficulty === 'hard' ? 'hard' : 'normal';
    room.settings = { teamCount, timerDuration, targetScore, difficulty };
    clearTimer(room);
    room.game = createAliasGame(room.settings);
    const validTeams = TEAM_IDS.slice(0, teamCount);
    for (const [, p] of room.players) {
      if (p.team && !validTeams.includes(p.team)) { p.team = null; p.role = null; }
    }
    broadcastRoom(room);
  }

  if (msg.type === 'start-turn') {
    if (game.phase !== 'waiting' || game.paused) return;
    const explainerId = aliasGetExplainer(room);
    if (!explainerId) return;
    const teamId = game.teams[game.currentTeamIndex];
    if (!game.explainerHistory[teamId]) game.explainerHistory[teamId] = [];
    game.explainerHistory[teamId].push(explainerId);
    game.explainerId = explainerId;
    game.phase = 'explaining';
    game.turnWords = [];
    game.turnScore = 0;
    aliasNextWord(game);
    startAliasTimer(room);
    broadcastRoom(room);
  }

  if (msg.type === 'word-correct') {
    if (game.phase !== 'explaining' || playerId !== game.explainerId) return;
    game.turnWords.push({ word: game.currentWord, result: 'correct' });
    game.turnScore++;
    aliasNextWord(game);
    broadcastRoom(room);
  }

  if (msg.type === 'word-skip') {
    if (game.phase !== 'explaining' || playerId !== game.explainerId) return;
    game.turnWords.push({ word: game.currentWord, result: 'skipped' });
    game.turnScore--;
    aliasNextWord(game);
    broadcastRoom(room);
  }

  if (msg.type === 'toggle-word-result') {
    if (game.phase !== 'review') return;
    if (playerId !== room.hostId && playerId !== game.explainerId) return;
    const idx = parseInt(msg.index, 10);
    if (isNaN(idx) || idx < 0 || idx >= game.turnWords.length) return;
    const w = game.turnWords[idx];
    if (w.result === 'correct') { w.result = 'skipped'; game.turnScore -= 2; }
    else { w.result = 'correct'; game.turnScore += 2; }
    broadcastRoom(room);
  }

  if (msg.type === 'confirm-turn') {
    if (game.phase !== 'review') return;
    if (playerId !== room.hostId && playerId !== game.explainerId) return;
    const teamId = game.teams[game.currentTeamIndex];
    game.scores[teamId] = Math.max(0, game.scores[teamId] + game.turnScore);

    if (game.scores[teamId] >= game.targetScore) {
      game.phase = 'finished';
      game.winner = teamId;
      broadcastRoom(room);
      return;
    }

    game.currentTeamIndex = (game.currentTeamIndex + 1) % game.teams.length;
    game.phase = 'waiting';
    game.explainerId = null;
    game.currentWord = null;
    game.turnWords = [];
    game.turnScore = 0;
    broadcastRoom(room);
  }

  if (msg.type === 'new-game') {
    if (playerId !== room.hostId) return;
    clearTimer(room);
    room.game = createAliasGame(room.settings);
    broadcastRoom(room);
  }

  if (msg.type === 'shuffle-players') {
    if (playerId !== room.hostId) return;
    clearTimer(room);
    room.game = createAliasGame(room.settings);
    const allIds = [...room.players.entries()].filter(([, p]) => p.team !== null).map(([id]) => id);
    if (allIds.length === 0) { broadcastRoom(room); return; }
    const shuffled = shuffle(allIds);
    const teams = room.game.teams;
    let idx = 0, teamIdx = 0;
    while (idx < shuffled.length) {
      const p = room.players.get(shuffled[idx]);
      p.team = teams[teamIdx % teams.length]; p.role = 'player'; idx++; teamIdx++;
    }
    broadcastRoom(room);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});
