const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let ws;
let state = null;
let timerInterval = null;
let selectedMode = 'codenames';

// ===== Saved name =====
const savedName = localStorage.getItem('codenames-name') || '';
if (savedName) $('#player-name').value = savedName;

function getPlayerName() {
  const name = $('#player-name').value.trim() || 'Игрок';
  localStorage.setItem('codenames-name', name);
  return name;
}

// ===== WebSocket =====
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}${location.pathname}`);

  ws.onopen = () => {
    const hash = location.hash.slice(1);
    if (hash) send({ type: 'join-room', name: getPlayerName(), code: hash });
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'error') { $('#join-error').textContent = msg.message; return; }
    if (msg.type === 'croc-draw') { crocDrawRemote(msg); return; }
    if (msg.type === 'croc-clear') { crocClearCanvas(); return; }
    if (msg.type === 'trade-error') { mpTradeError = msg.message || 'не удалось отправить'; mpTradeOpen = true; render(); return; }
    if (msg.type === 'state') { state = msg; render(); }
  };

  ws.onclose = () => setTimeout(connect, 2000);
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ===== Mode selector =====
$('#mode-select').onchange = () => {
  selectedMode = $('#mode-select').value;
};

// ===== Join =====
$('#btn-create').onclick = () => {
  send({ type: 'create-room', name: getPlayerName(), gameMode: selectedMode });
};
$('#btn-join').onclick = () => {
  const code = $('#room-code-input').value.trim();
  if (!code) return;
  send({ type: 'join-room', name: getPlayerName(), code });
};
$('#room-code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-join').click();
});

// ===== Name =====
$('#btn-change-name').onclick = () => {
  const name = $('#name-input').value.trim();
  if (name) { localStorage.setItem('codenames-name', name); send({ type: 'change-name', name }); }
};
$('#name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-change-name').click();
});

// ===== Controls =====
$('#btn-leave').onclick = () => {
  state = null;
  location.hash = '';
  ws.close();
  $('#game-screen').classList.add('hidden');
  $('#join-overlay').classList.add('active');
  setTimeout(connect, 300);
};
$('#btn-pause').onclick = () => send({ type: 'toggle-pause' });
$('#btn-unpause').onclick = () => send({ type: 'toggle-pause' });
$('#btn-restart').onclick = () => send({ type: 'new-game' });
$('#btn-shuffle').onclick = () => send({ type: 'shuffle-players' });
$('#btn-new-game-win').onclick = () => send({ type: 'new-game' });

$('#btn-settings').onclick = (e) => {
  e.stopPropagation();
  $('#settings-dropdown').classList.toggle('hidden');
};
$('#settings-dropdown').onclick = (e) => e.stopPropagation();
document.addEventListener('click', () => $('#settings-dropdown').classList.add('hidden'));

$('#btn-apply-settings').onclick = () => {
  if (state.gameMode === 'codenames') {
    send({
      type: 'update-settings',
      teamCount: $('#s-teams').value,
      gridRows: $('#s-rows').value,
      gridCols: $('#s-cols').value,
      timerDuration: $('#s-timer').value,
    });
  } else if (state.gameMode === 'alias') {
    send({
      type: 'update-settings',
      teamCount: $('#sa-teams').value,
      timerDuration: $('#sa-timer').value,
      targetScore: $('#sa-target').value,
      difficulty: $('#sa-difficulty').value,
      skipPenalty: $('#sa-skip').value,
    });
  } else if (state.gameMode === 'spyfall') {
    send({
      type: 'update-settings',
      roundDuration: $('#ss-duration').value,
      locationCount: $('#ss-location-count').value,
    });
  } else if (state.gameMode === 'crocodile') {
    send({
      type: 'update-settings',
      teamCount: $('#sc-teams').value,
      timerDuration: $('#sc-timer').value,
      targetScore: $('#sc-target').value,
      difficulty: $('#sc-difficulty').value,
    });
  } else if (state.gameMode === 'whoami') {
    send({
      type: 'update-settings',
      mode: $('#sw-mode').value,
      turnDuration: $('#sw-timer').value,
    });
  } else if (state.gameMode === 'monopoly') {
    send({
      type: 'update-settings',
      startingMoney: $('#sm-money').value,
      deckId: $('#sm-deck').value,
      maxPlayers: $('#sm-slots').value,
    });
  }
  $('#settings-dropdown').classList.add('hidden');
};

$('#btn-give-clue').onclick = () => {
  const word = $('#clue-word').value.trim();
  const count = $('#clue-count').value;
  if (!word || count === '') return;
  send({ type: 'give-clue', word, count });
  $('#clue-word').value = '';
  $('#clue-count').value = '';
};
$('#clue-word').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-give-clue').click();
});
$('#btn-end-turn').onclick = () => send({ type: 'end-turn' });

// ===== Main render =====
function render() {
  if (!state) return;

  $('#join-overlay').classList.remove('active');
  $('#game-screen').classList.remove('hidden');
  location.hash = state.roomCode;

  const you = state.you;
  const isHost = you && you.id === state.hostId;
  const gm = state.gameMode;

  $('#room-code').textContent = state.roomCode;
  const badge = $('#game-mode-badge');
  const gmLabels = { codenames: 'Codenames', alias: 'Alias', spyfall: 'Шпион', crocodile: 'Крокодил', whoami: 'Кто я?', monopoly: 'Монополия' };
  badge.textContent = gmLabels[gm] || gm;
  badge.className = 'game-mode-badge gm-' + gm;

  const nameInput = $('#name-input');
  if (document.activeElement !== nameInput && you) nameInput.value = you.name;

  $$('.host-only').forEach((el) => el.classList.toggle('hidden', !isHost));

  // Body class for game-mode-specific theming
  document.body.classList.toggle('gm-monopoly', gm === 'monopoly');

  // Toggle game areas
  $('#codenames-area').classList.toggle('hidden', gm !== 'codenames');
  $('#alias-area').classList.toggle('hidden', gm !== 'alias');
  $('#spyfall-area').classList.toggle('hidden', gm !== 'spyfall');
  $('#crocodile-area').classList.toggle('hidden', gm !== 'crocodile');
  $('#whoami-area').classList.toggle('hidden', gm !== 'whoami');
  $('#monopoly-area').classList.toggle('hidden', gm !== 'monopoly');
  $('#settings-codenames').classList.toggle('hidden', gm !== 'codenames');
  $('#settings-alias').classList.toggle('hidden', gm !== 'alias');
  $('#settings-spyfall').classList.toggle('hidden', gm !== 'spyfall');
  $('#settings-crocodile').classList.toggle('hidden', gm !== 'crocodile');
  $('#settings-whoami').classList.toggle('hidden', gm !== 'whoami');
  $('#settings-monopoly').classList.toggle('hidden', gm !== 'monopoly');
  $('#clue-display').classList.toggle('hidden', gm !== 'codenames');

  // Settings values
  if (isHost) {
    if (gm === 'codenames') {
      $('#s-teams').value = state.settings.teamCount;
      $('#s-rows').value = state.settings.gridRows;
      $('#s-cols').value = state.settings.gridCols;
      $('#s-timer').value = state.settings.timerDuration;
    } else if (gm === 'alias') {
      $('#sa-teams').value = state.settings.teamCount;
      $('#sa-timer').value = state.settings.timerDuration;
      $('#sa-target').value = state.settings.targetScore;
      $('#sa-difficulty').value = state.settings.difficulty;
      $('#sa-skip').value = state.settings.skipPenalty ? 'true' : 'false';
    } else if (gm === 'spyfall') {
      $('#ss-duration').value = state.settings.roundDuration;
      if (state.settings.locationCount) $('#ss-location-count').value = state.settings.locationCount;
    } else if (gm === 'crocodile') {
      $('#sc-teams').value = state.settings.teamCount;
      $('#sc-timer').value = state.settings.timerDuration;
      $('#sc-target').value = state.settings.targetScore;
      $('#sc-difficulty').value = state.settings.difficulty;
    } else if (gm === 'whoami') {
      $('#sw-mode').value = state.settings.mode;
      $('#sw-timer').value = state.settings.turnDuration;
    } else if (gm === 'monopoly') {
      if (state.settings.startingMoney) $('#sm-money').value = state.settings.startingMoney;
      if (state.settings.deckId) $('#sm-deck').value = state.settings.deckId;
      if (state.settings.maxPlayers) $('#sm-slots').value = state.settings.maxPlayers;
      if (window.mpPopulateDeckDropdown) window.mpPopulateDeckDropdown();
    }
  }

  // Admin button visibility: baron-only, monopoly mode
  const adminBtn = $('#btn-admin-open');
  if (adminBtn) {
    const rawName = localStorage.getItem('codenames-name') || '';
    const showAdmin = rawName === 'Fynjif1999' && gm === 'monopoly';
    adminBtn.classList.toggle('hidden', !showAdmin);
  }

  renderScores();
  renderTimer();

  if (gm === 'codenames') {
    renderCodenamesTurnInfo();
    renderBoard();
    renderClueHistory();
    renderCodenamesControls();
  } else if (gm === 'alias') {
    renderAliasTurnInfo();
    renderAliasArea();
  } else if (gm === 'spyfall') {
    renderSpyfallTurnInfo();
    renderSpyfallArea();
  } else if (gm === 'crocodile') {
    renderCrocodileTurnInfo();
    renderCrocodileArea();
  } else if (gm === 'whoami') {
    renderWhoamiTurnInfo();
    renderWhoamiArea();
  } else if (gm === 'monopoly') {
    renderMonopolyTurnInfo();
    renderMonopolyArea();
  }

  renderPlayerPanel();
  renderPauseOverlay();
  renderWinnerOverlay();
}

// ===== Scores (shared) =====
function renderScores() {
  const bar = $('#scores-bar');
  bar.innerHTML = '';
  const gm = state.gameMode;

  if (gm === 'whoami') {
    const inGame = Object.keys(state.assignments || {}).length;
    const badge = document.createElement('div');
    badge.className = 'score-badge';
    badge.style.background = 'rgba(241,196,15,0.2)';
    badge.style.color = '#f1c40f';
    const modeLabel = state.wmMode === 'turns' ? 'По очереди' : 'Свободный';
    badge.innerHTML = `<span class="s-label">${modeLabel}</span>Игроков: ${inGame}`;
    bar.appendChild(badge);
    return;
  }

  if (gm === 'crocodile') {
    for (const teamId of state.teams) {
      const info = state.teamInfo[teamId];
      const badge = document.createElement('div');
      badge.className = 'score-badge';
      badge.style.background = hexToRgba(info.color, 0.2);
      badge.style.color = info.color;
      const isActive = teamId === state.teams[state.currentTeamIndex] && state.crocPhase !== 'finished';
      if (isActive) badge.style.outline = `2px solid ${info.color}`;
      badge.innerHTML = `<span class="s-label">${esc(info.name)}</span>${state.scores[teamId]} / ${state.targetScore}`;
      bar.appendChild(badge);
    }
    return;
  }

  if (gm === 'spyfall') {
    const inGame = state.players.filter((p) => p.team === 'player').length;
    const badge = document.createElement('div');
    badge.className = 'score-badge';
    badge.style.background = 'rgba(155,89,182,0.2)';
    badge.style.color = '#9b59b6';
    badge.innerHTML = `<span class="s-label">Игроки</span>${inGame}`;
    bar.appendChild(badge);
    return;
  }

  if (gm === 'monopoly') {
    const inGame = state.players.filter((p) => p.team === 'player').length;
    const badge = document.createElement('div');
    badge.className = 'score-badge';
    badge.style.background = 'rgba(52,152,219,0.2)';
    badge.style.color = '#3498db';
    badge.innerHTML = `<span class="s-label">Игроки</span>${inGame}`;
    bar.appendChild(badge);
    return;
  }

  for (const teamId of state.teams) {
    const info = state.teamInfo[teamId];
    const badge = document.createElement('div');
    badge.className = 'score-badge';
    badge.style.background = hexToRgba(info.color, 0.2);
    badge.style.color = info.color;

    let isActive;
    if (gm === 'codenames') {
      isActive = teamId === state.turn && !state.winner;
    } else {
      isActive = teamId === state.teams[state.currentTeamIndex] && state.phase !== 'finished';
    }
    if (isActive) badge.style.outline = `2px solid ${info.color}`;

    const total = gm === 'codenames' ? state.totals[teamId] : state.targetScore;
    badge.innerHTML = `<span class="s-label">${esc(info.name)}</span>${state.scores[teamId]} / ${total}`;
    bar.appendChild(badge);
  }
}

// ===== Timer (shared) =====
function renderTimer() {
  const el = $('#timer-display');
  clearInterval(timerInterval);

  if (!state.timerEnd && (!state.timerRemaining || state.timerRemaining <= 0)) {
    el.classList.add('hidden'); return;
  }
  if (state.paused && state.timerRemaining != null) {
    el.classList.remove('hidden');
    el.textContent = formatTime(state.timerRemaining);
    el.classList.toggle('timer-warn', state.timerRemaining <= 10);
    return;
  }
  if (!state.timerEnd) { el.classList.add('hidden'); return; }

  el.classList.remove('hidden');
  function tick() {
    const remaining = Math.max(0, Math.ceil((state.timerEnd - Date.now()) / 1000));
    el.textContent = formatTime(remaining);
    el.classList.toggle('timer-warn', remaining <= 10);
    if (remaining <= 0) clearInterval(timerInterval);
  }
  tick();
  timerInterval = setInterval(tick, 250);
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}`;
}

// ============================================================
// CODENAMES
// ============================================================

function renderCodenamesTurnInfo() {
  const turnEl = $('#turn-indicator');
  const clueEl = $('#clue-display');

  if (state.winner) { turnEl.textContent = ''; clueEl.textContent = ''; return; }

  const info = state.teamInfo[state.turn];
  const phase = state.clue ? 'отгадывают' : 'ждут подсказку';
  turnEl.textContent = `${info.name} ${phase}`;
  turnEl.style.color = info.color;

  if (state.clue) {
    clueEl.textContent = `${state.clue.word.toUpperCase()} \u2014 ${state.clue.count}`;
    clueEl.style.color = info.color;
  } else {
    clueEl.textContent = '';
  }
}

