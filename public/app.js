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
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    // Support both /#CODE and /games/CODE
    const hash = location.hash.slice(1);
    const pathMatch = location.pathname.match(/\/games\/([A-Z0-9]{4})$/i);
    const code = hash || (pathMatch && pathMatch[1]);
    if (code) send({ type: 'join-room', name: getPlayerName(), code });
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'error') { $('#join-error').textContent = msg.message; return; }
    if (msg.type === 'state') { state = msg; render(); }
  };

  ws.onclose = () => setTimeout(connect, 2000);
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ===== Mode selector =====
$$('.mode-card').forEach((card) => {
  card.onclick = () => {
    $$('.mode-card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    selectedMode = card.dataset.mode;
  };
});

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
  } else {
    send({
      type: 'update-settings',
      teamCount: $('#sa-teams').value,
      timerDuration: $('#sa-timer').value,
      targetScore: $('#sa-target').value,
      difficulty: $('#sa-difficulty').value,
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
  // Update URL to /games/CODE without page reload
  const targetPath = `/games/${state.roomCode}`;
  if (location.pathname !== targetPath) {
    history.replaceState(null, '', targetPath);
  }

  const you = state.you;
  const isHost = you && you.id === state.hostId;
  const gm = state.gameMode;

  $('#room-code').textContent = state.roomCode;
  const badge = $('#game-mode-badge');
  badge.textContent = gm === 'alias' ? 'Alias' : 'Codenames';
  badge.className = 'game-mode-badge gm-' + gm;

  const nameInput = $('#name-input');
  if (document.activeElement !== nameInput && you) nameInput.value = you.name;

  $$('.host-only').forEach((el) => el.classList.toggle('hidden', !isHost));

  // Toggle game areas
  $('#codenames-area').classList.toggle('hidden', gm !== 'codenames');
  $('#alias-area').classList.toggle('hidden', gm !== 'alias');
  $('#settings-codenames').classList.toggle('hidden', gm !== 'codenames');
  $('#settings-alias').classList.toggle('hidden', gm !== 'alias');
  $('#clue-display').classList.toggle('hidden', gm !== 'codenames');

  // Settings values
  if (isHost) {
    if (gm === 'codenames') {
      $('#s-teams').value = state.settings.teamCount;
      $('#s-rows').value = state.settings.gridRows;
      $('#s-cols').value = state.settings.gridCols;
      $('#s-timer').value = state.settings.timerDuration;
    } else {
      $('#sa-teams').value = state.settings.teamCount;
      $('#sa-timer').value = state.settings.timerDuration;
      $('#sa-target').value = state.settings.targetScore;
      $('#sa-difficulty').value = state.settings.difficulty;
    }
  }

  renderScores();
  renderTimer();

  if (gm === 'codenames') {
    renderCodenamesTurnInfo();
    renderBoard();
    renderClueHistory();
    renderCodenamesControls();
  } else {
    renderAliasTurnInfo();
    renderAliasArea();
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
  turnEl.innerHTML = `${esc(info.name)} — ${phaseText[state.phase] || ''} ${diffBadge}`;
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
    const card = document.createElement('div');
    card.className = 'alias-waiting-card';
    card.textContent = 'Нажмите "Старт" чтобы начать ход';
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
      skipBtn.textContent = 'Пропуск';
      skipBtn.onclick = () => send({ type: 'word-skip' });
      btns.appendChild(correctBtn);
      btns.appendChild(skipBtn);
      area.appendChild(btns);
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
      const review = document.createElement('div');
      review.className = 'alias-review';
      state.turnWords.forEach((w, i) => {
        const item = document.createElement('div');
        item.className = `alias-review-item alias-review-${w.result}`;
        item.innerHTML = `<span class="alias-review-word">${esc(w.word)}</span><span class="alias-review-badge">${w.result === 'correct' ? '+1' : '-1'}</span>`;
        if (isHost || isExplainer) {
          item.style.cursor = 'pointer';
          item.title = 'Нажмите чтобы изменить';
          item.onclick = () => send({ type: 'toggle-word-result', index: i });
        }
        review.appendChild(item);
      });
      area.appendChild(review);
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
// SHARED: Player panel
// ============================================================

function renderPlayerPanel() {
  const panel = $('#player-panel');
  panel.innerHTML = '';
  const you = state.you;
  const gm = state.gameMode;
  const canSwitch = you && (gm === 'alias' || !state.paused);

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
        if (p.id === state.explainerId && state.phase === 'explaining') {
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
  const hasWinner = state.gameMode === 'alias' ? state.phase === 'finished' : !!state.winner;

  if (!hasWinner) {
    overlay.classList.add('hidden');
    screen.style.paddingTop = '';
    return;
  }
  overlay.classList.remove('hidden');
  screen.style.paddingTop = '90px';

  const text = $('#winner-text');
  const winner = state.winner || state.teams[state.currentTeamIndex];
  const info = state.teamInfo[winner];

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
