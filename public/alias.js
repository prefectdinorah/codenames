const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let ws;
let state = null;
let timerInterval = null;

// ===== Saved name =====
const savedName = localStorage.getItem('codenames-name') || '';
if (savedName) $('#player-name').value = savedName;

function getPlayerName() {
  const name = $('#player-name').value.trim() || 'Игрок';
  localStorage.setItem('codenames-name', name);
  return name;
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    // Auto-join if room code in hash
    const hash = location.hash.slice(1);
    if (hash) {
      send({ type: 'join-room', name: getPlayerName(), code: hash });
    }
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'error') {
      $('#join-error').textContent = msg.message;
      return;
    }
    if (msg.type === 'state') {
      // If joined a codenames room, redirect
      if (msg.gameMode === 'codenames') {
        location.href = '/#' + msg.roomCode;
        return;
      }
      state = msg;
      render();
    }
  };

  ws.onclose = () => setTimeout(connect, 2000);
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ===== Join =====
$('#btn-create').onclick = () => {
  send({ type: 'create-room', name: getPlayerName(), gameMode: 'alias' });
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
  send({
    type: 'update-settings',
    teamCount: $('#s-teams').value,
    timerDuration: $('#s-timer').value,
    targetScore: $('#s-target').value,
    difficulty: $('#s-difficulty').value,
  });
  $('#settings-dropdown').classList.add('hidden');
};

// ===== Render =====
function render() {
  if (!state) return;

  $('#join-overlay').classList.remove('active');
  $('#game-screen').classList.remove('hidden');

  location.hash = state.roomCode;

  const you = state.you;
  const isHost = you && you.id === state.hostId;

  $('#room-code').textContent = state.roomCode;
  const nameInput = $('#name-input');
  if (document.activeElement !== nameInput && you) nameInput.value = you.name;

  $$('.host-only').forEach((el) => el.classList.toggle('hidden', !isHost));

  if (isHost) {
    $('#s-teams').value = state.settings.teamCount;
    $('#s-timer').value = state.settings.timerDuration;
    $('#s-target').value = state.settings.targetScore;
    $('#s-difficulty').value = state.settings.difficulty;
  }

  renderScores();
  renderTurnInfo();
  renderTimer();
  renderAliasArea();
  renderPlayerPanel();
  renderPauseOverlay();
  renderWinnerOverlay();
}

function renderScores() {
  const bar = $('#scores-bar');
  bar.innerHTML = '';
  for (const teamId of state.teams) {
    const info = state.teamInfo[teamId];
    const badge = document.createElement('div');
    badge.className = 'score-badge';
    badge.style.background = hexToRgba(info.color, 0.2);
    badge.style.color = info.color;
    const isActive = teamId === state.teams[state.currentTeamIndex] && state.phase !== 'finished';
    if (isActive) badge.style.outline = `2px solid ${info.color}`;
    badge.innerHTML = `<span class="s-label">${esc(info.name)}</span>${state.scores[teamId]} / ${state.targetScore}`;
    bar.appendChild(badge);
  }
}

function renderTurnInfo() {
  const turnEl = $('#turn-indicator');
  if (state.phase === 'finished') { turnEl.textContent = ''; return; }

  const teamId = state.teams[state.currentTeamIndex];
  const info = state.teamInfo[teamId];
  const diffBadge = `<span class="alias-difficulty-badge alias-difficulty-${state.difficulty}">${state.difficulty === 'hard' ? 'сложный' : 'нормальный'}</span>`;

  if (state.phase === 'waiting') {
    turnEl.innerHTML = `${esc(info.name)} — подготовка ${diffBadge}`;
  } else if (state.phase === 'explaining') {
    turnEl.innerHTML = `${esc(info.name)} — объясняет ${diffBadge}`;
  } else if (state.phase === 'review') {
    turnEl.innerHTML = `${esc(info.name)} — проверка ${diffBadge}`;
  }
  turnEl.style.color = info.color;
}