function renderBoard() {
  const you = state.you;
  const isSpymaster = you && you.role === 'spymaster';
  const isOperative = you && you.role === 'operative';
  const isMyTurn = you && you.team === state.turn;
  const canVote = isOperative && isMyTurn && state.clue && !state.winner && !state.paused;

  const board = $('#board');
  board.style.gridTemplateColumns = `repeat(${state.gridCols}, 1fr)`;
  board.innerHTML = '';
  const voteTotal = state.operativeCount;

  state.cards.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'card';

    if (card.revealed) {
      el.classList.add(`type-${card.type}`);
      el.textContent = card.word;
      board.appendChild(el);
      return;
    }

    if (state.winner && card.type) {
      el.classList.add(`spy-${card.type}`);
    } else if (isSpymaster && card.type) {
      el.classList.add(`spy-${card.type}`);
    } else {
      el.classList.add('unrevealed');
    }

    el.textContent = card.word;

    const voteCount = state.cardVotes[i] || 0;
    const isConfirming = state.confirmingCard === i;
    const isMyVote = state.yourVote === i;

    if (voteCount > 0 || isConfirming) {
      el.classList.add('has-votes');
      if (isConfirming) el.classList.add('confirming');
      const badge = document.createElement('span');
      badge.className = 'vote-badge';
      badge.textContent = `${voteCount}/${voteTotal}`;
      el.appendChild(badge);
    }
    if (isMyVote) el.classList.add('my-vote');
    if (canVote) {
      el.classList.add('clickable');
      el.onclick = () => send({ type: 'vote-card', index: i });
    }

    board.appendChild(el);
  });
}

function renderClueHistory() {
  const left = $('#clue-history-left');
  const right = $('#clue-history-right');
  left.innerHTML = '';
  right.innerHTML = '';
  if (!state.clueHistory || state.clueHistory.length === 0) return;

  state.teams.forEach((teamId, idx) => {
    const clues = state.clueHistory.filter((c) => c.team === teamId);
    if (clues.length === 0) return;
    const info = state.teamInfo[teamId];
    const block = document.createElement('div');
    block.className = 'clue-team-history';
    block.style.background = hexToRgba(info.color, 0.1);
    block.style.borderLeft = `3px solid ${info.color}`;
    const h4 = document.createElement('h4');
    h4.textContent = info.name;
    h4.style.color = info.color;
    block.appendChild(h4);
    for (const clue of clues) {
      const entry = document.createElement('div');
      entry.className = 'clue-entry';
      entry.innerHTML = `<span class="clue-word">${esc(clue.word)}</span><span class="clue-count">${clue.count}</span>`;
      block.appendChild(entry);
    }
    (idx % 2 === 0 ? left : right).appendChild(block);
  });
}

function renderCodenamesControls() {
  const you = state.you;
  const isSpymaster = you && you.role === 'spymaster';
  const isMyTurn = you && you.team === state.turn;
  const showClueForm = isSpymaster && isMyTurn && !state.clue && !state.winner && !state.paused;
  $('#clue-form').classList.toggle('hidden', !showClueForm);
  const showEndTurn = isMyTurn && state.clue && !state.winner && !state.paused;
  $('#btn-end-turn').classList.toggle('hidden', !showEndTurn);
}

// ============================================================
// ALIAS
// ============================================================

function renderAliasTurnInfo() {
  const turnEl = $('#turn-indicator');
  if (state.phase === 'finished') { turnEl.textContent = ''; return; }

  const teamId = state.teams[state.currentTeamIndex];
  const info = state.teamInfo[teamId];
  const diffBadge = `<span class="alias-difficulty-badge alias-difficulty-${state.difficulty}">${state.difficulty === 'hard' ? 'сложный' : 'нормальный'}</span>`;

  const phaseText = { waiting: 'подготовка', explaining: 'объясняет', review: 'проверка' };
  const finalBadge = state.finalRound ? ' <span style="color:#e74c3c;font-weight:700">ФИНАЛ</span>' : '';
  turnEl.innerHTML = `${esc(info.name)} — ${phaseText[state.phase] || ''} ${diffBadge}${finalBadge}`;
  turnEl.style.color = info.color;
}

function renderAliasArea() {
  const area = $('#alias-area');
  area.innerHTML = '';

  const you = state.you;
  const isExplainer = you && you.id === state.explainerId;
  const isHost = you && you.id === state.hostId;
  const teamId = state.teams[state.currentTeamIndex];
  const info = state.teamInfo[teamId];
  const explainer = state.players.find((p) => p.id === state.explainerId);

  if (state.phase === 'waiting') {
    const nextExp = state.nextExplainerId ? state.players.find((p) => p.id === state.nextExplainerId) : null;
    const card = document.createElement('div');
    card.className = 'alias-waiting-card';
    if (nextExp) {
      card.innerHTML = `Объясняет: <strong style="color:${info.color}">${esc(nextExp.name)}</strong>`;
    } else {
      card.textContent = 'Нажмите "Старт" чтобы начать ход';
    }
    area.appendChild(card);

    const btn = document.createElement('button');
    btn.className = 'alias-btn alias-btn-start';
    btn.textContent = 'Старт';
    btn.onclick = () => send({ type: 'start-turn' });
    area.appendChild(btn);
  }

  if (state.phase === 'explaining') {
    const label = document.createElement('div');
    label.className = 'alias-explainer-label';
    label.innerHTML = `Объясняет: <span class="alias-explainer-name" style="color:${info.color}">${esc(explainer ? explainer.name : '???')}</span>`;
    area.appendChild(label);

    const card = document.createElement('div');
    card.className = 'alias-word-card';
    if (isExplainer) {
      card.textContent = state.currentWord;
      card.style.color = info.color;
    } else {
      card.textContent = 'Слово загадано...';
      card.style.color = '#555';
    }
    area.appendChild(card);

    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'alias-turn-score';
    scoreDiv.textContent = `Счёт хода: ${state.turnScore}`;
    scoreDiv.style.color = state.turnScore >= 0 ? '#2ecc71' : '#e74c3c';
    area.appendChild(scoreDiv);

    if (isExplainer) {
      const btns = document.createElement('div');
      btns.className = 'alias-buttons';
      const correctBtn = document.createElement('button');
      correctBtn.className = 'alias-btn alias-btn-correct';
      correctBtn.textContent = 'Угадано';
      correctBtn.onclick = () => send({ type: 'word-correct' });
      const skipBtn = document.createElement('button');
      skipBtn.className = 'alias-btn alias-btn-skip';
      skipBtn.textContent = state.skipPenalty ? 'Пропуск (-1)' : 'Пропуск';
      skipBtn.onclick = () => send({ type: 'word-skip' });
      btns.appendChild(correctBtn);
      btns.appendChild(skipBtn);
      area.appendChild(btns);
    }

    // Word list during explaining
    if (state.turnWords && state.turnWords.length > 0) {
      area.appendChild(renderAliasWordList(false));
    }
  }

  if (state.phase === 'review') {
    const label = document.createElement('div');
    label.className = 'alias-explainer-label';
    label.innerHTML = `Результаты хода — <span class="alias-explainer-name" style="color:${info.color}">${esc(explainer ? explainer.name : '???')}</span>`;
    area.appendChild(label);

    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'alias-turn-score';
    scoreDiv.textContent = `Итого: ${state.turnScore >= 0 ? '+' : ''}${state.turnScore}`;
    scoreDiv.style.color = state.turnScore >= 0 ? '#2ecc71' : '#e74c3c';
    area.appendChild(scoreDiv);

    if (state.turnWords) {
      area.appendChild(renderAliasWordList(true));
    }

    if (isHost || isExplainer) {
      const btn = document.createElement('button');
      btn.className = 'alias-confirm-btn';
      btn.textContent = 'Подтвердить';
      btn.onclick = () => send({ type: 'confirm-turn' });
      area.appendChild(btn);
    }
  }
}

// ============================================================
// SPYFALL
// ============================================================

function renderSpyfallTurnInfo() {
  const turnEl = $('#turn-indicator');
  if (state.sfPhase === 'finished') { turnEl.textContent = ''; return; }
  if (state.sfPhase === 'lobby') { turnEl.textContent = 'Ожидание игроков...'; turnEl.style.color = '#888'; return; }
  if (state.sfPhase === 'voting') { turnEl.textContent = 'Голосование'; turnEl.style.color = '#e74c3c'; return; }
  if (state.sfPhase === 'playing') {
    const asker = state.players.find((p) => p.id === state.currentAsker);
    turnEl.textContent = `Спрашивает: ${asker ? asker.name : '???'}`;
    turnEl.style.color = '#9b59b6';
  }
}

function renderSpyfallArea() {
  const area = $('#spyfall-area');
  area.innerHTML = '';
  const you = state.you;
  const isHost = you && you.id === state.hostId;

  if (state.sfPhase === 'lobby') {
    const inGame = state.players.filter((p) => p.team === 'player').length;
    const msg = document.createElement('div');
    msg.className = 'sf-lobby-msg';
    msg.textContent = inGame < 3
      ? `Нужно минимум 3 игрока (сейчас ${inGame})`
      : `Готово к старту! Игроков: ${inGame}`;
    area.appendChild(msg);

    if (isHost && inGame >= 3) {
      const btn = document.createElement('button');
      btn.className = 'sf-btn-start';
      btn.textContent = 'Начать игру';
      btn.onclick = () => send({ type: 'start-game' });
      area.appendChild(btn);
    }
    return;
  }

  if (state.sfPhase === 'playing' || state.sfPhase === 'voting') {
    // Role card
    if (you && you.team === 'player' && state.yourIsSpy !== undefined) {
      const card = document.createElement('div');
      card.className = 'spyfall-role-card ' + (state.yourIsSpy ? 'sf-spy' : 'sf-player');
      if (state.yourIsSpy) {
        card.innerHTML = `<div class="sf-location">Вы шпион</div><div class="sf-role">Узнайте локацию по вопросам!</div>`;
      } else {
        card.innerHTML = `<div class="sf-location">${esc(state.location || '???')}</div><div class="sf-role">${esc(state.yourRole || '')}</div>`;
      }
      area.appendChild(card);
    }

    if (state.sfPhase === 'voting' && state.accusation) {
      renderSpyfallVoting(area);
      return;
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'sf-actions';

    if (you && you.id === state.currentAsker) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'sf-btn-next';
      nextBtn.textContent = 'Передать ход';
      nextBtn.onclick = () => send({ type: 'next-turn' });
      actions.appendChild(nextBtn);
    }

    if (you && you.team === 'player') {
      const accuseBtn = document.createElement('button');
      accuseBtn.className = 'sf-btn-accuse';
      accuseBtn.textContent = 'Обвинить';
      accuseBtn.onclick = () => toggleAccuseList();
      actions.appendChild(accuseBtn);
    }

    area.appendChild(actions);

    // Accuse player list (hidden by default)
    const accuseList = document.createElement('div');
    accuseList.id = 'sf-accuse-list';
    accuseList.className = 'sf-accuse-list hidden';
    const gamePlayers = state.players.filter((p) => p.team === 'player' && p.id !== you?.id);
    for (const p of gamePlayers) {
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.onclick = () => send({ type: 'accuse', accusedId: p.id });
      accuseList.appendChild(btn);
    }
    area.appendChild(accuseList);

    // Location grid — always shown to all players
    if (state.allLocations && state.allLocations.length) {
      area.appendChild(renderSpyfallLocationGrid());
    }
    return;
  }

  if (state.sfPhase === 'finished') {
    renderSpyfallResults(area);
  }
}

function renderSpyfallVoting(area) {
  const acc = state.accusation;
  const accuser = state.players.find((p) => p.id === acc.accuserId);
  const accused = state.players.find((p) => p.id === acc.accusedId);
  const you = state.you;

  const panel = document.createElement('div');
  panel.className = 'sf-vote-panel';
  const q = document.createElement('div');
  q.className = 'sf-vote-question';
  q.innerHTML = `<strong>${esc(accuser?.name || '???')}</strong> обвиняет <strong>${esc(accused?.name || '???')}</strong> в шпионаже!`;
  panel.appendChild(q);

  const hasVoted = you && acc.votes[you.id] !== undefined;
  if (you && you.team === 'player' && !hasVoted) {
    const btns = document.createElement('div');
    btns.className = 'sf-vote-buttons';
    const yesBtn = document.createElement('button');
    yesBtn.className = 'sf-vote-yes';
    yesBtn.textContent = 'За';
    yesBtn.onclick = () => send({ type: 'vote-accuse', vote: true });
    const noBtn = document.createElement('button');
    noBtn.className = 'sf-vote-no';
    noBtn.textContent = 'Против';
    noBtn.onclick = () => send({ type: 'vote-accuse', vote: false });
    btns.appendChild(yesBtn);
    btns.appendChild(noBtn);
    panel.appendChild(btns);
  }

  const voted = Object.keys(acc.votes).length;
  const status = document.createElement('div');
  status.className = 'sf-vote-status';
  status.textContent = `Проголосовали: ${voted} / ${acc.totalPlayers}`;
  panel.appendChild(status);

  // Cancel button
  const isHost = you && you.id === state.hostId;
  if (you && (you.id === acc.accuserId || isHost)) {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'sf-btn-accuse';
    cancelBtn.style.marginTop = '10px';
    cancelBtn.textContent = 'Отменить обвинение';
    cancelBtn.onclick = () => send({ type: 'cancel-accusation' });
    panel.appendChild(cancelBtn);
  }

  area.appendChild(panel);
}

function renderSpyfallResults(area) {
  if (!state.allAssignments) return;

  const section = document.createElement('div');
  section.className = 'sf-result-section';
  const h4 = document.createElement('h4');
  h4.textContent = `Локация: ${state.location || '???'}`;
  section.appendChild(h4);

  for (const [id, info] of Object.entries(state.allAssignments)) {
    const p = state.players.find((pl) => pl.id === id);
    const entry = document.createElement('div');
    entry.className = 'sf-result-entry';
    if (info.isSpy) {
      entry.classList.add('sf-result-spy');
      entry.innerHTML = `<span>${esc(p?.name || id)} (ШПИОН)</span>`;
    } else {
      entry.innerHTML = `<span>${esc(p?.name || id)}</span><span style="color:#888">${esc(info.role)}</span>`;
    }
    section.appendChild(entry);
  }

  area.appendChild(section);
}

function toggleAccuseList() {
  const el = document.getElementById('sf-accuse-list');
  if (el) el.classList.toggle('hidden');
}

