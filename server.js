const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const codenamesWords = require('./words');
const aliasWords = require('./alias-words');
const spyfallLocations = require('./spyfall-locations');
const crocodileWords = require('./crocodile-words');
const monopolyData = require('./monopoly-data');
const monopolyStore = require('./monopoly-store');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ============================================================
// MAINTENANCE MODE
// Toggle with env: MAINTENANCE_MODE=1, MAINTENANCE_PASS=<secret>.
// Bypass: visit /?bypass=<secret> (or any path with that query) to
// receive a 30-day cookie. Without it, all HTTP routes return 503
// + maintenance.html and WebSocket upgrades are rejected.
// ============================================================
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === '1';
const MAINTENANCE_PASS = process.env.MAINTENANCE_PASS || '';
const MAINTENANCE_COOKIE = 'mp_bypass';

function hasMaintenanceBypass(req) {
  if (!MAINTENANCE_MODE) return true;
  const cookieHeader = req.headers && req.headers.cookie;
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((c) => {
    const [k, v] = c.trim().split('=');
    return k === MAINTENANCE_COOKIE && v === '1';
  });
}

if (MAINTENANCE_MODE) {
  app.use((req, res, next) => {
    // Set bypass cookie if the right token arrives in the query string
    if (req.query.bypass && MAINTENANCE_PASS && req.query.bypass === MAINTENANCE_PASS) {
      res.setHeader('Set-Cookie', `${MAINTENANCE_COOKIE}=1; Path=/; Max-Age=${30 * 24 * 3600}; HttpOnly; SameSite=Lax`);
      // Strip the query and redirect so the URL stays clean
      const cleanPath = req.path === '/' ? '/' : req.path;
      return res.redirect(302, cleanPath);
    }
    if (hasMaintenanceBypass(req)) return next();
    res.status(200);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
  });

  console.log(`[maintenance] enabled — bypass via ?bypass=${MAINTENANCE_PASS ? '***' : '(unset)'}`);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', express.json({ limit: '2mb' }));

// ============================================================
// ADMIN API (monopoly editor)
// ============================================================

const SPECIAL_USER_NAMES = new Set(['Fynjif1999']);

function adminAuth(req, res, next) {
  const name = (req.header('x-admin-name') || '').trim();
  if (!SPECIAL_USER_NAMES.has(name)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  req.adminName = name;
  next();
}

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('unsupported image type'), ok);
  },
});

// Public: list deck names (for game settings)
app.get('/api/monopoly/decks', (_req, res) => {
  res.json({ decks: monopolyStore.listDecks() });
});

app.get('/api/admin/state', adminAuth, (_req, res) => {
  const s = monopolyStore.getState();
  res.json({ decks: s.decks, logos: s.logos, s3Enabled: monopolyStore.s3Enabled });
});

app.get('/api/admin/decks', adminAuth, (_req, res) => {
  res.json({ decks: monopolyStore.listDecks() });
});

app.get('/api/admin/decks/:id', adminAuth, (req, res) => {
  const deck = monopolyStore.getDeck(req.params.id);
  if (!deck) return res.status(404).json({ error: 'not found' });
  res.json({ id: req.params.id, deck });
});

