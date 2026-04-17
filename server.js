const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const codenamesWords = require('./words');
const aliasWords = require('./alias-words');
const spyfallLocations = require('./spyfall-locations');
const crocodileWords = require('./crocodile-words');

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
    turnWords: [],
    turnScore: 0,
    skipPenalty: settings.skipPenalty !== false,
    finalRound: false,
    finalRoundStarter: null,
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
  const lastExplainer = history.length > 0 ? history[history.length - 1] : null;

  // Pick the player who has explained the fewest times, excluding last explainer if possible
  let minCount = Infinity;
  for (const id of teamPlayers) {
    const count = history.filter((h) => h === id).length;
    if (count < minCount) minCount = count;
  }
  let candidates = teamPlayers.filter((id) => {
    return history.filter((h) => h === id).length === minCount;
  });
  // Avoid picking the same person twice in a row (if more than 1 player)
  if (candidates.length > 1 && lastExplainer) {
    candidates = candidates.filter((id) => id !== lastExplainer);
  }
  if (candidates.length === 0) candidates = teamPlayers;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ============================================================
// ============================================================
// SPYFALL GAME LOGIC
// ============================================================

function createSpyfallGame(settings) {
  return {
    phase: 'lobby',
    location: null,
    assignments: {},
    spyId: null,
    roundDuration: settings.roundDuration || 480,
    timerEnd: null,
    timerRemaining: null,
    paused: true,
    accusation: null,
    winner: null,
    winReason: null,
    allLocations: shuffle(spyfallLocations.map((l) => l.name)),
    turnOrder: [],
    turnIndex: 0,
    currentAsker: null,
    teams: [],
    scores: {},
  };
}

function startSpyfallRound(room) {
  const game = room.game;
  const playerIds = [];
  for (const [id, p] of room.players) {
    if (p.team === 'player') playerIds.push(id);
  }
  if (playerIds.length < 3) return false;

  const location = spyfallLocations[Math.floor(Math.random() * spyfallLocations.length)];
  const shuffledPlayers = shuffle(playerIds);
  const spyId = shuffledPlayers[0];
  const roles = shuffle([...location.roles]);

  const assignments = {};
  assignments[spyId] = { role: null, isSpy: true };
  for (let i = 1; i < shuffledPlayers.length; i++) {
    assignments[shuffledPlayers[i]] = {
      role: roles[(i - 1) % roles.length],
      isSpy: false,
    };
  }

  game.location = location;
  game.assignments = assignments;
  game.spyId = spyId;
  game.phase = 'playing';
  game.winner = null;
  game.winReason = null;
  game.accusation = null;
  game.turnOrder = shuffle(playerIds);
  game.turnIndex = 0;
  game.currentAsker = game.turnOrder[0];
  game.allLocations = shuffle(spyfallLocations.map((l) => l.name));

  startSpyfallTimer(room);
  return true;
}

function startSpyfallTimer(room) {
  clearTimer(room);
  const duration = room.game.roundDuration;
  room.game.timerEnd = Date.now() + duration * 1000;
  room.game.timerRemaining = duration;
  room.timerTimeout = setTimeout(() => {
    if (room.game.paused || room.game.phase !== 'playing') return;
    room.game.phase = 'finished';
    room.game.winner = 'players';
    room.game.winReason = 'timer';
    clearTimer(room);
    broadcastRoom(room);
  }, duration * 1000);
}

// ============================================================
// ============================================================
// WHOAMI GAME LOGIC
// ============================================================

function createWhoamiGame(settings) {
  return {
    teams: [],
    scores: {},
    phase: 'setup',      // setup | playing | finished
    mode: settings.mode || 'free',  // 'free' | 'turns'
    turnDuration: settings.turnDuration || 120,
    assignments: {},     // playerId -> { word: string|null, assignedBy: string|null }
    notebooks: {},       // playerId -> string (private notes)
    turnOrder: [],
    turnIndex: 0,
    currentTurnPlayer: null,
    timerEnd: null,
    timerRemaining: null,
    paused: false,
    winner: null,
    finishedPlayers: [],  // playerIds who guessed correctly
  };
}