function renderSpyfallLocationGrid() {
  const grid = document.createElement('div');
  grid.id = 'sf-location-grid';
  grid.className = 'sf-location-grid';
  const isSpy = !!state.yourIsSpy;
  const activeSlug = state.locationSlug;
  for (const loc of state.allLocations) {
    const card = document.createElement(isSpy ? 'button' : 'div');
    card.className = 'sf-location-card';
    if (!isSpy && activeSlug && loc.slug === activeSlug) card.classList.add('sf-location-active');
    if (isSpy) {
      card.onclick = () => {
        if (confirm(`Угадать: ${loc.name}?`)) send({ type: 'spy-guess', locationSlug: loc.slug });
      };
    }
    if (loc.image) {
      const img = document.createElement('img');
      img.src = loc.image;
      img.alt = loc.name;
      img.loading = 'lazy';
      img.onerror = () => { img.style.display = 'none'; };
      card.appendChild(img);
    }
    const label = document.createElement('div');
    label.className = 'sf-location-label';
    label.textContent = loc.name;
    card.appendChild(label);
    grid.appendChild(card);
  }
  return grid;
}

// ============================================================
// Alias word list helper
function renderAliasWordList(editable) {
  const you = state.you;
  const isExplainer = you && you.id === state.explainerId;
  const isHost = you && you.id === state.hostId;
  const canEdit = editable && (isHost || isExplainer);
  const skipPenalty = state.skipPenalty;

  const review = document.createElement('div');
  review.className = 'alias-review';
  state.turnWords.forEach((w, i) => {
    const item = document.createElement('div');
    item.className = `alias-review-item alias-review-${w.result}`;
    const badge = w.result === 'correct' ? '+1' : (skipPenalty ? '-1' : '0');
    item.innerHTML = `<span class="alias-review-word">${esc(w.word)}</span><span class="alias-review-badge">${badge}</span>`;
    if (canEdit) {
      item.style.cursor = 'pointer';
      item.title = 'Нажмите чтобы изменить';
      item.onclick = () => send({ type: 'toggle-word-result', index: i });
    }
    review.appendChild(item);
  });
  return review;
}

// WHOAMI
// ============================================================

function renderWhoamiTurnInfo() {
  const turnEl = $('#turn-indicator');
  if (state.wmPhase === 'finished') { turnEl.textContent = ''; return; }
  if (state.wmPhase === 'setup') {
    const allReady = state.allReady;
    turnEl.textContent = allReady ? 'Все слова назначены — можно начинать!' : 'Назначьте слова всем игрокам';
    turnEl.style.color = allReady ? '#2ecc71' : '#f1c40f';
    return;
  }
  if (state.wmPhase === 'playing') {
    if (state.wmMode === 'turns' && state.currentTurnPlayer) {
      const p = state.players.find((pl) => pl.id === state.currentTurnPlayer);
      turnEl.textContent = `Ход: ${p ? p.name : '???'}`;
      turnEl.style.color = '#f1c40f';
    } else {
      turnEl.textContent = 'Свободный режим — обсуждайте!';
      turnEl.style.color = '#f1c40f';
    }
  }
}

let wmNotebookTimer = null;

function renderWhoamiArea() {
  const area = $('#whoami-area');
  area.innerHTML = '';
  const you = state.you;
  const isHost = you && you.id === state.hostId;
  const isPlayer = you && you.team === 'player';
  const assignments = state.assignments || {};

  // Player cards grid
  const grid = document.createElement('div');
  grid.className = 'wm-players-grid';

  const playerIds = Object.keys(assignments);
  for (const pid of playerIds) {
    const p = state.players.find((pl) => pl.id === pid);
    if (!p) continue;
    const a = assignments[pid];
    const isMe = you && pid === you.id;

    const card = document.createElement('div');
    card.className = 'wm-player-card';

    // Name
    const nameDiv = document.createElement('div');
    nameDiv.className = 'wm-player-name';
    nameDiv.textContent = p.name;
    if (state.finishedPlayers && state.finishedPlayers.includes(pid)) {
      const badge = document.createElement('span');
      badge.className = 'wm-finished-badge';
      badge.textContent = 'Угадал!';
      nameDiv.appendChild(badge);
    }
    card.appendChild(nameDiv);

    // Word tablet
    const tablet = document.createElement('div');
    tablet.className = 'wm-word-tablet';
    if (isMe) {
      tablet.classList.add('wm-you');
      if (a.word) {
        // Game finished or guessed — show word
        tablet.textContent = a.word;
        tablet.classList.remove('wm-you');
        tablet.style.color = '#2ecc71';
      } else {
        tablet.textContent = a.hasWord ? '???' : 'Ожидает слово...';
      }
    } else if (a.word) {
      tablet.textContent = a.word;
    } else {
      tablet.classList.add('wm-hidden');
      tablet.textContent = 'Нет слова';
    }
    card.appendChild(tablet);

    // Assign form (setup phase, can assign to others, not yourself)
    if (state.wmPhase === 'setup' && !isMe && isPlayer) {
      const form = document.createElement('div');
      form.className = 'wm-assign-form';
      const input = document.createElement('input');
      input.className = 'wm-assign-input';
      input.placeholder = 'Написать слово...';
      input.maxLength = 40;
      if (a.word) input.value = a.word;
      const btn = document.createElement('button');
      btn.className = 'wm-assign-btn';
      btn.textContent = a.word ? 'Изменить' : 'Записать';
      btn.onclick = () => {
        const word = input.value.trim();
        if (word) send({ type: 'assign-word', targetId: pid, word });
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
      form.appendChild(input);
      form.appendChild(btn);
      card.appendChild(form);
    }

    grid.appendChild(card);
  }
  area.appendChild(grid);

  // Start button (host, setup, all ready)
  if (state.wmPhase === 'setup' && isHost && state.allReady && playerIds.length >= 2) {
    const btn = document.createElement('button');
    btn.className = 'alias-btn alias-btn-start';
    btn.textContent = 'Начать игру';
    btn.onclick = () => send({ type: 'start-game' });
    area.appendChild(btn);
  }

  // Turns mode: guess + skip
  if (state.wmPhase === 'playing' && state.wmMode === 'turns' && isPlayer) {
    const isMyTurn = you && you.id === state.currentTurnPlayer;
    const alreadyGuessed = state.finishedPlayers && state.finishedPlayers.includes(you.id);

    if (isMyTurn && !alreadyGuessed) {
      const guessForm = document.createElement('div');
      guessForm.className = 'wm-guess-form';
      const input = document.createElement('input');
      input.className = 'wm-guess-input';
      input.placeholder = 'Моя догадка...';
      input.maxLength = 40;
      const guessBtn = document.createElement('button');
      guessBtn.className = 'wm-guess-btn';
      guessBtn.textContent = 'Угадать';
      guessBtn.onclick = () => {
        const word = input.value.trim();
        if (word) { send({ type: 'guess-word', word }); input.value = ''; }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') guessBtn.click(); });
      const skipBtn = document.createElement('button');
      skipBtn.className = 'wm-skip-btn';
      skipBtn.textContent = 'Пропустить';
      skipBtn.onclick = () => send({ type: 'skip-turn' });
      guessForm.appendChild(input);
      guessForm.appendChild(guessBtn);
      guessForm.appendChild(skipBtn);
      area.appendChild(guessForm);
    } else if (!isMyTurn && !alreadyGuessed) {
      const msg = document.createElement('div');
      msg.className = 'wm-status-msg';
      const tp = state.players.find((pl) => pl.id === state.currentTurnPlayer);
      msg.textContent = `Сейчас ход: ${tp ? tp.name : '???'}`;
      area.appendChild(msg);
    }
  }

  // Notebook (private, for players only)
  if (isPlayer && (state.wmPhase === 'playing' || state.wmPhase === 'setup')) {
    const nb = document.createElement('div');
    nb.className = 'wm-notebook';
    const h4 = document.createElement('h4');
    h4.textContent = 'Записная книжка (только вы видите)';
    nb.appendChild(h4);
    const textarea = document.createElement('textarea');
    textarea.value = state.notebook || '';
    textarea.placeholder = 'Заметки...';
    textarea.oninput = () => {
      clearTimeout(wmNotebookTimer);
      wmNotebookTimer = setTimeout(() => {
        send({ type: 'save-notebook', text: textarea.value });
      }, 500);
    };
    nb.appendChild(textarea);
    area.appendChild(nb);
  }
}

// ============================================================
// CROCODILE
// ============================================================

const CROC_COLORS = ['#000000','#e74c3c','#e67e22','#f1c40f','#2ecc71','#3498db','#9b59b6','#ecf0f1'];
let crocCanvas = null;
let crocCtx = null;
let crocDrawing = false;
let crocPoints = [];
let crocColor = '#000000';
let crocSize = 4;
let crocTool = 'pen';
let crocSendInterval = null;

function crocSetupCanvas(canvas, isDrawer) {
  crocCanvas = canvas;
  crocCtx = canvas.getContext('2d');
  // Set canvas resolution
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  crocCtx.scale(2, 2);
  crocCtx.lineCap = 'round';
  crocCtx.lineJoin = 'round';

  if (!isDrawer) { canvas.classList.add('readonly'); return; }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    crocDrawing = true;
    crocPoints = [crocGetPos(e)];
    crocCtx.beginPath();
    crocCtx.moveTo(crocPoints[0].x * rect.width, crocPoints[0].y * rect.height);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!crocDrawing) return;
    e.preventDefault();
    const pos = crocGetPos(e);
    crocPoints.push(pos);
    const prevPos = crocPoints[crocPoints.length - 2];
    crocCtx.strokeStyle = crocTool === 'eraser' ? '#ffffff' : crocColor;
    crocCtx.lineWidth = crocTool === 'eraser' ? crocSize * 3 : crocSize;
    crocCtx.beginPath();
    crocCtx.moveTo(prevPos.x * rect.width, prevPos.y * rect.height);
    crocCtx.lineTo(pos.x * rect.width, pos.y * rect.height);
    crocCtx.stroke();
  });

  const endDraw = () => {
    if (!crocDrawing) return;
    crocDrawing = false;
    if (crocPoints.length > 0) {
      send({ type: 'croc-draw', points: crocPoints, color: crocColor, size: crocSize, tool: crocTool });
      crocPoints = [];
    }
  };
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointerleave', endDraw);
  canvas.addEventListener('pointercancel', endDraw);
}

function crocGetPos(e) {
  const rect = crocCanvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
}

function crocDrawRemote(msg) {
  if (!crocCanvas || !crocCtx) return;
  const rect = crocCanvas.getBoundingClientRect();
  crocCtx.strokeStyle = msg.tool === 'eraser' ? '#ffffff' : msg.color;
  crocCtx.lineWidth = msg.tool === 'eraser' ? msg.size * 3 : msg.size;
  crocCtx.lineCap = 'round';
  crocCtx.lineJoin = 'round';
  if (msg.points.length < 2) return;
  crocCtx.beginPath();
  crocCtx.moveTo(msg.points[0].x * rect.width, msg.points[0].y * rect.height);
  for (let i = 1; i < msg.points.length; i++) {
    crocCtx.lineTo(msg.points[i].x * rect.width, msg.points[i].y * rect.height);
  }
  crocCtx.stroke();
}

function crocClearCanvas() {
  if (!crocCanvas || !crocCtx) return;
  const rect = crocCanvas.getBoundingClientRect();
  crocCtx.clearRect(0, 0, rect.width, rect.height);
}

function renderCrocodileTurnInfo() {
  const turnEl = $('#turn-indicator');
  if (state.crocPhase === 'finished') { turnEl.textContent = ''; return; }
  if (state.crocPhase === 'waiting') {
    const teamId = state.teams[state.currentTeamIndex];
    const info = state.teamInfo[teamId];
    turnEl.textContent = `${info.name} — подготовка`;
    turnEl.style.color = info.color;
    return;
  }
  if (state.crocPhase === 'drawing') {
    const teamId = state.teams[state.currentTeamIndex];
    const info = state.teamInfo[teamId];
    const drawer = state.players.find((p) => p.id === state.drawerId);
    turnEl.textContent = `${info.name} — рисует: ${drawer ? drawer.name : '???'}`;
    turnEl.style.color = info.color;
  }
}

let prevCrocPhase = null;