function renderTimer() {
  const el = $('#timer-display');
  clearInterval(timerInterval);

  if (!state.timerEnd && (!state.timerRemaining || state.timerRemaining <= 0)) {
    el.classList.add('hidden');
    return;
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

function renderAliasArea() {
  const area = $('#alias-area');
  area.innerHTML = '';

  const you = state.you;
  const isExplainer = you && you.id === state.explainerId;
  const isHost = you && you.id === state.hostId;
  const teamId = state.teams[state.currentTeamIndex];
  const info = state.teamInfo[teamId];

  // Find explainer name
  const explainer = state.players.find((p) => p.id === state.explainerId);

  if (state.phase === 'waiting') {
    const card = document.createElement('div');
    card.className = 'alias-waiting-card';
    if (explainer) {
      card.textContent = `Следующий объясняет: подготовка...`;
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
    // Explainer label
    const label = document.createElement('div');
    label.className = 'alias-explainer-label';
    label.textContent = `Объясняет: `;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'alias-explainer-name';
    nameSpan.textContent = explainer ? explainer.name : '???';
    nameSpan.style.color = info.color;
    label.appendChild(nameSpan);
    area.appendChild(label);

    // Word card
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

    // Turn score
    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'alias-turn-score';
    scoreDiv.textContent = `Счёт хода: ${state.turnScore}`;
    scoreDiv.style.color = state.turnScore >= 0 ? '#2ecc71' : '#e74c3c';
    area.appendChild(scoreDiv);

    // Buttons (only for explainer)
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

    // Word list
    if (state.turnWords) {
      const review = document.createElement('div');
      review.className = 'alias-review';

      state.turnWords.forEach((w, i) => {
        const item = document.createElement('div');
        item.className = `alias-review-item alias-review-${w.result}`;
        const wordSpan = document.createElement('span');
        wordSpan.className = 'alias-review-word';
        wordSpan.textContent = w.word;
        const badge = document.createElement('span');
        badge.className = 'alias-review-badge';
        badge.textContent = w.result === 'correct' ? '+1' : '-1';
        item.appendChild(wordSpan);
        item.appendChild(badge);

        // Clickable for host/explainer to toggle
        if (isHost || isExplainer) {
          item.style.cursor = 'pointer';
          item.title = 'Нажмите чтобы изменить';
          item.onclick = () => send({ type: 'toggle-word-result', index: i });
        }

        review.appendChild(item);
      });

      area.appendChild(review);
    }

    // Confirm button
    if (isHost || isExplainer) {
      const btn = document.createElement('button');
      btn.className = 'alias-confirm-btn';
      btn.textContent = 'Подтвердить';
      btn.onclick = () => send({ type: 'confirm-turn' });
      area.appendChild(btn);
    }
  }
}

function renderPlayerPanel() {
  const panel = $('#player-panel');
  panel.innerHTML = '';

  const you = state.you;

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

    const teamPlayers = state.players.filter((p) => p.team === teamId);
    const opList = document.createElement('div');
    opList.className = 'operative-list';
    for (const p of teamPlayers) {
      const entry = document.createElement('div');
      entry.className = 'operative-entry';
      entry.textContent = p.name;
      if (p.id === state.explainerId && state.phase === 'explaining') {
        entry.style.fontWeight = '700';
        entry.textContent = '\u2605 ' + p.name;
      }
      opList.appendChild(entry);
    }
    block.appendChild(opList);

    // Join button
    if (you && you.team !== teamId) {
      const btn = document.createElement('button');
      btn.className = 'btn-spectate';
      btn.textContent = 'Вступить';
      btn.onclick = () => send({ type: 'pick-team', team: teamId });
      block.appendChild(btn);
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

function renderPauseOverlay() {
  const overlay = $('#pause-overlay');
  if (!state.paused || state.phase === 'finished') {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
}

function renderWinnerOverlay() {
  const overlay = $('#winner-overlay');
  const screen = $('#game-screen');
  if (state.phase !== 'finished' || !state.winner) {
    overlay.classList.add('hidden');
    screen.style.paddingTop = '';
    return;
  }
  overlay.classList.remove('hidden');
  screen.style.paddingTop = '90px';
  const text = $('#winner-text');
  const info = state.teamInfo[state.winner];
  if (info) {
    text.textContent = `${info.name} победили!`;
    text.style.color = info.color;
  }
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