// ============================================================
// CROCODILE GAME LOGIC
// ============================================================

function createCrocodileGame(settings) {
  const teams = TEAM_IDS.slice(0, settings.teamCount || 2);
  const difficulty = settings.difficulty || 'normal';
  const pool = difficulty === 'hard'
    ? shuffle([...crocodileWords.hard])
    : shuffle([...crocodileWords.normal]);

  const scores = {};
  for (const t of teams) scores[t] = 0;

  return {
    teams, scores,
    targetScore: settings.targetScore || 15,
    difficulty,
    currentTeamIndex: 0,
    drawerId: null,
    drawerHistory: {},
    phase: 'waiting',
    currentWord: null,
    wordPool: pool,
    wordIndex: 0,
    paused: false,
    timerDuration: settings.timerDuration || 90,
    timerEnd: null,
    timerRemaining: null,
    guessLog: [],
  };
}

function crocodileNextWord(game) {
  if (game.wordIndex >= game.wordPool.length) {
    game.wordPool = shuffle(game.wordPool);
    game.wordIndex = 0;
  }
  game.currentWord = game.wordPool[game.wordIndex++];
}

function crocodileGetDrawer(room) {
  const game = room.game;
  const teamId = game.teams[game.currentTeamIndex];
  const teamPlayers = [];
  for (const [id, p] of room.players) {
    if (p.team === teamId) teamPlayers.push(id);
  }
  if (teamPlayers.length === 0) return null;
  const history = game.drawerHistory[teamId] || [];
  let minCount = Infinity;
  for (const id of teamPlayers) {
    const count = history.filter((h) => h === id).length;
    if (count < minCount) minCount = count;
  }
  const candidates = teamPlayers.filter((id) => history.filter((h) => h === id).length === minCount);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function startCrocodileTimer(room) {
  clearTimer(room);
  const duration = room.game.timerDuration;
  if (!duration || duration <= 0) return;
  room.game.timerEnd = Date.now() + duration * 1000;
  room.game.timerRemaining = duration;
  room.timerTimeout = setTimeout(() => {
    if (room.game.paused || room.game.phase !== 'drawing') return;
    crocodileEndTurn(room, false);
    broadcastRoom(room);
  }, duration * 1000);
}

function crocodileEndTurn(room, guessed) {
  const game = room.game;
  clearTimer(room);

  if (guessed) {
    const teamId = game.teams[game.currentTeamIndex];
    game.scores[teamId]++;
    if (game.scores[teamId] >= game.targetScore) {
      game.phase = 'finished';
      game.winner = teamId;
      return;
    }
  }

  game.currentTeamIndex = (game.currentTeamIndex + 1) % game.teams.length;
  game.phase = 'waiting';
  game.drawerId = null;
  game.currentWord = null;
  game.guessLog = [];
}

function normalizeGuess(text) {
  return text.trim().toLowerCase().replace(/ё/g, 'е');
}

// ============================================================
// SHARED: Room management
// ============================================================

function createRoom(hostId, gameMode) {
  const code = generateRoomCode();
  let settings, game;

  if (gameMode === 'alias') {
    settings = { teamCount: 2, timerDuration: 60, targetScore: 30, difficulty: 'normal', skipPenalty: true };
    game = createAliasGame(settings);
  } else if (gameMode === 'spyfall') {
    settings = { roundDuration: 480 };
    game = createSpyfallGame(settings);
  } else if (gameMode === 'crocodile') {
    settings = { teamCount: 2, timerDuration: 90, targetScore: 15, difficulty: 'normal' };
    game = createCrocodileGame(settings);
  } else if (gameMode === 'whoami') {
    settings = { mode: 'free', turnDuration: 120 };
    game = createWhoamiGame(settings);
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

  if (room.gameMode === 'spyfall') {
    room.timerTimeout = setTimeout(() => {
      if (room.game.paused || room.game.phase !== 'playing') return;
      room.game.phase = 'finished';
      room.game.winner = 'players';
      room.game.winReason = 'timer';
      clearTimer(room);
      broadcastRoom(room);
    }, remaining * 1000);
  } else if (room.gameMode === 'crocodile') {
    room.timerTimeout = setTimeout(() => {
      if (room.game.paused || room.game.phase !== 'drawing') return;
      crocodileEndTurn(room, false);
      broadcastRoom(room);
    }, remaining * 1000);
  } else if (room.gameMode === 'whoami') {
    room.timerTimeout = setTimeout(() => {
      if (room.game.paused || room.game.phase !== 'playing') return;
      whoamiNextTurn(room);
      broadcastRoom(room);
    }, remaining * 1000);
  } else if (room.gameMode === 'alias') {
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

function getWhoamiState(room, playerId) {
  const game = room.game;
  // Build assignments visible to this player:
  // - You can see everyone's word EXCEPT your own
  // - You can see your own only if game is finished or you guessed
  const visibleAssignments = {};
  for (const [id, a] of Object.entries(game.assignments)) {
    if (id === playerId) {
      visibleAssignments[id] = {
        word: game.phase === 'finished' || game.finishedPlayers.includes(playerId) ? a.word : null,
        hasWord: !!a.word,
      };
    } else {
      visibleAssignments[id] = { word: a.word, hasWord: !!a.word };
    }
  }

  return {
    wmPhase: game.phase,
    wmMode: game.mode,
    turnDuration: game.turnDuration,
    assignments: visibleAssignments,
    notebook: game.notebooks[playerId] || '',
    turnOrder: game.turnOrder,
    currentTurnPlayer: game.currentTurnPlayer,
    winner: game.winner,
    finishedPlayers: game.finishedPlayers,
    allReady: Object.values(game.assignments).every((a) => !!a.word),
  };
}

function getCrocodileState(room, playerId) {
  const game = room.game;
  const isDrawer = playerId === game.drawerId;
  return {
    crocPhase: game.phase,
    targetScore: game.targetScore,
    difficulty: game.difficulty,
    currentTeamIndex: game.currentTeamIndex,
    drawerId: game.drawerId,
    currentWord: isDrawer ? game.currentWord : null,
    guessLog: game.guessLog,
    winner: game.winner,
  };
}

function getSpyfallState(room, playerId) {
  const game = room.game;
  const myAssignment = game.assignments[playerId] || null;
  const isFinished = game.phase === 'finished';

  return {
    sfPhase: game.phase,
    roundDuration: game.roundDuration,
    yourRole: myAssignment ? myAssignment.role : null,
    yourIsSpy: myAssignment ? myAssignment.isSpy : false,
    location: (myAssignment && !myAssignment.isSpy) || isFinished ? game.location?.name : null,
    allAssignments: isFinished ? game.assignments : null,
    spyId: isFinished ? game.spyId : null,
    accusation: game.accusation ? {
      accuserId: game.accusation.accuserId,
      accusedId: game.accusation.accusedId,
      votes: game.accusation.votes,
      totalPlayers: game.turnOrder.length,
    } : null,
    currentAsker: game.currentAsker,
    turnOrder: game.turnOrder,
    allLocations: game.allLocations,
    winner: game.winner,
    winReason: game.winReason,
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
    turnWords: game.turnWords,
    turnScore: game.turnScore,
    skipPenalty: game.skipPenalty,
    finalRound: game.finalRound,
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
  } else if (room.gameMode === 'spyfall') {
    Object.assign(base, getSpyfallState(room, playerId));
  } else if (room.gameMode === 'crocodile') {
    Object.assign(base, getCrocodileState(room, playerId));
  } else if (room.gameMode === 'whoami') {
    Object.assign(base, getWhoamiState(room, playerId));
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
      if (currentRoom.game.paused && !goingSpectator && currentRoom.gameMode === 'codenames') return;

      const team = msg.team || null;

      // Whoami: register/unregister player in assignments
      if (currentRoom.gameMode === 'whoami') {
        const game = currentRoom.game;
        if (team === 'player' && !game.assignments[playerId]) {
          game.assignments[playerId] = { word: null, assignedBy: null };
          game.notebooks[playerId] = '';
        } else if (!team && game.assignments[playerId]) {
          delete game.assignments[playerId];
          delete game.notebooks[playerId];
        }
      }
      const role = msg.role || null;
      if (currentRoom.gameMode === 'spyfall' || currentRoom.gameMode === 'whoami') {
        if (team && team !== 'player') return;
      } else {
        if (team && !currentRoom.game.teams.includes(team)) return;
      }
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
      if (game.paused) {
        pauseTimer(currentRoom);
      } else {
        if (game.timerRemaining > 0) {
          resumeTimerFor(currentRoom);
        } else if (currentRoom.gameMode === 'codenames' && currentRoom.settings.timerDuration > 0) {
          startCodenamesTimer(currentRoom);
        }
      }
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

    if (currentRoom && currentRoom.gameMode === 'spyfall') {
      handleSpyfallMsg(currentRoom, playerId, msg);
    }

    if (currentRoom && currentRoom.gameMode === 'crocodile') {
      handleCrocodileMsg(currentRoom, playerId, msg, ws);
    }

    if (currentRoom && currentRoom.gameMode === 'whoami') {
      handleWhoamiMsg(currentRoom, playerId, msg);
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
    const skipPenalty = msg.skipPenalty !== 'false' && msg.skipPenalty !== false;
    room.settings = { teamCount, timerDuration, targetScore, difficulty, skipPenalty };
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
    if (game.skipPenalty) game.turnScore--;
    aliasNextWord(game);
    broadcastRoom(room);
  }

  if (msg.type === 'toggle-word-result') {
    if (game.phase !== 'review') return;
    if (playerId !== room.hostId && playerId !== game.explainerId) return;
    const idx = parseInt(msg.index, 10);
    if (isNaN(idx) || idx < 0 || idx >= game.turnWords.length) return;
    const w = game.turnWords[idx];
    const penalty = game.skipPenalty ? 1 : 0;
    if (w.result === 'correct') { w.result = 'skipped'; game.turnScore -= (1 + penalty); }
    else { w.result = 'correct'; game.turnScore += (1 + penalty); }
    broadcastRoom(room);
  }

  if (msg.type === 'confirm-turn') {
    if (game.phase !== 'review') return;
    if (playerId !== room.hostId && playerId !== game.explainerId) return;
    const teamId = game.teams[game.currentTeamIndex];
    game.scores[teamId] = Math.max(0, game.scores[teamId] + game.turnScore);

    const reachedTarget = game.scores[teamId] >= game.targetScore;

    if (reachedTarget && !game.finalRound) {
      // First team to reach target — start final round for remaining teams
      game.finalRound = true;
      game.finalRoundStarter = game.currentTeamIndex;
    }

    // Move to next team
    const nextIndex = (game.currentTeamIndex + 1) % game.teams.length;

    if (game.finalRound) {
      // Check if we've gone full circle back to the team that started final round
      if (nextIndex === game.finalRoundStarter) {
        // All teams had their chance — determine winner
        let maxScore = -1;
        let winner = null;
        for (const t of game.teams) {
          if (game.scores[t] > maxScore) { maxScore = game.scores[t]; winner = t; }
        }
        game.phase = 'finished';
        game.winner = winner;
        broadcastRoom(room);
        return;
      }
    }

    game.currentTeamIndex = nextIndex;
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

// ============================================================
// SPYFALL MESSAGE HANDLER
// ============================================================

function handleSpyfallMsg(room, playerId, msg) {
  const game = room.game;

  if (msg.type === 'update-settings') {
    if (playerId !== room.hostId) return;
    const roundDuration = Math.max(60, Math.min(900, parseInt(msg.roundDuration, 10) || 480));
    room.settings = { roundDuration };
    clearTimer(room);
    room.game = createSpyfallGame(room.settings);
    broadcastRoom(room);
  }

  if (msg.type === 'start-game') {
    if (playerId !== room.hostId) return;
    if (game.phase !== 'lobby') return;
    if (!startSpyfallRound(room)) return;
    broadcastRoom(room);
  }

  if (msg.type === 'next-turn') {
    if (game.phase !== 'playing') return;
    if (playerId !== game.currentAsker) return;
    game.turnIndex = (game.turnIndex + 1) % game.turnOrder.length;
    game.currentAsker = game.turnOrder[game.turnIndex];
    broadcastRoom(room);
  }

  if (msg.type === 'accuse') {
    if (game.phase !== 'playing') return;
    const accusedId = msg.accusedId;
    if (!game.assignments[accusedId]) return;
    if (accusedId === playerId) return;
    pauseTimer(room);
    game.phase = 'voting';
    game.accusation = { accuserId: playerId, accusedId, votes: {} };
    broadcastRoom(room);
  }

  if (msg.type === 'vote-accuse') {
    if (game.phase !== 'voting' || !game.accusation) return;
    if (!game.assignments[playerId]) return;
    game.accusation.votes[playerId] = !!msg.vote;

    // Check if all players voted
    const voters = game.turnOrder.filter((id) => room.players.has(id));
    const voteCount = Object.keys(game.accusation.votes).length;
    if (voteCount >= voters.length) {
      const yesVotes = Object.values(game.accusation.votes).filter((v) => v).length;
      if (yesVotes > voters.length / 2) {
        // Majority voted yes
        game.phase = 'finished';
        if (game.accusation.accusedId === game.spyId) {
          game.winner = 'players';
          game.winReason = 'voted';
        } else {
          game.winner = 'spy';
          game.winReason = 'wrongAccusation';
        }
        clearTimer(room);
      } else {
        // Not enough votes — back to playing
        game.phase = 'playing';
        game.accusation = null;
        resumeTimerFor(room);
      }
    }
    broadcastRoom(room);
  }

  if (msg.type === 'cancel-accusation') {
    if (game.phase !== 'voting' || !game.accusation) return;
    if (playerId !== game.accusation.accuserId && playerId !== room.hostId) return;
    game.phase = 'playing';
    game.accusation = null;
    resumeTimerFor(room);
    broadcastRoom(room);
  }

  if (msg.type === 'spy-guess') {
    if (game.phase !== 'playing') return;
    if (playerId !== game.spyId) return;
    const locationName = msg.locationName;
    game.phase = 'finished';
    if (locationName === game.location.name) {
      game.winner = 'spy';
      game.winReason = 'guessed';
    } else {
      game.winner = 'players';
      game.winReason = 'wrongGuess';
    }
    clearTimer(room);
    broadcastRoom(room);
  }

  if (msg.type === 'new-game') {
    if (playerId !== room.hostId) return;
    clearTimer(room);
    room.game = createSpyfallGame(room.settings);
    // Keep player assignments (team: 'player')
    broadcastRoom(room);
  }
}

// ============================================================
// CROCODILE MESSAGE HANDLER
// ============================================================

function handleCrocodileMsg(room, playerId, msg, ws) {
  const game = room.game;

  // Drawing relay — NOT through broadcastRoom, direct relay
  if (msg.type === 'croc-draw') {
    if (playerId !== game.drawerId || game.phase !== 'drawing') return;
    const data = JSON.stringify({ type: 'croc-draw', points: msg.points, color: msg.color, size: msg.size, tool: msg.tool });
    for (const [id, p] of room.players) {
      if (id !== playerId && p.ws.readyState === 1) p.ws.send(data);
    }
    return;
  }

  if (msg.type === 'croc-clear') {
    if (playerId !== game.drawerId || game.phase !== 'drawing') return;
    const data = JSON.stringify({ type: 'croc-clear' });
    for (const [id, p] of room.players) {
      if (id !== playerId && p.ws.readyState === 1) p.ws.send(data);
    }
    return;
  }

  if (msg.type === 'update-settings') {
    if (playerId !== room.hostId) return;
    const teamCount = Math.max(2, Math.min(5, parseInt(msg.teamCount, 10) || 2));
    const timerDuration = Math.max(30, Math.min(300, parseInt(msg.timerDuration, 10) || 90));
    const targetScore = Math.max(5, Math.min(50, parseInt(msg.targetScore, 10) || 15));
    const difficulty = msg.difficulty === 'hard' ? 'hard' : 'normal';
    room.settings = { teamCount, timerDuration, targetScore, difficulty };
    clearTimer(room);
    room.game = createCrocodileGame(room.settings);
    const validTeams = TEAM_IDS.slice(0, teamCount);
    for (const [, p] of room.players) {
      if (p.team && !validTeams.includes(p.team)) { p.team = null; p.role = null; }
    }
    broadcastRoom(room);
  }

  if (msg.type === 'start-turn') {
    if (game.phase !== 'waiting' || game.paused) return;
    const drawerId = crocodileGetDrawer(room);
    if (!drawerId) return;
    const teamId = game.teams[game.currentTeamIndex];
    if (!game.drawerHistory[teamId]) game.drawerHistory[teamId] = [];
    game.drawerHistory[teamId].push(drawerId);
    game.drawerId = drawerId;
    game.phase = 'drawing';
    game.guessLog = [];
    crocodileNextWord(game);
    startCrocodileTimer(room);
    broadcastRoom(room);
  }

  if (msg.type === 'croc-guess') {
    if (game.phase !== 'drawing') return;
    if (playerId === game.drawerId) return;
    const player = room.players.get(playerId);
    if (!player) return;
    // Only teammates can guess
    const teamId = game.teams[game.currentTeamIndex];
    if (player.team !== teamId) return;

    const text = (msg.text || '').trim();
    if (!text || text.length > 50) return;

    const isCorrect = normalizeGuess(text) === normalizeGuess(game.currentWord);
    game.guessLog.push({ playerId, playerName: player.name, text, correct: isCorrect });

    if (isCorrect) {
      crocodileEndTurn(room, true);
    }

    broadcastRoom(room);
  }

  if (msg.type === 'croc-skip') {
    if (game.phase !== 'drawing' || playerId !== game.drawerId) return;
    const teamId = game.teams[game.currentTeamIndex];
    game.scores[teamId] = Math.max(0, game.scores[teamId] - 1);
    crocodileNextWord(game);
    game.guessLog = [];
    // Clear canvas for all
    const data = JSON.stringify({ type: 'croc-clear' });
    for (const [, p] of room.players) {
      if (p.ws.readyState === 1) p.ws.send(data);
    }
    broadcastRoom(room);
  }

  if (msg.type === 'new-game') {
    if (playerId !== room.hostId) return;
    clearTimer(room);
    room.game = createCrocodileGame(room.settings);
    broadcastRoom(room);
  }

  if (msg.type === 'shuffle-players') {
    if (playerId !== room.hostId) return;
    clearTimer(room);
    room.game = createCrocodileGame(room.settings);
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

// ============================================================
// WHOAMI MESSAGE HANDLER
// ============================================================

function whoamiStartTurnTimer(room) {
  clearTimer(room);
  const duration = room.game.turnDuration;
  if (!duration || duration <= 0) return;
  room.game.timerEnd = Date.now() + duration * 1000;
  room.game.timerRemaining = duration;
  room.timerTimeout = setTimeout(() => {
    if (room.game.paused || room.game.phase !== 'playing') return;
    whoamiNextTurn(room);
    broadcastRoom(room);
  }, duration * 1000);
}

function whoamiNextTurn(room) {
  const game = room.game;
  if (game.mode !== 'turns') return;
  // Find next player who hasn't finished
  const activePlayers = game.turnOrder.filter((id) => !game.finishedPlayers.includes(id) && room.players.has(id));
  if (activePlayers.length === 0) { game.phase = 'finished'; clearTimer(room); return; }

  game.turnIndex = (game.turnIndex + 1) % activePlayers.length;
  game.currentTurnPlayer = activePlayers[game.turnIndex % activePlayers.length];
  whoamiStartTurnTimer(room);
}

function handleWhoamiMsg(room, playerId, msg) {
  const game = room.game;

  if (msg.type === 'update-settings') {
    if (playerId !== room.hostId) return;
    const mode = msg.mode === 'turns' ? 'turns' : 'free';
    const turnDuration = Math.max(30, Math.min(600, parseInt(msg.turnDuration, 10) || 120));
    room.settings = { mode, turnDuration };
    clearTimer(room);
    room.game = createWhoamiGame(room.settings);
    // Re-register existing players
    for (const [id, p] of room.players) {
      if (p.team === 'player') {
        room.game.assignments[id] = { word: null, assignedBy: null };
        room.game.notebooks[id] = '';
      }
    }
    broadcastRoom(room);
  }

  // Assign a word to another player (anyone can do this)
  if (msg.type === 'assign-word') {
    if (game.phase !== 'setup') return;
    const targetId = msg.targetId;
    const word = (msg.word || '').trim().slice(0, 40);
    if (!word || targetId === playerId) return;
    if (!game.assignments[targetId]) return;
    game.assignments[targetId] = { word, assignedBy: playerId };
    broadcastRoom(room);
  }

  // Start game (host only, all players must have words)
  if (msg.type === 'start-game') {
    if (playerId !== room.hostId) return;
    if (game.phase !== 'setup') return;
    const playerIds = Object.keys(game.assignments);
    if (playerIds.length < 2) return;
    if (!playerIds.every((id) => game.assignments[id].word)) return;

    game.phase = 'playing';
    game.turnOrder = shuffle(playerIds);
    game.turnIndex = 0;

    if (game.mode === 'turns') {
      game.currentTurnPlayer = game.turnOrder[0];
      whoamiStartTurnTimer(room);
    }
    broadcastRoom(room);
  }

  // Save notebook (private)
  if (msg.type === 'save-notebook') {
    if (!game.assignments[playerId]) return;
    game.notebooks[playerId] = (msg.text || '').slice(0, 2000);
    // Don't broadcast — only affects this player's state
    const player = room.players.get(playerId);
    if (player && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(getPlayerState(room, playerId)));
    }
  }

  // Guess your word (turns mode)
  if (msg.type === 'guess-word') {
    if (game.phase !== 'playing' || game.mode !== 'turns') return;
    if (game.finishedPlayers.includes(playerId)) return;
    const guess = (msg.word || '').trim().toLowerCase().replace(/ё/g, 'е');
    const actual = (game.assignments[playerId]?.word || '').toLowerCase().replace(/ё/g, 'е');
    if (!guess || !actual) return;

    if (guess === actual) {
      game.finishedPlayers.push(playerId);
      // In turns mode, first to guess wins
      if (game.finishedPlayers.length === 1) {
        game.winner = playerId;
      }
      // Check if all done
      const activePlayers = Object.keys(game.assignments).filter((id) => room.players.has(id));
      if (game.finishedPlayers.length >= activePlayers.length) {
        game.phase = 'finished';
        clearTimer(room);
      } else if (game.currentTurnPlayer === playerId) {
        whoamiNextTurn(room);
      }
    }
    broadcastRoom(room);
  }

  // Skip turn (turns mode)
  if (msg.type === 'skip-turn') {
    if (game.phase !== 'playing' || game.mode !== 'turns') return;
    if (playerId !== game.currentTurnPlayer) return;
    whoamiNextTurn(room);
    broadcastRoom(room);
  }

  if (msg.type === 'new-game') {
    if (playerId !== room.hostId) return;
    clearTimer(room);
    room.game = createWhoamiGame(room.settings);
    for (const [id, p] of room.players) {
      if (p.team === 'player') {
        room.game.assignments[id] = { word: null, assignedBy: null };
        room.game.notebooks[id] = '';
      }
    }
    broadcastRoom(room);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});