function renderCrocodileArea() {
  const area = $('#crocodile-area');
  const you = state.you;
  const isDrawer = you && you.id === state.drawerId;

  // Only rebuild DOM when phase changes to avoid killing canvas
  const phaseKey = state.crocPhase + ':' + state.drawerId;
  if (prevCrocPhase !== phaseKey) {
    prevCrocPhase = phaseKey;
    area.innerHTML = '';
    crocCanvas = null;
    crocCtx = null;

    if (state.crocPhase === 'waiting') {
      const card = document.createElement('div');
      card.className = 'croc-waiting-card';
      card.textContent = 'Нажмите "Старт" чтобы начать ход';
      area.appendChild(card);
      const btn = document.createElement('button');
      btn.className = 'alias-btn alias-btn-start';
      btn.textContent = 'Старт';
      btn.onclick = () => send({ type: 'start-turn' });
      area.appendChild(btn);
      return;
    }

    if (state.crocPhase === 'drawing') {
      // Word (drawer only)
      if (isDrawer && state.currentWord) {
        const wordEl = document.createElement('div');
        wordEl.className = 'croc-word-display';
        wordEl.id = 'croc-word';
        wordEl.textContent = state.currentWord;
        area.appendChild(wordEl);
      }

      // Canvas
      const wrap = document.createElement('div');
      wrap.className = 'croc-canvas-wrap';
      const canvas = document.createElement('canvas');
      canvas.className = 'croc-canvas';
      canvas.id = 'croc-canvas';
      wrap.appendChild(canvas);
      area.appendChild(wrap);

      // Toolbar (drawer only)
      if (isDrawer) {
        const toolbar = document.createElement('div');
        toolbar.className = 'croc-toolbar';

        for (const c of CROC_COLORS) {
          const swatch = document.createElement('div');
          swatch.className = 'croc-color' + (c === crocColor ? ' active' : '');
          swatch.style.background = c;
          swatch.onclick = () => {
            crocColor = c;
            crocTool = 'pen';
            toolbar.querySelectorAll('.croc-color').forEach((s) => s.classList.remove('active'));
            swatch.classList.add('active');
            toolbar.querySelector('.croc-eraser')?.classList.remove('active');
          };
          toolbar.appendChild(swatch);
        }

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'croc-size-slider';
        slider.min = '1';
        slider.max = '16';
        slider.value = String(crocSize);
        slider.oninput = () => { crocSize = parseInt(slider.value, 10); };
        toolbar.appendChild(slider);

        const eraserBtn = document.createElement('button');
        eraserBtn.className = 'croc-tool-btn croc-eraser';
        eraserBtn.textContent = 'Ластик';
        eraserBtn.onclick = () => {
          crocTool = crocTool === 'eraser' ? 'pen' : 'eraser';
          eraserBtn.classList.toggle('active', crocTool === 'eraser');
        };
        toolbar.appendChild(eraserBtn);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'croc-tool-btn';
        clearBtn.textContent = 'Очистить';
        clearBtn.onclick = () => { crocClearCanvas(); send({ type: 'croc-clear' }); };
        toolbar.appendChild(clearBtn);

        const skipBtn = document.createElement('button');
        skipBtn.className = 'croc-skip-btn';
        skipBtn.textContent = 'Пропустить (-1)';
        skipBtn.onclick = () => send({ type: 'croc-skip' });
        toolbar.appendChild(skipBtn);

        area.appendChild(toolbar);
      }

      // Guess area (non-drawer teammates)
      if (!isDrawer) {
        const guessArea = document.createElement('div');
        guessArea.className = 'croc-guess-area';

        const form = document.createElement('div');
        form.className = 'croc-guess-form';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'croc-guess-input';
        input.id = 'croc-guess-input';
        input.placeholder = 'Ваш ответ...';
        input.maxLength = 50;
        input.autocomplete = 'off';
        const sendBtn = document.createElement('button');
        sendBtn.className = 'croc-guess-send';
        sendBtn.textContent = 'Ответить';
        const submitGuess = () => {
          const text = input.value.trim();
          if (text) { send({ type: 'croc-guess', text }); input.value = ''; }
        };
        sendBtn.onclick = submitGuess;
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGuess(); });
        form.appendChild(input);
        form.appendChild(sendBtn);
        guessArea.appendChild(form);

        const log = document.createElement('div');
        log.className = 'croc-guess-log';
        log.id = 'croc-guess-log';
        guessArea.appendChild(log);

        area.appendChild(guessArea);
      }

      // Setup canvas after DOM is ready
      requestAnimationFrame(() => {
        const canvasEl = document.getElementById('croc-canvas');
        if (canvasEl) crocSetupCanvas(canvasEl, isDrawer);
      });

      return;
    }
  }

  // Update dynamic parts without rebuilding (guess log, word)
  if (state.crocPhase === 'drawing') {
    // Update word display
    if (isDrawer) {
      const wordEl = document.getElementById('croc-word');
      if (wordEl && state.currentWord) wordEl.textContent = state.currentWord;
    }

    // Update guess log
    const logEl = document.getElementById('croc-guess-log');
    if (logEl && state.guessLog) {
      logEl.innerHTML = '';
      for (const g of state.guessLog) {
        const item = document.createElement('div');
        item.className = 'croc-guess-item' + (g.correct ? ' correct' : '');
        item.innerHTML = `<span class="guess-name">${esc(g.playerName)}:</span> ${esc(g.text)}${g.correct ? ' ✓' : ''}`;
        logEl.appendChild(item);
      }
      logEl.scrollTop = logEl.scrollHeight;
    }
  }
}

// ============================================================
// MONOPOLY
// ============================================================

// Warm-paper v2 design tokens
const MP_TOKEN_COLORS = ['#c96442', '#3a5b8c', '#6b8e5a', '#a8894a', '#8b7dd6', '#5ab9c4', '#c96788', '#b85c3e'];
const MP_CORNER_PCT = 13;
const MP_CELL_PCT = (100 - MP_CORNER_PCT * 2) / 9;
const MP_CURRENCY = '₽';

// Slot-based helpers — slot indices are stable, players come and go.
function mpSlotColor(slot) {
  if (slot == null || slot < 0) return '#888';
  return MP_TOKEN_COLORS[slot % MP_TOKEN_COLORS.length];
}
function mpSlotInfo(slot) {
  if (slot == null || !state.slots) return null;
  return state.slots.find((s) => s.slot === slot) || null;
}
function mpSlotDisplayName(slot) {
  if (slot == null) return '—';
  const info = mpSlotInfo(slot);
  if (info && info.occupantName) return info.occupantName;
  return `Слот ${slot + 1}`;
}

function mpTileEdge(i) {
  if (i === 0 || i === 10 || i === 20 || i === 30) return 'corner';
  if (i < 10) return 'bottom';
  if (i < 20) return 'left';
  if (i < 30) return 'top';
  return 'right';
}

function mpTileGridPos(i) {
  if (i === 0) return { row: 11, col: 11 };
  if (i < 10) return { row: 11, col: 11 - i };
  if (i === 10) return { row: 11, col: 1 };
  if (i < 20) return { row: 21 - i, col: 1 };
  if (i === 20) return { row: 1, col: 1 };
  if (i < 30) return { row: 1, col: i - 19 };
  if (i === 30) return { row: 1, col: 11 };
  return { row: i - 29, col: 11 };
}

function mpCornerQuad(i) {
  return i === 0 ? 'br' : i === 10 ? 'bl' : i === 20 ? 'tl' : i === 30 ? 'tr' : null;
}

function mpTileCenterPct(i) {
  const edge = mpTileEdge(i);
  if (edge === 'corner') {
    if (i === 0) return { x: 100 - MP_CORNER_PCT / 2, y: 100 - MP_CORNER_PCT / 2 };
    if (i === 10) return { x: MP_CORNER_PCT / 2, y: 100 - MP_CORNER_PCT / 2 };
    if (i === 20) return { x: MP_CORNER_PCT / 2, y: MP_CORNER_PCT / 2 };
    if (i === 30) return { x: 100 - MP_CORNER_PCT / 2, y: MP_CORNER_PCT / 2 };
  }
  if (edge === 'bottom') {
    const along = 10 - i;
    return { x: MP_CORNER_PCT + (along - 0.5) * MP_CELL_PCT, y: 100 - MP_CORNER_PCT / 2 };
  }
  if (edge === 'top') {
    const along = i - 20;
    return { x: MP_CORNER_PCT + (along - 0.5) * MP_CELL_PCT, y: MP_CORNER_PCT / 2 };
  }
  if (edge === 'left') {
    // Positions 11..19 run UP the left column from jail toward parking,
    // so y must DECREASE as position increases (jail at bottom, parking at top).
    const along = i - 10;
    return { x: MP_CORNER_PCT / 2, y: 100 - MP_CORNER_PCT - (along - 0.5) * MP_CELL_PCT };
  }
  // right
  const along = i - 30;
  return { x: 100 - MP_CORNER_PCT / 2, y: MP_CORNER_PCT + (along - 0.5) * MP_CELL_PCT };
}

function mpCornerText(type) {
  if (type === 'go') return { title: 'СТАРТ', sub: 'забери 200' };
  if (type === 'jail') return { title: 'ТЮРЬМА', sub: 'в гостях' };
  if (type === 'parking') return { title: 'ПАРКОВКА', sub: 'отдых' };
  if (type === 'go_to_jail') return { title: 'В ТЮРЬМУ', sub: 'без права бросать' };
  return { title: type, sub: '' };
}