app.put('/api/admin/decks/:id', adminAuth, async (req, res) => {
  try {
    const deck = req.body;
    if (!deck || !deck.name || !Array.isArray(deck.board)) {
      return res.status(400).json({ error: 'invalid deck' });
    }
    const saved = await monopolyStore.saveDeck(req.params.id, deck);
    res.json({ id: req.params.id, deck: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/decks/:id', adminAuth, async (req, res) => {
  try {
    await monopolyStore.deleteDeck(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/decks/:id/duplicate', adminAuth, async (req, res) => {
  try {
    const src = monopolyStore.getDeck(req.params.id);
    if (!src) return res.status(404).json({ error: 'source not found' });
    const newId = (req.body?.newId || `deck_${Date.now()}`).toString().replace(/[^a-z0-9_-]/gi, '_');
    const newName = (req.body?.newName || `${src.name} (копия)`).toString();
    const copy = JSON.parse(JSON.stringify(src));
    copy.name = newName;
    copy.locked = false;
    await monopolyStore.saveDeck(newId, copy);
    res.json({ id: newId, deck: copy });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/logos', adminAuth, (_req, res) => {
  res.json({ logos: monopolyStore.listLogos() });
});

app.post('/api/admin/logos', adminAuth, logoUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    const entry = await monopolyStore.uploadLogo({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      name: req.body.name,
      tags: req.body.tags,
    });
    res.json({ logo: entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/logos/:id', adminAuth, async (req, res) => {
  try {
    await monopolyStore.deleteLogo(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/logos/:id/usage', adminAuth, (req, res) => {
  res.json({ usage: monopolyStore.findLogoUsage(req.params.id) });
});

// Base URL for Spyfall location images (e.g. "https://bucket.s3.amazonaws.com/spyfall/").
// If empty, clients render placeholder cards without images.
const SPYFALL_IMAGE_BASE = process.env.SPYFALL_IMAGE_BASE || '';
const SPYFALL_IMAGE_EXT = process.env.SPYFALL_IMAGE_EXT || 'jpg';
const MONOPOLY_IMAGE_BASE = process.env.MONOPOLY_IMAGE_BASE || '';
const MONOPOLY_IMAGE_EXT = process.env.MONOPOLY_IMAGE_EXT || 'png';

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
    nextExplainerId: null,
    explainerHistory: {},
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

function pickSpyfallLocations(count) {
  const pool = shuffle(spyfallLocations);
  return pool.slice(0, Math.min(count, pool.length));
}

function createSpyfallGame(settings) {
  const locationCount = settings.locationCount || 30;
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
    allLocations: pickSpyfallLocations(locationCount),
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

  const pool = game.allLocations.length ? game.allLocations : pickSpyfallLocations(room.settings.locationCount || 30);
  const location = pool[Math.floor(Math.random() * pool.length)];
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
  game.allLocations = shuffle(pool);

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
    settings = { roundDuration: 480, locationCount: 30 };
    game = createSpyfallGame(settings);
  } else if (gameMode === 'crocodile') {
    settings = { teamCount: 2, timerDuration: 90, targetScore: 15, difficulty: 'normal' };
    game = createCrocodileGame(settings);
  } else if (gameMode === 'whoami') {
    settings = { mode: 'free', turnDuration: 120 };
    game = createWhoamiGame(settings);
  } else if (gameMode === 'monopoly') {
    settings = { startingMoney: 1500, deckId: 'classic', maxPlayers: 4 };
    game = createMonopolyGame(settings);
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
  let duration = room.settings.timerDuration;
  if (!duration || duration <= 0) return;
  // First team's first turn gets +60s — they see the grid for the first time
  if (room.game.turn === room.game.firstTeam && room.game.clueHistory.length === 0) {
    duration += 60;
  }
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

function locationImageUrl(slug) {
  if (!SPYFALL_IMAGE_BASE || !slug) return null;
  const sep = SPYFALL_IMAGE_BASE.endsWith('/') ? '' : '/';
  return `${SPYFALL_IMAGE_BASE}${sep}${slug}.${SPYFALL_IMAGE_EXT}`;
}

function serializeLocation(loc) {
  return { slug: loc.slug, name: loc.name, image: locationImageUrl(loc.slug) };
}

function getSpyfallState(room, playerId) {
  const game = room.game;
  const myAssignment = game.assignments[playerId] || null;
  const isFinished = game.phase === 'finished';
  const knowsLocation = (myAssignment && !myAssignment.isSpy) || isFinished;

  return {
    sfPhase: game.phase,
    roundDuration: game.roundDuration,
    yourRole: myAssignment ? myAssignment.role : null,
    yourIsSpy: myAssignment ? myAssignment.isSpy : false,
    location: knowsLocation && game.location ? game.location.name : null,
    locationSlug: knowsLocation && game.location ? game.location.slug : null,
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
    allLocations: game.allLocations.map(serializeLocation),
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
    nextExplainerId: game.nextExplainerId,
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
  } else if (room.gameMode === 'monopoly') {
    Object.assign(base, getMonopolyState(room, playerId));
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
// SPECIAL USERS
const SPECIAL_USERS = { 'Fynjif1999': 'baron' };

function isSpecialUser(name) {
  return SPECIAL_USERS.hasOwnProperty((name || '').trim());
}

function resolvePlayerName(name) {
  const trimmed = (name || '').trim();
  return SPECIAL_USERS[trimmed] || trimmed || 'Игрок';
}

// WEBSOCKET HANDLING
// ============================================================

let nextPlayerId = 1;

wss.on('connection', (ws, req) => {
  if (!hasMaintenanceBypass(req)) {
    try { ws.close(1013, 'maintenance'); } catch {}
    return;
  }
  const playerId = String(nextPlayerId++);
  let currentRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // --- Shared messages ---

    if (msg.type === 'create-room') {
      const room = createRoom(playerId, msg.gameMode || 'codenames');
      currentRoom = room;
      const name = resolvePlayerName(msg.name);
      room.players.set(playerId, { ws, name, team: null, role: null });
      ws.send(JSON.stringify(getPlayerState(room, playerId)));
    }

    if (msg.type === 'join-room') {
      const code = (msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' })); return; }
      currentRoom = room;
      const name = resolvePlayerName(msg.name);
      room.players.set(playerId, { ws, name, team: null, role: null });
      // Transfer host if special user
      if (isSpecialUser(msg.name)) room.hostId = playerId;
      broadcastRoom(room);
    }

    if (msg.type === 'change-name') {
      if (!currentRoom) return;
      const player = currentRoom.players.get(playerId);
      if (!player) return;
      const newName = resolvePlayerName(msg.name);
      player.name = newName.slice(0, 20);
      if (isSpecialUser(msg.name)) currentRoom.hostId = playerId;
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
      if (currentRoom.gameMode === 'spyfall' || currentRoom.gameMode === 'whoami' || currentRoom.gameMode === 'monopoly') {
        if (team && team !== 'player') return;
        if (currentRoom.gameMode === 'monopoly' && team === 'player' && player.team !== 'player') {
          if (currentRoom.game.phase !== 'lobby') return; // can't join mid-game
          const cap = currentRoom.settings.maxPlayers || 4;
          let occupied = 0;
          for (const [, p] of currentRoom.players) if (p.team === 'player') occupied++;
          if (occupied >= cap) return;
        }
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

    if (currentRoom && currentRoom.gameMode === 'monopoly') {
      handleMonopolyMsg(currentRoom, playerId, msg);
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
    const explainerId = game.nextExplainerId || aliasGetExplainer(room);
    if (!explainerId) return;
    const teamId = game.teams[game.currentTeamIndex];
    if (!game.explainerHistory[teamId]) game.explainerHistory[teamId] = [];
    game.explainerHistory[teamId].push(explainerId);
    game.explainerId = explainerId;
    game.nextExplainerId = null;
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
    game.nextExplainerId = aliasGetExplainer(room);
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
    let locationCount = parseInt(msg.locationCount, 10);
    if (![20, 25, 30, 35].includes(locationCount)) locationCount = 30;
    locationCount = Math.min(locationCount, spyfallLocations.length);
    room.settings = { roundDuration, locationCount };
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
    const guessedSlug = msg.locationSlug || msg.locationName;
    game.phase = 'finished';
    if (guessedSlug === game.location.slug || guessedSlug === game.location.name) {
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

// ============================================================
// MONOPOLY GAME LOGIC
// ============================================================

const { TRANSPORT_RENT, JAIL_INDEX, GO_TO_JAIL_INDEX, GO_SALARY } = monopolyData;

function createMonopolyGame(settings) {
  const deckId = settings.deckId || 'classic';
  const deck = monopolyStore.getDeck(deckId);
  return {
    phase: 'lobby',          // lobby | playing | finished
    turn: null,              // rolling | jail-decision | action | ended
    turnOrder: [],
    turnIndex: 0,
    currentPlayerId: null,
    dice: null,
    doublesCount: 0,
    startingMoney: settings.startingMoney || 1500,
    deckId,
    deck,
    playerState: {},
    ownership: {},
    houses: {},   // slug → 0..5 (5 = hotel)
    log: [],
    pendingBuy: null,
    winner: null,
    paused: false,
    timerEnd: null,
    timerRemaining: null,
    teams: [],
    scores: {},
  };
}

function mpLog(game, text) {
  game.log.push({ text, ts: Date.now() });
  if (game.log.length > 30) game.log.shift();
}

function mpPlayerName(room, id) {
  return room.players.get(id)?.name || 'Игрок';
}

function mpSquareLabel(square, deck) {
  if (square.type === 'property') return deck.properties[square.slug]?.name || '';
  if (square.type === 'transport') return deck.transport[square.slug]?.name || '';
  if (square.type === 'utility') return deck.utilities[square.slug]?.name || '';
  if (square.type === 'tax') return square.name;
  if (square.type === 'go') return 'GO';
  if (square.type === 'jail') return 'Тюрьма';
  if (square.type === 'go_to_jail') return 'В тюрьму';
  if (square.type === 'parking') return 'Парковка';
  if (square.type === 'chance') return 'Шанс';
  if (square.type === 'chest') return 'Казна';
  return '';
}

function mpImageUrl(slug) {
  if (!MONOPOLY_IMAGE_BASE || !slug) return null;
  const sep = MONOPOLY_IMAGE_BASE.endsWith('/') ? '' : '/';
  return `${MONOPOLY_IMAGE_BASE}${sep}${slug}.${MONOPOLY_IMAGE_EXT}`;
}

function startMonopolyGame(room) {
  const players = [];
  for (const [id, p] of room.players) if (p.team === 'player') players.push(id);
  if (players.length < 2 || players.length > 8) return false;
  const game = room.game;
  game.turnOrder = shuffle(players);
  game.turnIndex = 0;
  game.currentPlayerId = game.turnOrder[0];
  game.playerState = {};
  for (const id of game.turnOrder) {
    game.playerState[id] = {
      money: game.startingMoney, position: 0,
      inJail: false, jailTurns: 0, bankrupt: false,
    };
  }
  game.ownership = {};
  game.houses = {};
  game.log = [];
  game.dice = null;
  game.doublesCount = 0;
  game.phase = 'playing';
  game.turn = 'rolling';
  game.pendingBuy = null;
  game.winner = null;
  mpLog(game, `Игра началась: ${game.turnOrder.length} игроков, каждому по ${game.startingMoney}`);
  return true;
}

function mpRollDice(room, playerId) {
  const game = room.game;
  if (game.phase !== 'playing') return;
  if (playerId !== game.currentPlayerId) return;
  const ps = game.playerState[playerId];
  if (!ps || ps.bankrupt) return;
  if (game.turn !== 'rolling' && game.turn !== 'jail-decision') return;

  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  const isDouble = d1 === d2;
  game.dice = [d1, d2];
  const playerName = mpPlayerName(room, playerId);

  if (ps.inJail) {
    if (isDouble) {
      ps.inJail = false;
      ps.jailTurns = 0;
      mpLog(game, `${playerName} выбросил дубль ${d1}-${d2} — выход из тюрьмы`);
      mpAdvance(room, playerId, d1 + d2);
      // Jail-escape doesn't give bonus turn — doublesCount not incremented
    } else {
      ps.jailTurns += 1;
      mpLog(game, `${playerName} выбросил ${d1}-${d2} — остаётся в тюрьме`);
      if (ps.jailTurns >= 3) {
        if (ps.money >= 50) {
          ps.money -= 50;
          ps.inJail = false;
          ps.jailTurns = 0;
          mpLog(game, `${playerName} платит 50 за выход и двигается на ${d1 + d2}`);
          mpAdvance(room, playerId, d1 + d2);
        } else {
          mpLog(game, `${playerName} не может заплатить 50 — банкрот`);
          mpBankrupt(room, playerId, null);
          // mpBankrupt auto-advances; don't touch turn here
        }
      } else {
        game.turn = 'action';
      }
    }
    return;
  }

  if (isDouble) {
    game.doublesCount += 1;
    if (game.doublesCount >= 3) {
      mpLog(game, `${playerName} — 3-й дубль подряд, в тюрьму!`);
      mpSendToJail(room, playerId);
      game.turn = 'action';
      return;
    }
  }

  mpLog(game, `${playerName} бросает ${d1}+${d2}`);
  mpAdvance(room, playerId, d1 + d2);
}

function mpAdvance(room, playerId, steps) {
  const game = room.game;
  const ps = game.playerState[playerId];
  const newPos = (ps.position + steps) % 40;
  if (newPos < ps.position || steps >= 40) {
    ps.money += GO_SALARY;
    mpLog(game, `${mpPlayerName(room, playerId)} проходит GO, +${GO_SALARY}`);
  }
  ps.position = newPos;
  mpResolveSquare(room, playerId);
}

function mpResolveSquare(room, playerId) {
  const game = room.game;
  const deck = game.deck;
  const ps = game.playerState[playerId];
  const square = deck.board[ps.position];
  const playerName = mpPlayerName(room, playerId);

  if (square.type === 'property' || square.type === 'transport' || square.type === 'utility') {
    const slug = square.slug;
    const info = square.type === 'property' ? deck.properties[slug]
      : square.type === 'transport' ? deck.transport[slug]
      : deck.utilities[slug];
    const ownerId = game.ownership[slug];
    if (!ownerId) {
      game.pendingBuy = { slug, type: square.type, price: info.price, name: info.name };
      mpLog(game, `${playerName} на «${info.name}» — свободно, цена ${info.price}`);
    } else if (ownerId === playerId) {
      mpLog(game, `${playerName} на своей «${info.name}»`);
    } else {
      const rent = mpComputeRent(game, square, slug, ownerId);
      mpCharge(room, playerId, ownerId, rent, info.name);
    }
  } else if (square.type === 'tax') {
    mpCharge(room, playerId, null, square.amount, square.name);
  } else if (square.type === 'go_to_jail') {
    mpLog(game, `${playerName} отправляется в тюрьму`);
    mpSendToJail(room, playerId);
  } else if (square.type === 'chance' || square.type === 'chest') {
    mpLog(game, `${playerName} на клетке «${square.type === 'chance' ? 'Шанс' : 'Казна'}» (без эффекта)`);
  }

  // Only set action if bankruptcy/jail didn't already advance the turn
  if (game.phase === 'playing' && playerId === game.currentPlayerId && !ps.bankrupt) {
    game.turn = 'action';
  }
}

function mpComputeRent(game, square, slug, ownerId) {
  const deck = game.deck;
  if (square.type === 'property') {
    const prop = deck.properties[slug];
    const groupSlugs = Object.keys(deck.properties).filter((s) => deck.properties[s].group === prop.group);
    const ownsAll = groupSlugs.every((s) => game.ownership[s] === ownerId);
    const houses = game.houses[slug] || 0;
    if (houses > 0) return prop.rent[houses] || prop.rent[prop.rent.length - 1];
    return ownsAll ? prop.rent[0] * 2 : prop.rent[0];
  }
  if (square.type === 'transport') {
    const owned = Object.keys(deck.transport).filter((s) => game.ownership[s] === ownerId).length;
    return TRANSPORT_RENT[Math.max(0, owned - 1)] || 0;
  }
  if (square.type === 'utility') {
    const owned = Object.keys(deck.utilities).filter((s) => game.ownership[s] === ownerId).length;
    const diceSum = (game.dice?.[0] || 0) + (game.dice?.[1] || 0);
    return (owned === 2 ? 10 : 4) * diceSum;
  }
  return 0;
}

// Build a house (or hotel at level 5) on a property.
// Rules: must own all of the group, even-build (cannot exceed min in group by more than 1),
// max 5 (hotel), enough money, no pendingBuy mid-action.
function mpBuildHouse(room, playerId, slug) {
  const game = room.game;
  if (game.phase !== 'playing') return;
  if (playerId !== game.currentPlayerId) return;
  if (game.pendingBuy) return;
  if (game.turn === 'jail-decision') return;
  const deck = game.deck;
  const prop = deck.properties[slug];
  if (!prop) return;
  if (game.ownership[slug] !== playerId) return;
  const groupSlugs = Object.keys(deck.properties).filter((s) => deck.properties[s].group === prop.group);
  if (!groupSlugs.every((s) => game.ownership[s] === playerId)) return;
  const cur = game.houses[slug] || 0;
  if (cur >= 5) return;
  // Even-build: this slug's level must be the min (or tied for min) in the group
  const minInGroup = Math.min(...groupSlugs.map((s) => game.houses[s] || 0));
  if (cur > minInGroup) return;
  const cost = prop.house || 0;
  const ps = game.playerState[playerId];
  if (ps.money < cost) return;
  ps.money -= cost;
  game.houses[slug] = cur + 1;
  const next = game.houses[slug];
  const what = next === 5 ? 'отель' : `${next} ${next === 1 ? 'дом' : 'дома'}`;
  mpLog(game, `${mpPlayerName(room, playerId)} строит на «${prop.name}» (теперь ${what}), −${cost}`);
}

// Sell one house. Even-sell: this slug's level must be the max in the group.
// Refund half the house price (rounded down).
function mpSellHouse(room, playerId, slug) {
  const game = room.game;
  if (game.phase !== 'playing') return;
  if (playerId !== game.currentPlayerId) return;
  if (game.pendingBuy) return;
  if (game.turn === 'jail-decision') return;
  const deck = game.deck;
  const prop = deck.properties[slug];
  if (!prop) return;
  if (game.ownership[slug] !== playerId) return;
  const cur = game.houses[slug] || 0;
  if (cur <= 0) return;
  const groupSlugs = Object.keys(deck.properties).filter((s) => deck.properties[s].group === prop.group);
  const maxInGroup = Math.max(...groupSlugs.map((s) => game.houses[s] || 0));
  if (cur < maxInGroup) return;
  const refund = Math.floor((prop.house || 0) / 2);
  const ps = game.playerState[playerId];
  ps.money += refund;
  game.houses[slug] = cur - 1;
  const left = game.houses[slug];
  const what = left === 0 ? 'без построек' : left === 5 ? 'отель' : `${left} ${left === 1 ? 'дом' : 'дома'}`;
  mpLog(game, `${mpPlayerName(room, playerId)} продаёт постройку на «${prop.name}» (теперь ${what}), +${refund}`);
}

function mpCharge(room, fromId, toId, amount, label) {
  const game = room.game;
  const ps = game.playerState[fromId];
  const fromName = mpPlayerName(room, fromId);
  const toName = toId ? mpPlayerName(room, toId) : 'банку';
  if (ps.money < amount) {
    const paid = ps.money;
    if (toId) game.playerState[toId].money += paid;
    mpLog(game, `${fromName} не может заплатить ${amount} (${label}) — банкрот, ${toName} получает ${paid}`);
    mpBankrupt(room, fromId, toId);
    return;
  }
  ps.money -= amount;
  if (toId) game.playerState[toId].money += amount;
  mpLog(game, `${fromName} платит ${amount} → ${toName} за «${label}»`);
}

function mpBankrupt(room, playerId, creditorId) {
  const game = room.game;
  const ps = game.playerState[playerId];
  ps.bankrupt = true;
  ps.money = 0;
  for (const slug of Object.keys(game.ownership)) {
    if (game.ownership[slug] === playerId) {
      // Houses revert to bank regardless of who claims the property
      if (game.houses[slug]) delete game.houses[slug];
      if (creditorId) game.ownership[slug] = creditorId;
      else delete game.ownership[slug];
    }
  }
  mpLog(game, `💀 ${mpPlayerName(room, playerId)} — БАНКРОТ`);
  mpCheckWin(room);
  if (game.phase === 'playing' && playerId === game.currentPlayerId) {
    mpAdvanceToNextPlayer(room);
  }
}

function mpAdvanceToNextPlayer(room) {
  const game = room.game;
  game.doublesCount = 0;
  game.dice = null;
  game.pendingBuy = null;
  const alive = game.turnOrder.filter((id) => !game.playerState[id].bankrupt);
  if (alive.length <= 1) { mpCheckWin(room); return; }
  do {
    game.turnIndex = (game.turnIndex + 1) % game.turnOrder.length;
  } while (game.playerState[game.turnOrder[game.turnIndex]].bankrupt);
  game.currentPlayerId = game.turnOrder[game.turnIndex];
  const nextPs = game.playerState[game.currentPlayerId];
  game.turn = nextPs.inJail ? 'jail-decision' : 'rolling';
}

function mpSendToJail(room, playerId) {
  const ps = room.game.playerState[playerId];
  ps.position = JAIL_INDEX;
  ps.inJail = true;
  ps.jailTurns = 0;
  room.game.doublesCount = 0;
}

function mpBuy(room, playerId) {
  const game = room.game;
  if (game.phase !== 'playing' || playerId !== game.currentPlayerId) return;
  if (!game.pendingBuy) return;
  const ps = game.playerState[playerId];
  const { slug, price, name } = game.pendingBuy;
  if (ps.money < price) return;
  ps.money -= price;
  game.ownership[slug] = playerId;
  mpLog(game, `${mpPlayerName(room, playerId)} покупает «${name}» за ${price}`);
  game.pendingBuy = null;
}

function mpSkipBuy(room, playerId) {
  const game = room.game;
  if (playerId !== game.currentPlayerId || !game.pendingBuy) return;
  mpLog(game, `${mpPlayerName(room, playerId)} отказывается от «${game.pendingBuy.name}»`);
  game.pendingBuy = null;
}

function mpEndTurn(room, playerId) {
  const game = room.game;
  if (game.phase !== 'playing' || playerId !== game.currentPlayerId) return;
  if (game.pendingBuy) return;

  const ps = game.playerState[playerId];
  const rolledDouble = game.dice && game.dice[0] === game.dice[1] && game.doublesCount > 0 && game.doublesCount < 3;

  if (rolledDouble && !ps.inJail && !ps.bankrupt) {
    game.dice = null;
    game.turn = 'rolling';
    return;
  }

  mpAdvanceToNextPlayer(room);
}

function mpPayJail(room, playerId) {
  const game = room.game;
  if (playerId !== game.currentPlayerId || game.turn !== 'jail-decision') return;
  const ps = game.playerState[playerId];
  if (!ps.inJail || ps.money < 50) return;
  ps.money -= 50;
  ps.inJail = false;
  ps.jailTurns = 0;
  game.turn = 'rolling';
  mpLog(game, `${mpPlayerName(room, playerId)} платит 50 — вышел из тюрьмы`);
}

function mpCheckWin(room) {
  const game = room.game;
  const alive = game.turnOrder.filter((id) => !game.playerState[id].bankrupt);
  if (alive.length === 1) {
    game.winner = alive[0];
    game.phase = 'finished';
    mpLog(game, `🏆 ${mpPlayerName(room, alive[0])} — победитель!`);
  }
}

function mpLogoUrl(game, info) {
  if (!info) return null;
  if (info.logoId) {
    const store = monopolyStore.getState();
    const logo = store?.logos?.[info.logoId];
    if (logo?.url) return logo.url;
  }
  if (info.logoUrl) return info.logoUrl;
  return mpImageUrl(info.slug || info.key || null);
}

function mpSerializeBoard(game) {
  const deck = game.deck;
  return deck.board.map((sq, i) => {
    const out = { index: i, type: sq.type };
    if (sq.slug) {
      out.slug = sq.slug;
      const info = sq.type === 'property' ? deck.properties[sq.slug]
        : sq.type === 'transport' ? deck.transport[sq.slug]
        : sq.type === 'utility' ? deck.utilities[sq.slug]
        : null;
      if (info) {
        out.name = info.name;
        out.price = info.price;
        if (sq.type === 'property') {
          out.group = info.group;
          out.color = deck.groups[info.group]?.color || '#888';
          out.rent = info.rent;
          out.house = info.house || 0;
        }
        out.image = mpLogoUrl(game, info);
      }
    } else {
      out.name = mpSquareLabel(sq, deck);
      if (sq.type === 'tax') out.amount = sq.amount;
    }
    return out;
  });
}

function getMonopolyState(room, playerId) {
  const game = room.game;
  return {
    mpPhase: game.phase,
    mpTurn: game.turn,
    currentPlayerId: game.currentPlayerId,
    dice: game.dice,
    doublesCount: game.doublesCount,
    playerState: game.playerState,
    ownership: game.ownership,
    houses: game.houses,
    pendingBuy: playerId === game.currentPlayerId ? game.pendingBuy : null,
    log: game.log.slice(-20),
    turnOrder: game.turnOrder,
    winner: game.winner,
    board: mpSerializeBoard(game),
    groups: game.deck.groups,
    deckId: game.deckId,
    deckName: game.deck.name,
    startingMoney: game.startingMoney,
  };
}

function handleMonopolyMsg(room, playerId, msg) {
  const game = room.game;

  if (msg.type === 'update-settings') {
    if (playerId !== room.hostId) return;
    const startingMoney = Math.max(500, Math.min(5000, parseInt(msg.startingMoney, 10) || 1500));
    const deckId = (msg.deckId || 'classic').toString();
    let maxPlayers = parseInt(msg.maxPlayers, 10);
    if (!Number.isFinite(maxPlayers) || maxPlayers < 2 || maxPlayers > 8) maxPlayers = 4;
    room.settings = { startingMoney, deckId, maxPlayers };
    // If lobby, recreate game to refresh deck; if mid-game, ignore (would reset)
    if (room.game.phase === 'lobby') {
      room.game = createMonopolyGame(room.settings);
    }
    // Boot any extra players over the new cap
    if (room.game.phase === 'lobby') {
      const playerIds = [];
      for (const [id, p] of room.players) if (p.team === 'player') playerIds.push(id);
      while (playerIds.length > maxPlayers) {
        const id = playerIds.pop();
        const p = room.players.get(id);
        if (p) { p.team = null; p.role = null; }
      }
    }
    broadcastRoom(room);
    return;
  }

  if (msg.type === 'start-game') {
    if (playerId !== room.hostId) return;
    if (game.phase !== 'lobby') return;
    if (!startMonopolyGame(room)) return;
    broadcastRoom(room);
    return;
  }

  if (msg.type === 'roll-dice') {
    mpRollDice(room, playerId);
    broadcastRoom(room);
    return;
  }

  if (msg.type === 'buy-property') {
    mpBuy(room, playerId);
    broadcastRoom(room);
    return;
  }

  if (msg.type === 'skip-buy') {
    mpSkipBuy(room, playerId);
    broadcastRoom(room);
    return;
  }

  if (msg.type === 'end-turn') {
    mpEndTurn(room, playerId);
    broadcastRoom(room);
    return;
  }

  if (msg.type === 'pay-jail') {
    mpPayJail(room, playerId);
    broadcastRoom(room);
    return;
  }

  if (msg.type === 'build-house') {
    mpBuildHouse(room, playerId, String(msg.slug || ''));
    broadcastRoom(room);
    return;
  }

  if (msg.type === 'sell-house') {
    mpSellHouse(room, playerId, String(msg.slug || ''));
    broadcastRoom(room);
    return;
  }

  if (msg.type === 'new-game') {
    if (playerId !== room.hostId) return;
    room.game = createMonopolyGame(room.settings);
    broadcastRoom(room);
    return;
  }
}

const PORT = process.env.PORT || 3000;

monopolyStore.init().then(() => {
  server.listen(PORT, () => {
    console.log(`Game server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to init monopoly store:', err);
  server.listen(PORT, () => {
    console.log(`Game server running on port ${PORT} (store unavailable)`);
  });
});