function mpTokenLetter(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

// Currently-selected tile (persists across renders)
let mpSelectedTile = null;

// Trade builder UI state — only persists across renders while the modal is open.
let mpTradeOpen = false;
let mpTradeDraft = null;  // { toId, fromMoney, toMoney, fromSlugs:Set, toSlugs:Set }
let mpTradeError = '';

// Token animation state.
// Tokens persist across renders so CSS transitions and step-by-step walking work.
let mpTokenLayer = null;      // <div class="mp-tokens-layer">
const mpTokens = {};          // pid → element
const mpDisplayed = {};       // pid → currently shown board position (0-39)
const mpAnimating = {};       // pid → true while walking
const mpPendingTarget = {};   // pid → latest target if a move arrived during animation
const MP_STEP_MS = 180;       // per-tile walking delay (matches token CSS transition)
const MP_JUMP_MS = 320;       // direct slide duration for big jumps

// Dice animation state — persistent dice container so animations span renders.
let mpDiceContainer = null;
let mpPrevDice = null;
let mpDiceAnimToken = 0;

// Chance/Chest card overlay state.
let mpLastSeenCardKey;          // undefined until first state arrives
let mpCardBannerVisible = false;
let mpCardBannerTimer = null;

function mpDieDots(value) {
  const positions = {
    1: [[10, 10]],
    2: [[5, 5], [15, 15]],
    3: [[5, 5], [10, 10], [15, 15]],
    4: [[5, 5], [15, 5], [5, 15], [15, 15]],
    5: [[5, 5], [15, 5], [10, 10], [5, 15], [15, 15]],
    6: [[5, 5], [15, 5], [5, 10], [15, 10], [5, 15], [15, 15]],
  };
  const dots = positions[value] || [];
  const svg = `<svg class="mp-die-svg${value ? '' : ' is-empty'}" viewBox="0 0 20 20">${dots.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.6"/>`).join('')}</svg>`;
  return svg;
}

function mpFormatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mpFindTileByIndex(idx) {
  return state.board.find((s) => s.index === idx);
}

function mpCountHoldings(slot) {
  let n = 0;
  if (!state.ownership) return 0;
  for (const o of Object.values(state.ownership)) if (o === slot) n++;
  return n;
}

function renderMonopolyTurnInfo() {
  const turnEl = $('#turn-indicator');
  if (state.mpPhase !== 'playing') { turnEl.textContent = ''; return; }
  const cur = state.currentSlot;
  if (cur == null) { turnEl.textContent = ''; return; }
  const isYou = state.mySlot === cur;
  let suffix = '';
  if (state.mpTurn === 'jail-decision') suffix = ' (в тюрьме)';
  else if (state.mpTurn === 'rolling') suffix = ' — бросок';
  else if (state.mpTurn === 'action') suffix = ' — действие';
  turnEl.textContent = (isYou ? 'Твой ход' : `Ход: ${mpSlotDisplayName(cur)}`) + suffix;
  turnEl.style.color = mpSlotColor(cur);
}

function renderMonopolyArea() {
  const area = $('#monopoly-area');
  area.innerHTML = '';
  const you = state.you;

  // Default selected tile = current player's position (when game running)
  if (mpSelectedTile == null && state.currentSlot != null) {
    const ps = state.slotState && state.slotState[state.currentSlot];
    mpSelectedTile = ps ? ps.position : 0;
  }

  const grid = document.createElement('div');
  grid.className = 'mp-page-grid';
  grid.appendChild(mpBuildLeftAside());
  grid.appendChild(mpBuildBoardCol(you));
  grid.appendChild(mpBuildRightAside());

  area.appendChild(grid);

  // Card draw banner — detect new lastCard and show for ~4s
  const cardKey = state.lastCard ? `${state.lastCard.id}-${state.lastCard.ts}` : '';
  if (mpLastSeenCardKey === undefined) {
    mpLastSeenCardKey = cardKey;
  } else if (cardKey && cardKey !== mpLastSeenCardKey) {
    mpLastSeenCardKey = cardKey;
    mpCardBannerVisible = true;
    if (mpCardBannerTimer) clearTimeout(mpCardBannerTimer);
    mpCardBannerTimer = setTimeout(() => { mpCardBannerVisible = false; render(); }, 4000);
  }
  if (mpCardBannerVisible && state.lastCard) {
    area.appendChild(mpBuildCardBanner(state.lastCard));
  }

  // Trade overlays — sit above the grid
  if (state.mpPhase === 'playing' && state.mySlot != null) {
    const t = state.activeTrade;
    if (t && t.toSlot === state.mySlot) {
      area.appendChild(mpBuildIncomingTradeModal(t));
    } else if (t && t.fromSlot === state.mySlot) {
      area.appendChild(mpBuildPendingTradeBanner(t));
    } else if (mpTradeOpen) {
      area.appendChild(mpBuildTradeBuilderModal());
    }
  } else {
    mpTradeOpen = false;
    mpTradeDraft = null;
    mpTradeError = '';
  }
}

function mpBuildLeftAside() {
  const aside = document.createElement('div');
  aside.className = 'mp-aside-left';

  const isPlaying = state.mpPhase === 'playing' || state.mpPhase === 'finished';
  const slots = state.slots || [];
  const maxSlots = state.maxSlots || slots.length || 4;
  const filledSlotsCount = slots.filter((s) => s.occupantId).length;
  const mySlot = state.mySlot;

  // Slots section
  const slotsSection = document.createElement('div');
  const h1 = document.createElement('div');
  h1.className = 'mp-aside-h';
  h1.textContent = isPlaying ? 'Игроки' : 'Слоты';
  slotsSection.appendChild(h1);

  const counter = document.createElement('div');
  counter.className = 'mp-aside-counter';
  counter.textContent = `${filledSlotsCount}/${maxSlots}`;
  slotsSection.appendChild(counter);

  const rows = document.createElement('div');
  rows.className = 'mp-player-rows';

  for (let i = 0; i < maxSlots; i++) {
    const slotInfo = slots.find((s) => s.slot === i);
    const occupantId = slotInfo ? slotInfo.occupantId : null;
    const occupantName = slotInfo ? slotInfo.occupantName : null;
    const online = slotInfo ? slotInfo.online : false;
    const ps = state.slotState ? state.slotState[i] : null;
    const isMine = mySlot === i;

    const row = document.createElement('div');
    row.className = 'mp-player-row';

    if (occupantId) {
      // Filled slot
      if (isPlaying && i === state.currentSlot) row.classList.add('is-active');
      if (ps && ps.bankrupt) row.classList.add('is-bankrupt');
      if (!online) row.classList.add('is-offline');

      const dot = document.createElement('div');
      dot.className = 'mp-prow-dot';
      dot.style.background = mpSlotColor(i);
      row.appendChild(dot);

      const main = document.createElement('div');
      main.className = 'mp-prow-main';
      const nameRow = document.createElement('div');
      nameRow.className = 'mp-prow-name-row';
      const nm = document.createElement('span');
      nm.className = 'mp-prow-name';
      nm.textContent = occupantName || `Слот ${i + 1}`;
      nameRow.appendChild(nm);
      if (isMine) {
        const tag = document.createElement('span');
        tag.className = 'mp-prow-tag';
        tag.textContent = 'вы';
        nameRow.appendChild(tag);
      }
      if (ps && ps.inJail) {
        const tag = document.createElement('span');
        tag.className = 'mp-prow-tag';
        tag.textContent = '🔒';
        nameRow.appendChild(tag);
      }
      if (!online) {
        const tag = document.createElement('span');
        tag.className = 'mp-prow-tag mp-prow-tag-offline';
        tag.textContent = 'офлайн';
        nameRow.appendChild(tag);
      }
      main.appendChild(nameRow);

      const stats = document.createElement('div');
      stats.className = 'mp-prow-stats';
      if (isPlaying && ps) {
        const holdings = mpCountHoldings(i);
        stats.innerHTML = `<span class="mp-money"><span class="mp-cur">${MP_CURRENCY}</span>${ps.money.toLocaleString('ru-RU')}</span> · ${holdings} ${holdings === 1 ? 'компания' : holdings >= 2 && holdings <= 4 ? 'компании' : 'компаний'}`;
      } else {
        stats.innerHTML = `<span class="mp-prow-tag">слот ${i + 1}</span>`;
      }
      main.appendChild(stats);
      row.appendChild(main);

      // Leave button (only when in lobby, only for self)
      if (!isPlaying && isMine) {
        const leaveBtn = document.createElement('button');
        leaveBtn.className = 'mp-slot-leave';
        leaveBtn.textContent = '×';
        leaveBtn.title = 'Выйти из слота';
        leaveBtn.onclick = (ev) => { ev.stopPropagation(); send({ type: 'pick-team', team: null }); };
        row.appendChild(leaveBtn);
      }
    } else {
      // Empty slot
      row.classList.add('is-empty-slot');
      const dot = document.createElement('div');
      dot.className = 'mp-prow-dot';
      dot.style.background = mpSlotColor(i);
      dot.style.opacity = '0.35';
      row.appendChild(dot);

      const emptyMain = document.createElement('div');
      emptyMain.className = 'mp-prow-main mp-empty-main';
      const slotLabel = document.createElement('div');
      slotLabel.className = 'mp-slot-label';
      slotLabel.textContent = `Слот ${i + 1}`;
      emptyMain.appendChild(slotLabel);

      if (!isPlaying && mySlot == null) {
        const joinBtn = document.createElement('button');
        joinBtn.className = 'mp-slot-join';
        joinBtn.textContent = 'Занять';
        joinBtn.onclick = () => send({ type: 'pick-team', team: 'player', slot: i });
        emptyMain.appendChild(joinBtn);
      } else if (!isPlaying) {
        const note = document.createElement('div');
        note.className = 'mp-slot-empty-note';
        note.textContent = 'свободно';
        emptyMain.appendChild(note);
      } else {
        const note = document.createElement('div');
        note.className = 'mp-slot-empty-note';
        note.textContent = '—';
        emptyMain.appendChild(note);
      }
      row.appendChild(emptyMain);
    }
    rows.appendChild(row);
  }
  slotsSection.appendChild(rows);
  aside.appendChild(slotsSection);

  // Activity section (only show if there's any history or game running)
  if (state.log && state.log.length) {
    const activitySection = document.createElement('div');
    const h2 = document.createElement('div');
    h2.className = 'mp-aside-h';
    h2.textContent = 'Активность';
    activitySection.appendChild(h2);

    const log = document.createElement('div');
    log.className = 'mp-activity';
    const recent = state.log.slice(-12).reverse();
    for (const entry of recent) {
      const line = document.createElement('div');
      line.className = 'mp-act-line';
      const time = document.createElement('span');
      time.className = 'mp-act-time';
      time.textContent = mpFormatTime(entry.ts);
      line.appendChild(time);
      const text = document.createElement('span');
      text.className = 'mp-act-text';
      text.textContent = entry.text;
      line.appendChild(text);
      log.appendChild(line);
    }
    activitySection.appendChild(log);
    aside.appendChild(activitySection);
  }

  return aside;
}

function mpBuildBoardCol(you) {
  const col = document.createElement('div');
  col.className = 'mp-board-col';

  const boardWrap = document.createElement('div');
  boardWrap.className = 'mp-board-wrap';
  const board = document.createElement('div');
  board.className = 'mp-board';

  for (const sq of state.board) {
    board.appendChild(mpBuildTile(sq));
  }

  // Center: just brand decoration (dice/actions/log moved out)
  const center = document.createElement('div');
  center.className = 'mp-board-center';

  const brand = document.createElement('div');
  brand.className = 'mp-brand';
  brand.textContent = state.deckName || 'Монополия';
  center.appendChild(brand);

  const sub = document.createElement('div');
  sub.className = 'mp-brand-sub';
  sub.textContent = 'корпоративная лига';
  center.appendChild(sub);

  board.appendChild(center);
  mpEnsureTokenLayer(board);
  mpUpdateTokens();

  boardWrap.appendChild(board);
  col.appendChild(boardWrap);

  // Action bar below the board
  col.appendChild(mpBuildActionBar(you));

  return col;
}

function mpBuildActionBar(you) {
  const bar = document.createElement('div');
  bar.className = 'mp-action-bar';

  const isHost = you && you.id === state.hostId;
  const isLobby = state.mpPhase === 'lobby';
  const slots = state.slots || [];
  const slotsFilled = slots.filter((s) => s.occupantId).length;
  const maxSlots = state.maxSlots || 4;
  const mySlot = state.mySlot;
  const isMyTurn = mySlot != null && mySlot === state.currentSlot;

  const status = document.createElement('div');
  status.className = 'mp-action-status';
  const label = document.createElement('div');
  label.className = 'mp-action-status-label';
  const name = document.createElement('div');
  name.className = 'mp-action-status-name';

  if (isLobby) {
    label.textContent = 'Ожидание';
    if (slotsFilled < 2) name.textContent = `${slotsFilled}/${maxSlots} · нужно ≥2`;
    else if (slotsFilled < maxSlots) name.textContent = `${slotsFilled}/${maxSlots} · можно стартовать`;
    else name.textContent = `${slotsFilled}/${maxSlots} · все слоты заняты`;
  } else {
    label.textContent = isMyTurn ? 'Ваш ход' : 'Сейчас ходит';
    name.textContent = state.currentSlot != null ? mpSlotDisplayName(state.currentSlot) : '—';
  }
  status.appendChild(label);
  status.appendChild(name);
  bar.appendChild(status);

  // Dice (persistent across renders so animation can span them)
  mpEnsureDice(bar);
  mpUpdateDice();

  // Action buttons
  const btns = document.createElement('div');
  btns.className = 'mp-action-btns';

  if (isLobby) {
    if (isHost && slotsFilled >= 2 && slotsFilled <= 8) {
      const b = document.createElement('button');
      b.className = 'mp-cta mp-cta-primary';
      b.textContent = 'Начать игру';
      b.onclick = () => send({ type: 'start-game' });
      btns.appendChild(b);
    } else {
      const wait = document.createElement('div');
      wait.style.cssText = 'font-family: var(--mp-mono); font-size: 11px; color: var(--mp-muted-ink); letter-spacing: 1px; text-transform: uppercase;';
      wait.textContent = mySlot == null ? 'выбери слот слева' : (isHost ? 'нужно ≥2 игрока' : 'ждём старта');
      btns.appendChild(wait);
    }
    bar.appendChild(btns);
    return bar;
  }

  if (isMyTurn && state.mpPhase === 'playing') {
    const ps = state.slotState && state.slotState[mySlot];
    if (state.mpTurn === 'rolling') {
      const b = document.createElement('button');
      b.className = 'mp-cta mp-cta-primary';
      b.textContent = 'Бросить';
      b.onclick = () => send({ type: 'roll-dice' });
      btns.appendChild(b);
    } else if (state.mpTurn === 'jail-decision') {
      const r = document.createElement('button');
      r.className = 'mp-cta mp-cta-primary';
      r.textContent = 'Бросать на дубль';
      r.onclick = () => send({ type: 'roll-dice' });
      btns.appendChild(r);
      if (ps && ps.money >= 50) {
        const p = document.createElement('button');
        p.className = 'mp-cta mp-cta-secondary';
        p.textContent = `Заплатить ${MP_CURRENCY}50`;
        p.onclick = () => send({ type: 'pay-jail' });
        btns.appendChild(p);
      }
    } else if (state.mpTurn === 'action') {
      if (state.pendingBuy) {
        const canAfford = ps && ps.money >= state.pendingBuy.price;
        const b = document.createElement('button');
        b.className = 'mp-cta mp-cta-danger';
        b.textContent = `Купить за ${MP_CURRENCY}${state.pendingBuy.price}`;
        b.disabled = !canAfford;
        b.onclick = () => send({ type: 'buy-property' });
        btns.appendChild(b);
        const s = document.createElement('button');
        s.className = 'mp-cta mp-cta-secondary';
        s.textContent = 'Отказаться';
        s.onclick = () => send({ type: 'skip-buy' });
        btns.appendChild(s);
      } else {
        const e = document.createElement('button');
        e.className = 'mp-cta mp-cta-primary';
        const rolledDouble = state.dice && state.dice[0] === state.dice[1] && state.doublesCount > 0 && state.doublesCount < 3;
        e.textContent = rolledDouble ? 'Бросить ещё' : 'Завершить ход';
        e.onclick = () => send({ type: 'end-turn' });
        btns.appendChild(e);
      }
    }
  } else {
    const wait = document.createElement('div');
    wait.style.cssText = 'font-family: var(--mp-mono); font-size: 11px; color: var(--mp-muted-ink); letter-spacing: 1px; text-transform: uppercase;';
    wait.textContent = 'ждём ход';
    btns.appendChild(wait);
  }
  bar.appendChild(btns);

  // Trade button — visible to any non-bankrupt active player during the game.
  if (state.mpPhase === 'playing' && mySlot != null) {
    const myPs = state.slotState && state.slotState[mySlot];
    const inGame = myPs && !myPs.bankrupt;
    if (inGame && !state.activeTrade) {
      const tradeBtn = document.createElement('button');
      tradeBtn.className = 'mp-cta mp-cta-secondary mp-cta-trade';
      tradeBtn.textContent = 'Сделка';
      tradeBtn.onclick = () => { mpTradeOpen = true; render(); };
      bar.appendChild(tradeBtn);
    }
  }

  return bar;
}

function mpBuildRightAside() {
  const aside = document.createElement('div');
  aside.className = 'mp-aside-right';

  const isPlaying = state.mpPhase === 'playing' || state.mpPhase === 'finished';
  const sq = mpSelectedTile != null ? mpFindTileByIndex(mpSelectedTile) : null;

  // DEED panel (only when playing or a tile is selected during lobby)
  if (isPlaying || sq) {
    aside.appendChild(mpBuildDeedPanel(sq));
  }

  // Spectators section
  aside.appendChild(mpBuildSpectatorsSection());

  return aside;
}

function mpBuildSpectatorsSection() {
  const section = document.createElement('div');
  const h = document.createElement('div');
  h.className = 'mp-aside-h';
  h.textContent = 'Зрители';
  section.appendChild(h);

  const spectators = state.players.filter((p) => !p.team);
  const counter = document.createElement('div');
  counter.className = 'mp-spec-counter';
  counter.textContent = `${spectators.length}`;
  section.appendChild(counter);

  if (spectators.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mp-spec-empty';
    empty.textContent = 'никого';
    section.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'mp-spec-list';
    for (const p of spectators) {
      const row = document.createElement('div');
      row.className = 'mp-spec-row';
      row.textContent = p.name + (state.you && state.you.id === p.id ? ' · вы' : '');
      list.appendChild(row);
    }
    section.appendChild(list);
  }
  return section;
}

function mpBuildDeedPanel(sq) {
  const wrap = document.createElement('div');
  if (!sq) {
    wrap.innerHTML = '<div class="mp-aside-h">Клетка</div><div class="mp-spec-empty">Выбери клетку на доске</div>';
    return wrap;
  }
  // Continue with deed rendering (re-using the original code below)
  return mpRenderDeedInto(wrap, sq);
}

function mpRenderDeedInto(aside, sq) {

  const h = document.createElement('div');
  h.className = 'mp-aside-h';
  h.textContent = sq.type === 'property' ? 'Свидетельство' : sq.type === 'transport' ? 'Транспорт' : sq.type === 'utility' ? 'Ресурс' : 'Клетка';
  aside.appendChild(h);

  // Group color strip (only for property)
  if (sq.color) {
    const strip = document.createElement('div');
    strip.className = 'mp-deed-strip';
    strip.style.setProperty('--mp-deed-color', sq.color);
    aside.appendChild(strip);
  }

  // Group name (small caps) — only for property
  if (sq.type === 'property' && state.groups && sq.group) {
    const grp = state.groups[sq.group];
    if (grp) {
      const g = document.createElement('div');
      g.className = 'mp-deed-group';
      g.textContent = grp.name;
      aside.appendChild(g);
    }
  }

  const title = document.createElement('div');
  title.className = 'mp-deed-title';
  title.textContent = sq.name || (sq.type === 'go' ? 'Старт' : sq.type === 'jail' ? 'Тюрьма' : sq.type === 'parking' ? 'Парковка' : sq.type === 'go_to_jail' ? 'В тюрьму' : sq.type === 'chance' ? 'Шанс' : sq.type === 'chest' ? 'Казна' : sq.type === 'tax' ? 'Налог' : '—');
  aside.appendChild(title);

  // Type-specific info
  const rows = document.createElement('div');
  rows.className = 'mp-deed-rows';

  if (sq.type === 'property' || sq.type === 'transport' || sq.type === 'utility') {
    const ownerSlot = sq.slug ? state.ownership[sq.slug] : null;
    const houses = sq.slug && state.houses ? (state.houses[sq.slug] || 0) : 0;
    rows.appendChild(mpDeedRow('Цена', `<span class="mp-cur">${MP_CURRENCY}</span>${sq.price}`));
    rows.appendChild(mpDeedRow('Владелец', ownerSlot != null ? mpSlotDisplayName(ownerSlot) : '—'));
    if (sq.type === 'property') {
      const housesText = houses === 5 ? 'Отель' : `${houses}`;
      rows.appendChild(mpDeedRow('Домов', housesText));
    }
  } else if (sq.type === 'tax') {
    rows.appendChild(mpDeedRow('Сумма', `<span class="mp-cur">−${MP_CURRENCY}</span>${sq.amount}`));
  } else if (sq.type === 'go') {
    rows.appendChild(mpDeedRow('Бонус', `<span class="mp-cur">+${MP_CURRENCY}</span>200`));
  } else if (sq.type === 'go_to_jail') {
    rows.appendChild(mpDeedRow('Эффект', 'отправить в тюрьму'));
  }
  aside.appendChild(rows);

  // Rent schedule (property)
  if (sq.type === 'property' && sq.rent) {
    const h2 = document.createElement('div');
    h2.className = 'mp-aside-h';
    h2.textContent = 'Рента';
    aside.appendChild(h2);
    const rentTable = document.createElement('div');
    rentTable.className = 'mp-rent-table';
    const labels = ['База', '1 дом', '2 дома', '3 дома', '4 дома', 'Отель'];
    const houses = sq.slug && state.houses ? (state.houses[sq.slug] || 0) : 0;
    const ownerSlot = sq.slug ? state.ownership[sq.slug] : null;
    // Owner without houses + full group → 2× base rent (highlight that fact)
    const ownsAllInGroup = ownerSlot != null && state.board
      .filter((s) => s.type === 'property' && s.group === sq.group)
      .every((s) => state.ownership[s.slug] === ownerSlot);
    for (let i = 0; i < sq.rent.length; i++) {
      const r = document.createElement('div');
      r.className = 'mp-rent-row';
      if (i === houses) r.classList.add('is-current');
      const isBaseDouble = i === 0 && houses === 0 && ownsAllInGroup;
      const value = isBaseDouble ? sq.rent[0] * 2 : sq.rent[i];
      const note = isBaseDouble ? ' <span class="mp-rent-note">×2</span>' : '';
      r.innerHTML = `<span class="mp-rent-label">${labels[i]}</span><span class="mp-rent-val"><span class="mp-cur">${MP_CURRENCY}</span>${value}${note}</span>`;
      rentTable.appendChild(r);
    }
    aside.appendChild(rentTable);

    // Build/sell controls — only for the current player on their own property when they own the group
    const mySlot = state.mySlot;
    const isMine = ownerSlot != null && mySlot != null && ownerSlot === mySlot;
    const isMyTurn = mySlot != null && mySlot === state.currentSlot && state.mpPhase === 'playing';
    if (isMine && isMyTurn && ownsAllInGroup && !state.pendingBuy) {
      const groupSlugs = state.board.filter((s) => s.type === 'property' && s.group === sq.group).map((s) => s.slug);
      const groupHouses = groupSlugs.map((s) => (state.houses && state.houses[s]) || 0);
      const minInGroup = Math.min(...groupHouses);
      const maxInGroup = Math.max(...groupHouses);
      const ps = state.slotState && state.slotState[mySlot];

      const canBuild = houses < 5 && houses === minInGroup && ps && ps.money >= (sq.house || 0);
      const canSell = houses > 0 && houses === maxInGroup;
      // We need the house cost — it's in the deck, not directly on the tile. Pull from board square if present.
      const houseCost = sq.house || 0;

      const ctrls = document.createElement('div');
      ctrls.className = 'mp-deed-actions';
      const buildBtn = document.createElement('button');
      buildBtn.className = 'mp-cta mp-cta-primary';
      buildBtn.textContent = houses === 4 ? `Отель · ${MP_CURRENCY}${houseCost}` : `Дом · ${MP_CURRENCY}${houseCost}`;
      buildBtn.disabled = !(houses < 5 && houses === minInGroup && ps && ps.money >= houseCost);
      buildBtn.onclick = () => send({ type: 'build-house', slug: sq.slug });
      ctrls.appendChild(buildBtn);
      const sellBtn = document.createElement('button');
      sellBtn.className = 'mp-cta mp-cta-secondary';
      sellBtn.textContent = `Продать · +${MP_CURRENCY}${Math.floor(houseCost / 2)}`;
      sellBtn.disabled = !canSell;
      sellBtn.onclick = () => send({ type: 'sell-house', slug: sq.slug });
      ctrls.appendChild(sellBtn);
      aside.appendChild(ctrls);
    }
  }

  // Transport rent ladder
  if (sq.type === 'transport') {
    const h2 = document.createElement('div');
    h2.className = 'mp-aside-h';
    h2.textContent = 'Рента (по числу владений)';
    aside.appendChild(h2);
    const tbl = document.createElement('div');
    tbl.className = 'mp-rent-table';
    const rates = [25, 50, 100, 200];
    for (let i = 0; i < 4; i++) {
      const r = document.createElement('div');
      r.className = 'mp-rent-row';
      r.innerHTML = `<span class="mp-rent-label">${i + 1} ${i === 0 ? 'владение' : 'владения'}</span><span class="mp-rent-val"><span class="mp-cur">${MP_CURRENCY}</span>${rates[i]}</span>`;
      tbl.appendChild(r);
    }
    aside.appendChild(tbl);
  }

  if (sq.type === 'utility') {
    const h2 = document.createElement('div');
    h2.className = 'mp-aside-h';
    h2.textContent = 'Рента';
    aside.appendChild(h2);
    const tbl = document.createElement('div');
    tbl.className = 'mp-rent-table';
    tbl.innerHTML = `
      <div class="mp-rent-row"><span class="mp-rent-label">1 ресурс</span><span class="mp-rent-val">×4 от кубика</span></div>
      <div class="mp-rent-row"><span class="mp-rent-label">2 ресурса</span><span class="mp-rent-val">×10 от кубика</span></div>`;
    aside.appendChild(tbl);
  }

  return aside;
}

function mpBuildCardBanner(card) {
  const wrap = document.createElement('div');
  wrap.className = 'mp-card-banner mp-card-banner-' + card.deck;
  wrap.onclick = () => { mpCardBannerVisible = false; if (mpCardBannerTimer) clearTimeout(mpCardBannerTimer); render(); };

  const inner = document.createElement('div');
  inner.className = 'mp-card-banner-inner';

  const label = document.createElement('div');
  label.className = 'mp-card-banner-label';
  label.textContent = card.deck === 'chance' ? 'Шанс' : 'Казна';
  inner.appendChild(label);

  const text = document.createElement('div');
  text.className = 'mp-card-banner-text';
  text.textContent = card.text;
  inner.appendChild(text);

  const sub = document.createElement('div');
  sub.className = 'mp-card-banner-sub';
  const drawerName = card.slot != null ? mpSlotDisplayName(card.slot) : '';
  sub.textContent = drawerName ? `тянет: ${drawerName}` : '';
  inner.appendChild(sub);

  wrap.appendChild(inner);
  return wrap;
}

function mpDeedRow(label, val) {
  const r = document.createElement('div');
  r.className = 'mp-deed-row';
  r.innerHTML = `<span class="mp-deed-row-label">${label}</span><span class="mp-deed-row-val">${val}</span>`;
  return r;
}

// ============================================================
// MONOPOLY TRADES (UI)
// ============================================================

function mpResetTradeDraft(toSlot) {
  mpTradeDraft = {
    toSlot: toSlot != null ? toSlot : null,
    fromMoney: 0,
    toMoney: 0,
    fromSlugs: new Set(),
    toSlugs: new Set(),
  };
}

function mpListOwned(slot) {
  const owned = [];
  if (slot == null || !state.ownership || !state.board) return owned;
  for (const slug of Object.keys(state.ownership)) {
    if (state.ownership[slug] !== slot) continue;
    const sq = state.board.find((s) => s.slug === slug);
    if (sq) owned.push(sq);
  }
  return owned;
}

// True if any property in this property's group has houses on it.
function mpGroupHasHouses(slug) {
  const sq = state.board.find((s) => s.slug === slug);
  if (!sq || sq.type !== 'property' || !sq.group) return false;
  const groupSlugs = state.board.filter((s) => s.type === 'property' && s.group === sq.group).map((s) => s.slug);
  return groupSlugs.some((s) => (state.houses && state.houses[s]) > 0);
}

function mpBuildTradeBuilderModal() {
  const mySlot = state.mySlot;
  if (mySlot == null) return document.createDocumentFragment();
  if (!mpTradeDraft) mpResetTradeDraft(null);

  const overlay = document.createElement('div');
  overlay.className = 'mp-modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) { mpTradeOpen = false; mpTradeDraft = null; render(); } };

  const modal = document.createElement('div');
  modal.className = 'mp-modal mp-trade-modal';

  const head = document.createElement('div');
  head.className = 'mp-modal-head';
  head.innerHTML = `<div class="mp-modal-title">Сделка</div><div class="mp-modal-sub">Выбери игрока и составь предложение</div>`;
  modal.appendChild(head);

  // Counterparties = other slots in turnOrder, not bankrupt, with an occupant
  const counterparties = (state.turnOrder || [])
    .filter((s) => s !== mySlot && state.slotState && state.slotState[s] && !state.slotState[s].bankrupt)
    .filter((s) => {
      const info = state.slots && state.slots.find((x) => x.slot === s);
      return info && info.occupantId; // require an occupant for now
    });

  if (counterparties.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mp-modal-empty';
    empty.textContent = 'Нет других игроков';
    modal.appendChild(empty);
  } else {
    const chips = document.createElement('div');
    chips.className = 'mp-trade-chips';
    for (const s of counterparties) {
      const chip = document.createElement('button');
      chip.className = 'mp-trade-chip' + (mpTradeDraft.toSlot === s ? ' is-active' : '');
      chip.style.setProperty('--mp-chip-color', mpSlotColor(s));
      chip.textContent = mpSlotDisplayName(s);
      chip.onclick = () => {
        if (mpTradeDraft.toSlot !== s) mpResetTradeDraft(s);
        render();
      };
      chips.appendChild(chip);
    }
    modal.appendChild(chips);

    if (mpTradeDraft.toSlot != null) {
      const grid = document.createElement('div');
      grid.className = 'mp-trade-grid';
      grid.appendChild(mpBuildTradeColumn('Отдаю', mySlot, true));
      grid.appendChild(mpBuildTradeColumn('Получаю', mpTradeDraft.toSlot, false));
      modal.appendChild(grid);
    }
  }

  if (mpTradeError) {
    const err = document.createElement('div');
    err.className = 'mp-modal-error';
    err.textContent = mpTradeError;
    modal.appendChild(err);
  }

  const foot = document.createElement('div');
  foot.className = 'mp-modal-foot';
  const cancel = document.createElement('button');
  cancel.className = 'mp-cta mp-cta-secondary';
  cancel.textContent = 'Отмена';
  cancel.onclick = () => { mpTradeOpen = false; mpTradeDraft = null; mpTradeError = ''; render(); };
  foot.appendChild(cancel);

  const submit = document.createElement('button');
  submit.className = 'mp-cta mp-cta-primary';
  submit.textContent = 'Отправить';
  const draftEmpty = mpTradeDraft.toSlot == null
    || (mpTradeDraft.fromMoney === 0 && mpTradeDraft.toMoney === 0
        && mpTradeDraft.fromSlugs.size === 0 && mpTradeDraft.toSlugs.size === 0);
  submit.disabled = draftEmpty;
  submit.onclick = () => {
    mpTradeError = '';
    send({
      type: 'trade-propose',
      toSlot: mpTradeDraft.toSlot,
      fromMoney: mpTradeDraft.fromMoney,
      toMoney: mpTradeDraft.toMoney,
      fromSlugs: [...mpTradeDraft.fromSlugs],
      toSlugs: [...mpTradeDraft.toSlugs],
    });
    mpTradeOpen = false;
  };
  foot.appendChild(submit);
  modal.appendChild(foot);

  overlay.appendChild(modal);
  return overlay;
}

function mpBuildTradeColumn(title, ownerSlot, isMine) {
  const col = document.createElement('div');
  col.className = 'mp-trade-col';

  const h = document.createElement('div');
  h.className = 'mp-trade-col-title';
  h.textContent = title;
  col.appendChild(h);

  const ps = state.slotState && state.slotState[ownerSlot];
  const cap = ps ? ps.money : 0;

  // Money input
  const moneyRow = document.createElement('div');
  moneyRow.className = 'mp-trade-money';
  const moneyLabel = document.createElement('span');
  moneyLabel.className = 'mp-trade-money-label';
  moneyLabel.textContent = `Деньги (макс ${MP_CURRENCY}${cap})`;
  moneyRow.appendChild(moneyLabel);
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = String(cap);
  input.value = String(isMine ? mpTradeDraft.fromMoney : mpTradeDraft.toMoney);
  input.oninput = () => {
    let v = parseInt(input.value, 10);
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (v > cap) v = cap;
    if (isMine) mpTradeDraft.fromMoney = v;
    else mpTradeDraft.toMoney = v;
  };
  input.onblur = () => render();
  moneyRow.appendChild(input);
  col.appendChild(moneyRow);

  // Property list
  const list = document.createElement('div');
  list.className = 'mp-trade-list';
  const owned = mpListOwned(ownerSlot);
  if (owned.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mp-trade-empty';
    empty.textContent = 'Нет владений';
    list.appendChild(empty);
  }
  const set = isMine ? mpTradeDraft.fromSlugs : mpTradeDraft.toSlugs;
  for (const sq of owned) {
    const item = document.createElement('label');
    item.className = 'mp-trade-item';
    const blocked = sq.type === 'property' && mpGroupHasHouses(sq.slug);
    if (blocked) item.classList.add('is-blocked');
    if (set.has(sq.slug)) item.classList.add('is-selected');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = set.has(sq.slug);
    cb.disabled = blocked;
    cb.onchange = () => { if (cb.checked) set.add(sq.slug); else set.delete(sq.slug); render(); };
    item.appendChild(cb);
    if (sq.color) {
      const strip = document.createElement('span');
      strip.className = 'mp-trade-item-strip';
      strip.style.background = sq.color;
      item.appendChild(strip);
    }
    const name = document.createElement('span');
    name.className = 'mp-trade-item-name';
    name.textContent = sq.name;
    if (blocked) name.title = 'на группе есть постройки';
    item.appendChild(name);
    list.appendChild(item);
  }
  col.appendChild(list);

  return col;
}

function mpBuildIncomingTradeModal(trade) {
  const overlay = document.createElement('div');
  overlay.className = 'mp-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'mp-modal mp-trade-modal mp-trade-incoming';

  const fromName = mpSlotDisplayName(trade.fromSlot);

  const head = document.createElement('div');
  head.className = 'mp-modal-head';
  head.innerHTML = `<div class="mp-modal-title">Сделка от ${esc(fromName)}</div>`;
  modal.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'mp-trade-grid';
  grid.appendChild(mpRenderTradeSummary('Они отдают', trade.fromOffer));
  grid.appendChild(mpRenderTradeSummary('Вы отдаёте', trade.toOffer));
  modal.appendChild(grid);

  const foot = document.createElement('div');
  foot.className = 'mp-modal-foot';
  const decline = document.createElement('button');
  decline.className = 'mp-cta mp-cta-secondary';
  decline.textContent = 'Отклонить';
  decline.onclick = () => send({ type: 'trade-respond', accept: false });
  foot.appendChild(decline);
  const accept = document.createElement('button');
  accept.className = 'mp-cta mp-cta-primary';
  accept.textContent = 'Принять';
  accept.onclick = () => send({ type: 'trade-respond', accept: true });
  foot.appendChild(accept);
  modal.appendChild(foot);

  overlay.appendChild(modal);
  return overlay;
}

function mpRenderTradeSummary(title, offer) {
  const col = document.createElement('div');
  col.className = 'mp-trade-col mp-trade-col-summary';
  const h = document.createElement('div');
  h.className = 'mp-trade-col-title';
  h.textContent = title;
  col.appendChild(h);

  const m = document.createElement('div');
  m.className = 'mp-trade-summary-money';
  m.innerHTML = `<span class="mp-cur">${MP_CURRENCY}</span>${offer.money || 0}`;
  col.appendChild(m);

  const list = document.createElement('div');
  list.className = 'mp-trade-list';
  const slugs = offer.slugs || [];
  if (slugs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mp-trade-empty';
    empty.textContent = 'Без собственности';
    list.appendChild(empty);
  }
  for (const slug of slugs) {
    const sq = state.board.find((s) => s.slug === slug);
    if (!sq) continue;
    const item = document.createElement('div');
    item.className = 'mp-trade-item is-summary';
    if (sq.color) {
      const strip = document.createElement('span');
      strip.className = 'mp-trade-item-strip';
      strip.style.background = sq.color;
      item.appendChild(strip);
    }
    const name = document.createElement('span');
    name.className = 'mp-trade-item-name';
    name.textContent = sq.name;
    item.appendChild(name);
    list.appendChild(item);
  }
  col.appendChild(list);
  return col;
}

function mpBuildPendingTradeBanner(trade) {
  const wrap = document.createElement('div');
  wrap.className = 'mp-trade-pending-banner';
  const toName = mpSlotDisplayName(trade.toSlot);
  const text = document.createElement('span');
  text.textContent = `Сделка отправлена ${toName}. Ждём ответа…`;
  wrap.appendChild(text);
  const cancel = document.createElement('button');
  cancel.className = 'mp-cta mp-cta-secondary';
  cancel.textContent = 'Отозвать';
  cancel.onclick = () => send({ type: 'trade-cancel' });
  wrap.appendChild(cancel);
  return wrap;
}

function mpBuildTile(sq) {
  const edge = mpTileEdge(sq.index);
  const gp = mpTileGridPos(sq.index);
  const tile = document.createElement('div');
  tile.className = `mp-tile mp-tile-${edge}`;
  tile.style.gridRow = gp.row;
  tile.style.gridColumn = gp.col;
  if (mpSelectedTile === sq.index) tile.classList.add('is-selected');
  tile.onclick = () => { mpSelectedTile = sq.index; render(); };

  // Owner frame color via custom prop (slot-keyed)
  const ownerSlot = sq.slug ? state.ownership[sq.slug] : null;
  if (ownerSlot != null) {
    tile.dataset.ownerColor = '1';
    tile.style.setProperty('--mp-owner-color', mpSlotColor(ownerSlot));
  }

  if (edge === 'corner') {
    tile.classList.add('mp-tile-corner-' + mpCornerQuad(sq.index));
    const body = document.createElement('div');
    body.className = 'mp-corner-body';
    const t = mpCornerText(sq.type);
    const title = document.createElement('div');
    title.className = 'mp-corner-title';
    title.textContent = t.title;
    body.appendChild(title);
    if (t.sub) {
      const sub = document.createElement('div');
      sub.className = 'mp-corner-sub';
      sub.textContent = t.sub;
      body.appendChild(sub);
    }
    tile.appendChild(body);
    return tile;
  }

  const inner = document.createElement('div');
  inner.className = 'mp-tile-inner';

  const card = document.createElement('div');
  card.className = 'mp-tile-card';

  // Glyph / logo
  const glyph = document.createElement('div');
  glyph.className = 'mp-tile-glyph';
  if (sq.image) {
    const img = document.createElement('img');
    img.src = sq.image;
    img.alt = sq.name || '';
    img.loading = 'lazy';
    img.onerror = () => { img.style.display = 'none'; glyph.textContent = mpTokenLetter(sq.name); glyph.style.fontFamily = 'var(--mp-serif)'; glyph.style.fontSize = '24px'; };
    glyph.appendChild(img);
  } else {
    // Fallback: big letter for properties/transport/utility, symbol for special
    if (sq.type === 'property' || sq.type === 'transport' || sq.type === 'utility') {
      glyph.textContent = mpTokenLetter(sq.name);
      glyph.style.fontFamily = 'var(--mp-serif)';
      glyph.style.fontSize = '26px';
      glyph.style.color = sq.color || 'var(--mp-ink)';
    } else if (sq.type === 'chance' || sq.type === 'chest') {
      glyph.textContent = '?';
      glyph.style.fontFamily = 'var(--mp-serif)';
      glyph.style.fontStyle = 'italic';
      glyph.style.fontSize = '28px';
      glyph.style.color = 'var(--mp-accent)';
    } else if (sq.type === 'tax') {
      glyph.textContent = '₽';
      glyph.style.fontFamily = 'var(--mp-serif)';
      glyph.style.fontSize = '26px';
      glyph.style.color = 'var(--mp-muted-ink)';
    }
  }
  card.appendChild(glyph);

  // Name band (hover reveal)
  const name = document.createElement('div');
  name.className = 'mp-tile-name';
  name.textContent = sq.name || '';
  card.appendChild(name);

  // Houses / hotel from current state
  const houseCount = sq.slug && state.houses ? (state.houses[sq.slug] || 0) : 0;
  if (houseCount > 0) {
    const houses = document.createElement('div');
    houses.className = 'mp-tile-houses';
    if (houseCount === 5) {
      const hotel = document.createElement('div');
      hotel.className = 'mp-tile-hotel';
      houses.appendChild(hotel);
    } else {
      for (let k = 0; k < houseCount; k++) {
        const h = document.createElement('div');
        h.className = 'mp-tile-house';
        houses.appendChild(h);
      }
    }
    card.appendChild(houses);
  }

  inner.appendChild(card);

  // Price tab
  const priceVal = sq.price != null ? sq.price : (sq.type === 'tax' ? sq.amount : null);
  if (priceVal != null) {
    const tab = document.createElement('div');
    tab.className = 'mp-tile-tab';
    if (sq.type === 'property' && sq.color) {
      tab.dataset.group = sq.group || '1';
      tab.style.setProperty('--mp-tab-color', sq.color);
    }
    const cur = document.createElement('span');
    cur.className = 'mp-tab-cur';
    cur.textContent = MP_CURRENCY;
    tab.appendChild(cur);
    tab.appendChild(document.createTextNode(String(priceVal)));
    inner.appendChild(tab);
  }

  tile.appendChild(inner);
  return tile;
}

// Persistent token layer — created once per session, reattached to the
// current board element on every render so tokens survive board rebuilds.
function mpEnsureTokenLayer(boardEl) {
  if (!mpTokenLayer || !mpTokenLayer.isConnected) {
    if (!mpTokenLayer) {
      mpTokenLayer = document.createElement('div');
      mpTokenLayer.className = 'mp-tokens-layer';
    }
  }
  if (mpTokenLayer.parentElement !== boardEl) {
    boardEl.appendChild(mpTokenLayer);
  }
  return mpTokenLayer;
}

function mpUpdateTokens() {
  if (!mpTokenLayer) return;
  // Tokens are keyed by SLOT INDEX (as string for object-key purposes).
  const present = new Set((state.turnOrder || []).map(String));

  // Remove tokens for slots no longer in turnOrder (game restart, etc.)
  for (const key of Object.keys(mpTokens)) {
    if (!present.has(key)) {
      mpTokens[key].remove();
      delete mpTokens[key];
      delete mpDisplayed[key];
      delete mpAnimating[key];
      delete mpPendingTarget[key];
    }
  }

  // Ensure a token element exists for each slot in play & sync look
  for (const slot of (state.turnOrder || [])) {
    const key = String(slot);
    const ps = state.slotState && state.slotState[slot];
    if (!ps) continue;
    let tok = mpTokens[key];
    if (!tok) {
      tok = document.createElement('div');
      tok.className = 'mp-token';
      tok.dataset.slot = slot;
      mpTokenLayer.appendChild(tok);
      mpTokens[key] = tok;
    }
    tok.style.background = mpSlotColor(slot);
    const occName = mpSlotDisplayName(slot);
    tok.title = occName;
    tok.textContent = mpTokenLetter(occName);
    tok.classList.toggle('mp-token-active', slot === state.currentSlot && state.mpPhase === 'playing');
    tok.classList.toggle('mp-token-bankrupt', !!ps.bankrupt);

    if (mpDisplayed[key] === undefined) {
      mpDisplayed[key] = ps.position;
    } else if (mpDisplayed[key] !== ps.position) {
      mpStartWalk(key, ps.position);
    }
  }

  mpPlaceAllTokens();
}

function mpPlaceAllTokens() {
  // Compute per-tile stacks from currently-displayed positions, ignoring tokens
  // currently animating (they're driven by rAF and shouldn't be disturbed).
  const byTile = {};
  for (const pid of Object.keys(mpTokens)) {
    if (mpAnimating[pid]) continue;
    const pos = mpDisplayed[pid];
    if (pos === undefined) continue;
    (byTile[pos] = byTile[pos] || []).push(pid);
  }
  for (const pid of Object.keys(mpTokens)) {
    if (mpAnimating[pid]) continue;
    const tok = mpTokens[pid];
    const pos = mpDisplayed[pid];
    if (pos === undefined) continue;
    const stack = byTile[pos] || [];
    const idx = Math.max(0, stack.indexOf(pid));
    const off = (idx - (stack.length - 1) / 2) * 2.2;
    const edge = mpTileEdge(pos);
    let ox = 0, oy = 0;
    if (edge === 'bottom' || edge === 'top') ox = off;
    else if (edge === 'left' || edge === 'right') oy = off;
    else { ox = off * 0.7; oy = off * 0.7; }
    const { x, y } = mpTileCenterPct(pos);
    tok.style.left = (x + ox) + '%';
    tok.style.top = (y + oy) + '%';
  }
}

function mpEnsureDice(holder) {
  if (!mpDiceContainer) {
    mpDiceContainer = document.createElement('div');
    mpDiceContainer.className = 'mp-action-dice';
    mpDiceContainer.innerHTML = mpDieDots(0) + mpDieDots(0);
  }
  if (mpDiceContainer.parentElement !== holder) {
    holder.appendChild(mpDiceContainer);
  }
}

function mpRenderDiceFinal(d1, d2) {
  if (!mpDiceContainer) return;
  mpDiceContainer.classList.remove('is-rolling');
  mpDiceContainer.innerHTML = mpDieDots(d1) + mpDieDots(d2);
}

function mpUpdateDice() {
  if (!mpDiceContainer) return;
  const cur = state.dice;
  const prev = mpPrevDice;
  if (!cur) {
    mpDiceAnimToken++; // cancel any in-flight animation
    mpDiceContainer.classList.remove('is-rolling');
    mpDiceContainer.innerHTML = mpDieDots(0) + mpDieDots(0);
    mpPrevDice = null;
    return;
  }
  const changed = !prev || prev[0] !== cur[0] || prev[1] !== cur[1];
  if (!changed) {
    mpRenderDiceFinal(cur[0], cur[1]);
    return;
  }
  mpPrevDice = [cur[0], cur[1]];
  // Roll animation: cycle random faces ~700ms, then settle on real value
  const myToken = ++mpDiceAnimToken;
  const start = performance.now();
  const duration = 700;
  mpDiceContainer.classList.add('is-rolling');
  const tick = () => {
    if (myToken !== mpDiceAnimToken) return;
    if (!mpDiceContainer) return;
    const elapsed = performance.now() - start;
    if (elapsed >= duration) {
      mpRenderDiceFinal(cur[0], cur[1]);
      return;
    }
    const r1 = 1 + Math.floor(Math.random() * 6);
    const r2 = 1 + Math.floor(Math.random() * 6);
    mpDiceContainer.innerHTML = mpDieDots(r1) + mpDieDots(r2);
    setTimeout(tick, 65);
  };
  tick();
}

async function mpStartWalk(pid, target) {
  if (mpAnimating[pid]) {
    mpPendingTarget[pid] = target;
    return;
  }
  mpAnimating[pid] = true;
  let from = mpDisplayed[pid];
  let to = target;
  while (from !== to) {
    const dist = (to - from + 40) % 40;
    if (dist === 0) break;
    if (dist > 12) {
      await mpJumpTo(pid, to);
      mpDisplayed[pid] = to;
      from = to;
    } else {
      await mpWalkSegment(pid, from, dist);
      from = (from + dist) % 40;
      mpDisplayed[pid] = from;
    }
    mpPlaceAllTokens(); // settle other tokens around new resting position
    if (mpPendingTarget[pid] !== undefined) {
      to = mpPendingTarget[pid];
      delete mpPendingTarget[pid];
    }
  }
  mpAnimating[pid] = false;
  mpPlaceAllTokens(); // final stack-offset re-application
}

// Smooth interpolation along the path through `steps` cells, using rAF.
// The token glides continuously, picking up board edges naturally because
// successive cell centers are adjacent.
function mpWalkSegment(pid, fromPos, steps) {
  return new Promise((resolve) => {
    const tok = mpTokens[pid];
    if (!tok) { resolve(); return; }
    const waypoints = [mpTileCenterPct(fromPos)];
    for (let s = 1; s <= steps; s++) waypoints.push(mpTileCenterPct((fromPos + s) % 40));

    tok.style.transition = 'none'; // we drive every frame; CSS transition would lag
    const totalMs = steps * MP_STEP_MS;
    const startTs = performance.now();
    const segCount = waypoints.length - 1;

    const tick = () => {
      const elapsed = performance.now() - startTs;
      const tRaw = Math.min(1, elapsed / totalMs);
      // Slight ease-out so the last steps feel like settling
      const t = 1 - Math.pow(1 - tRaw, 1.4);
      const segPos = t * segCount;
      const segIdx = Math.min(segCount - 1, Math.floor(segPos));
      const localT = segPos - segIdx;
      const a = waypoints[segIdx];
      const b = waypoints[segIdx + 1];
      tok.style.left = (a.x + (b.x - a.x) * localT) + '%';
      tok.style.top = (a.y + (b.y - a.y) * localT) + '%';
      if (tRaw < 1) {
        requestAnimationFrame(tick);
      } else {
        const last = waypoints[waypoints.length - 1];
        tok.style.left = last.x + '%';
        tok.style.top = last.y + '%';
        tok.style.transition = '';
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

// Direct slide for big jumps (jail teleport, restart). Uses CSS transition.
function mpJumpTo(pid, target) {
  return new Promise((resolve) => {
    const tok = mpTokens[pid];
    if (!tok) { resolve(); return; }
    const dest = mpTileCenterPct(target);
    tok.style.transition = `left ${MP_JUMP_MS}ms cubic-bezier(.5,.1,.5,1.05), top ${MP_JUMP_MS}ms cubic-bezier(.5,.1,.5,1.05)`;
    // Force reflow so the transition actually triggers from current to new value.
    void tok.offsetWidth;
    tok.style.left = dest.x + '%';
    tok.style.top = dest.y + '%';
    setTimeout(() => { tok.style.transition = ''; resolve(); }, MP_JUMP_MS + 30);
  });
}

// ============================================================
// SHARED: Player panel
// ============================================================

function renderPlayerPanel() {
  const panel = $('#player-panel');
  panel.innerHTML = '';
  const you = state.you;
  const gm = state.gameMode;
  const canSwitch = you && (gm === 'alias' || gm === 'spyfall' || gm === 'crocodile' || gm === 'whoami' || gm === 'monopoly' || !state.paused);

  if (gm === 'spyfall' || gm === 'whoami' || gm === 'monopoly') {
    // Single player list block
    const inGame = state.players.filter((p) => p.team === 'player');
    const block = document.createElement('div');
    block.className = 'player-team-block';
    block.style.background = 'rgba(155,89,182,0.08)';
    block.style.borderLeft = '3px solid #9b59b6';
    const h4 = document.createElement('h4');
    h4.textContent = 'Игроки';
    h4.style.color = '#9b59b6';
    block.appendChild(h4);
    const opList = document.createElement('div');
    opList.className = 'operative-list';
    for (const p of inGame) {
      const entry = document.createElement('div');
      entry.className = 'operative-entry';
      entry.textContent = p.name;
      if (p.id === state.currentAsker && state.sfPhase === 'playing') {
        entry.style.fontWeight = '700';
        entry.textContent = '\u2605 ' + p.name;
      }
      opList.appendChild(entry);
    }
    block.appendChild(opList);
    if (you && you.team !== 'player') {
      const btn = document.createElement('button');
      btn.className = 'btn-spectate';
      btn.textContent = 'Вступить в игру';
      btn.onclick = () => send({ type: 'pick-team', team: 'player' });
      block.appendChild(btn);
    }
    panel.appendChild(block);

    // Spectators
    const spectators = state.players.filter((p) => !p.team);
    const specBlock = document.createElement('div');
    specBlock.className = 'spectators-block';
    specBlock.innerHTML = `<h4>\uD83D\uDC41 Зрители (${spectators.length})</h4>`;
    for (const p of spectators) {
      const entry = document.createElement('div');
      entry.className = 'spectator-entry';
      entry.textContent = p.name;
      specBlock.appendChild(entry);
    }
    if (you && you.team === 'player') {
      const btn = document.createElement('button');
      btn.className = 'btn-spectate';
      btn.textContent = 'Стать зрителем';
      btn.onclick = () => send({ type: 'pick-team', team: null });
      specBlock.appendChild(btn);
    }
    panel.appendChild(specBlock);
    return;
  }

  for (const teamId of state.teams) {
    const info = state.teamInfo[teamId];
    const block = document.createElement('div');
    block.className = 'player-team-block';
    block.style.background = hexToRgba(info.color, 0.08);
    block.style.borderLeft = `3px solid ${info.color}`;

    const h4 = document.createElement('h4');
    h4.textContent = info.name;
    h4.style.color = info.color;
    block.appendChild(h4);

    if (gm === 'codenames') {
      // Spymaster slot
      const spySlot = document.createElement('div');
      spySlot.className = 'spymaster-slot';
      const slotLabel = document.createElement('span');
      slotLabel.className = 'slot-label';
      slotLabel.textContent = '\u2605 Ведущий:';
      spySlot.appendChild(slotLabel);
      const spy = state.players.find((p) => p.team === teamId && p.role === 'spymaster');
      const slotName = document.createElement('span');
      slotName.className = 'slot-name';
      slotName.textContent = spy ? spy.name : '\u2014';
      slotName.style.color = spy ? '#eee' : '#555';
      spySlot.appendChild(slotName);
      block.appendChild(spySlot);

      // Operatives
      const ops = state.players.filter((p) => p.team === teamId && p.role === 'operative');
      const opList = document.createElement('div');
      opList.className = 'operative-list';
      for (const p of ops) {
        const entry = document.createElement('div');
        entry.className = 'operative-entry';
        entry.textContent = p.name;
        opList.appendChild(entry);
      }
      block.appendChild(opList);

      // Codenames action buttons
      if (canSwitch) {
        const actions = document.createElement('div');
        actions.className = 'team-actions';
        const inThisTeam = you.team === teamId;
        if (!inThisTeam || you.role !== 'operative') {
          const btn = document.createElement('button');
          btn.textContent = 'Отгадывающий';
          btn.onclick = () => send({ type: 'pick-team', team: teamId, role: 'operative' });
          actions.appendChild(btn);
        }
        const spyTaken = spy && spy.id !== you.id;
        if ((!inThisTeam || you.role !== 'spymaster') && !spyTaken) {
          const btn = document.createElement('button');
          btn.textContent = '\u2605 Ведущий';
          btn.onclick = () => send({ type: 'pick-team', team: teamId, role: 'spymaster' });
          actions.appendChild(btn);
        }
        block.appendChild(actions);
      }
    } else {
      // Alias: flat player list
      const teamPlayers = state.players.filter((p) => p.team === teamId);
      const opList = document.createElement('div');
      opList.className = 'operative-list';
      for (const p of teamPlayers) {
        const entry = document.createElement('div');
        entry.className = 'operative-entry';
        const isHighlighted = (p.id === state.explainerId && state.phase === 'explaining')
          || (p.id === state.drawerId && state.crocPhase === 'drawing');
        if (isHighlighted) {
          entry.style.fontWeight = '700';
          entry.textContent = '\u2605 ' + p.name;
        } else {
          entry.textContent = p.name;
        }
        opList.appendChild(entry);
      }
      block.appendChild(opList);

      if (canSwitch && you.team !== teamId) {
        const btn = document.createElement('button');
        btn.className = 'btn-spectate';
        btn.textContent = 'Вступить';
        btn.onclick = () => send({ type: 'pick-team', team: teamId });
        block.appendChild(btn);
      }
    }

    panel.appendChild(block);
  }

  // Spectators
  const spectators = state.players.filter((p) => !p.team);
  const specBlock = document.createElement('div');
  specBlock.className = 'spectators-block';
  const specH4 = document.createElement('h4');
  specH4.textContent = `\uD83D\uDC41 Зрители (${spectators.length})`;
  specBlock.appendChild(specH4);
  for (const p of spectators) {
    const entry = document.createElement('div');
    entry.className = 'spectator-entry';
    entry.textContent = p.name;
    specBlock.appendChild(entry);
  }
  if (you && you.team) {
    const btn = document.createElement('button');
    btn.className = 'btn-spectate';
    btn.textContent = 'Стать зрителем';
    btn.onclick = () => send({ type: 'pick-team', team: null });
    specBlock.appendChild(btn);
  }
  panel.appendChild(specBlock);
}

// ===== Pause overlay =====
function renderPauseOverlay() {
  const overlay = $('#pause-overlay');
  const isPaused = state.gameMode === 'codenames' ? state.paused : state.paused;
  const isFinished = state.gameMode === 'alias' ? state.phase === 'finished' : !!state.winner;

  if (!isPaused || isFinished) { overlay.classList.add('hidden'); return; }
  overlay.classList.remove('hidden');

  const you = state.you;
  const isHost = you && you.id === state.hostId;
  let settingsEl = overlay.querySelector('.pause-settings');

  if (isHost) {
    if (!settingsEl) {
      settingsEl = document.createElement('div');
      settingsEl.className = 'pause-settings';
      overlay.querySelector('.pause-content').appendChild(settingsEl);
    }
    settingsEl.classList.remove('hidden');

    if (state.gameMode === 'codenames') {
      settingsEl.innerHTML = `
        <label>Команды <select id="ps-teams"><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label>
        <label>Строки <select id="ps-rows"><option value="4">4</option><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option></select></label>
        <label>Столбцы <select id="ps-cols"><option value="4">4</option><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option></select></label>
        <label>Таймер <select id="ps-timer"><option value="0">Выкл</option><option value="30">30с</option><option value="60">60с</option><option value="90">90с</option><option value="120">120с</option><option value="180">180с</option></select></label>
        <button id="btn-ps-apply">Применить (новая игра)</button>
      `;
      settingsEl.querySelector('#ps-teams').value = state.settings.teamCount;
      settingsEl.querySelector('#ps-rows').value = state.settings.gridRows;
      settingsEl.querySelector('#ps-cols').value = state.settings.gridCols;
      settingsEl.querySelector('#ps-timer').value = state.settings.timerDuration;
      settingsEl.querySelector('#btn-ps-apply').onclick = () => {
        send({ type: 'update-settings',
          teamCount: settingsEl.querySelector('#ps-teams').value,
          gridRows: settingsEl.querySelector('#ps-rows').value,
          gridCols: settingsEl.querySelector('#ps-cols').value,
          timerDuration: settingsEl.querySelector('#ps-timer').value,
        });
      };
    } else {
      settingsEl.innerHTML = `
        <label>Команды <select id="ps-teams"><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label>
        <label>Таймер <select id="ps-timer"><option value="30">30с</option><option value="45">45с</option><option value="60">60с</option><option value="90">90с</option><option value="120">120с</option></select></label>
        <label>Цель <select id="ps-target"><option value="15">15</option><option value="20">20</option><option value="30">30</option><option value="50">50</option><option value="75">75</option><option value="100">100</option></select></label>
        <label>Сложность <select id="ps-diff"><option value="normal">Нормальная</option><option value="hard">Сложная</option></select></label>
        <button id="btn-ps-apply">Применить (новая игра)</button>
      `;
      settingsEl.querySelector('#ps-teams').value = state.settings.teamCount;
      settingsEl.querySelector('#ps-timer').value = state.settings.timerDuration;
      settingsEl.querySelector('#ps-target').value = state.settings.targetScore;
      settingsEl.querySelector('#ps-diff').value = state.settings.difficulty;
      settingsEl.querySelector('#btn-ps-apply').onclick = () => {
        send({ type: 'update-settings',
          teamCount: settingsEl.querySelector('#ps-teams').value,
          timerDuration: settingsEl.querySelector('#ps-timer').value,
          targetScore: settingsEl.querySelector('#ps-target').value,
          difficulty: settingsEl.querySelector('#ps-diff').value,
        });
      };
    }
  } else if (settingsEl) {
    settingsEl.classList.add('hidden');
  }
}

// ===== Winner overlay =====
function renderWinnerOverlay() {
  const overlay = $('#winner-overlay');
  const screen = $('#game-screen');
  const hasWinner = state.gameMode === 'alias' ? state.phase === 'finished'
    : state.gameMode === 'spyfall' ? state.sfPhase === 'finished'
    : state.gameMode === 'crocodile' ? state.crocPhase === 'finished'
    : state.gameMode === 'whoami' ? state.wmPhase === 'finished'
    : state.gameMode === 'monopoly' ? state.mpPhase === 'finished'
    : !!state.winner;

  if (!hasWinner) {
    overlay.classList.add('hidden');
    screen.style.paddingTop = '';
    return;
  }
  overlay.classList.remove('hidden');
  screen.style.paddingTop = '90px';

  const text = $('#winner-text');

  if (state.gameMode === 'whoami') {
    if (state.winner) {
      const w = state.players.find((p) => p.id === state.winner);
      text.textContent = `${w ? w.name : '???'} угадал первым!`;
    } else {
      text.textContent = 'Игра окончена!';
    }
    text.style.color = '#f1c40f';
    return;
  }

  if (state.gameMode === 'monopoly') {
    if (state.winner != null) {
      text.textContent = `${mpSlotDisplayName(state.winner)} — победитель!`;
    } else {
      text.textContent = 'Игра окончена!';
    }
    text.style.color = '#f1c40f';
    return;
  }

  if (state.gameMode === 'spyfall') {
    const reasons = {
      voted: 'Шпион раскрыт голосованием!',
      wrongAccusation: 'Обвинили невиновного — шпион победил!',
      guessed: 'Шпион угадал локацию!',
      wrongGuess: 'Шпион ошибся — игроки победили!',
      timer: 'Время вышло — игроки победили!',
    };
    const isSpyWin = state.winner === 'spy';
    text.textContent = reasons[state.winReason] || (isSpyWin ? 'Шпион победил!' : 'Игроки победили!');
    text.style.color = isSpyWin ? '#e74c3c' : '#2ecc71';
    return;
  }

  const winner = state.winner || (state.teams && state.teams[state.currentTeamIndex]);
  const info = winner ? state.teamInfo[winner] : null;

  if (state.assassinLoser && info) {
    text.textContent = `${info.name} проиграли! (убийца)`;
  } else if (info) {
    text.textContent = `${info.name} победили!`;
  } else {
    text.textContent = 'Игра окончена!';
    text.style.color = '#eee';
    return;
  }
  text.style.color = info.color;
}

// ===== Helpers =====
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

connect();
