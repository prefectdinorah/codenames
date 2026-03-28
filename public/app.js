const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let ws;
let state = null;
let timerInterval = null;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'error') {
      $('#join-error').textContent = msg.message;
      return;
    }
    if (msg.type === 'state') {
      state = msg;
      render();
    }
  };

  ws.onclose = () => {
    setTimeout(connect, 2000);
  };
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ===== Join overlay =====
$('#btn-create').onclick = () => {
  send({ type: 'create-room', name: $('#player-name').value.trim() || 'Игрок' });
};
$('#btn-join').onclick = () => {
  const code = $('#room-code-input').value.trim();
  if (!code) return;
  send({ type: 'join-room', name: $('#player-name').value.trim() || 'Игрок', code });
};
$('#room-code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-join').click();
});

// ===== Name editing =====
$('#btn-change-name').onclick = () => {
  const name = $('#name-input').value.trim();
  if (name) send({ type: 'change-name', name });
};
$('#name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-change-name').click();
});

// ===== Game controls =====
$('#btn-pause').onclick = () => send({ type: 'toggle-pause' });
$('#btn-unpause').onclick = () => send({ type: 'toggle-pause' });
$('#btn-restart').onclick = () => send({ type: 'new-game' });
$('#btn-shuffle').onclick = () => send({ type: 'shuffle-players' });

$('#btn-settings').onclick = (e) => {
  e.stopPropagation();
  $('#settings-dropdown').classList.toggle('hidden');
};
$('#settings-dropdown').onclick = (e) => e.stopPropagation();
document.addEventListener('click', () => {
  $('#settings-dropdown').classList.add('hidden');
});

$('#btn-apply-settings').onclick = () => {
  send({
    type: 'update-settings',
    teamCount: $('#s-teams').value,
    gridRows: $('#s-rows').value,
    gridCols: $('#s-cols').value,
    timerDuration: $('#s-timer').value,
  });
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
$('#btn-new-game-win').onclick = () => send({ type: 'new-game' });

// ===== Rendering =====
function render() {
  if (!state) return;

  $('#join-overlay').classList.remove('active');
  $('#game-screen').classList.remove('hidden');

  const you = state.you;
  const isHost = you && you.id === state.hostId;
  const isSpymaster = you && you.role === 'spymaster';
  const isOperative = you && you.role === 'operative';
  const isMyTurn = you && you.team === state.turn;
  const canVote = isOperative && isMyTurn && state.clue && !state.winner && !state.paused;

  // Room code
  $('#room-code').textContent = state.roomCode;

  // Name input
  const nameInput = $('#name-input');
  if (document.activeElement !== nameInput && you) {
    nameInput.value = you.name;
  }

  // Host-only controls
  $$('.host-only').forEach((el) => el.classList.toggle('hidden', !isHost));

  // Settings values
  if (isHost) {
    $('#s-teams').value = state.settings.teamCount;
    $('#s-rows').value = state.settings.gridRows;
    $('#s-cols').value = state.settings.gridCols;
    $('#s-timer').value = state.settings.timerDuration;
  }

  renderScores();
  renderTurnInfo();
  renderTimer();
  renderBoard(canVote, isSpymaster);

  // Clue form
  const showClueForm = isSpymaster && isMyTurn && !state.clue && !state.winner && !state.paused;
  $('#clue-form').classList.toggle('hidden', !showClueForm);

  // End turn (available when clue given and it's your team's turn)
  const showEndTurn = isMyTurn && state.clue && !state.winner && !state.paused;
  $('#btn-end-turn').classList.toggle('hidden', !showEndTurn);

  renderClueHistory();
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
    if (teamId === state.turn && !state.winner) {
      badge.style.outline = `2px solid ${info.color}`;
    }
    badge.innerHTML = `<span class="s-label">${esc(info.name)}</span>${state.scores[teamId]} / ${state.totals[teamId]}`;
    bar.appendChild(badge);
  }
}

function renderTurnInfo() {
  const turnEl = $('#turn-indicator');
  const clueEl = $('#clue-display');

  if (state.winner) {
    turnEl.textContent = '';
    clueEl.textContent = '';
    return;
  }

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

  if (!state.timerEnd) {
    el.classList.add('hidden');
    return;
  }

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

function renderBoard(canVote, isSpymaster) {
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

    if (isSpymaster && card.type) {
      el.classList.add(`spy-${card.type}`);
    } else {
      el.classList.add('unrevealed');
    }

    el.textContent = card.word;

    const voteCount = state.cardVotes[i] || 0;
    const isConfirming = state.confirmingCard === i;
    const isMyVote = state.yourVote === i;

    // Vote visuals
    if (voteCount > 0 || isConfirming) {
      el.classList.add('has-votes');
      if (isConfirming) {
        el.classList.add('confirming');
      }
      // Vote badge
      const badge = document.createElement('span');
      badge.className = 'vote-badge';
      badge.textContent = `${voteCount}/${voteTotal}`;
      el.appendChild(badge);
    }

    if (isMyVote) {
      el.classList.add('my-vote');
    }

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

function renderPlayerPanel() {
  const panel = $('#player-panel');
  panel.innerHTML = '';

  const you = state.you;
  const canSwitch = you && !state.paused;

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

    // Action buttons
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
      if (!inThisTeam || you.role !== 'spymaster') {
        const btn = document.createElement('button');
        btn.textContent = '\u2605 Ведущий';
        btn.onclick = () => send({ type: 'pick-team', team: teamId, role: 'spymaster' });
        actions.appendChild(btn);
      }
      block.appendChild(actions);
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
  if (!state.paused || state.winner) {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');

  const you = state.you;
  const isHost = you && you.id === state.hostId;
  let settingsEl = overlay.querySelector('.pause-settings');

  if (isHost) {
    if (!settingsEl) {
      settingsEl = document.createElement('div');
      settingsEl.className = 'pause-settings';
      settingsEl.innerHTML = `
        <label>Команды <select id="ps-teams">
          <option value="2">2</option><option value="3">3</option>
          <option value="4">4</option><option value="5">5</option>
        </select></label>
        <label>Строки <select id="ps-rows">
          <option value="4">4</option><option value="5">5</option>
          <option value="6">6</option><option value="7">7</option><option value="8">8</option>
        </select></label>
        <label>Столбцы <select id="ps-cols">
          <option value="4">4</option><option value="5">5</option>
          <option value="6">6</option><option value="7">7</option><option value="8">8</option>
        </select></label>
        <label>Таймер <select id="ps-timer">
          <option value="0">Выкл</option><option value="30">30с</option>
          <option value="60">60с</option><option value="90">90с</option>
          <option value="120">120с</option><option value="180">180с</option>
        </select></label>
        <button id="btn-ps-apply">Применить (новая игра)</button>
      `;
      overlay.querySelector('.pause-content').appendChild(settingsEl);

      settingsEl.querySelector('#btn-ps-apply').onclick = () => {
        send({
          type: 'update-settings',
          teamCount: settingsEl.querySelector('#ps-teams').value,
          gridRows: settingsEl.querySelector('#ps-rows').value,
          gridCols: settingsEl.querySelector('#ps-cols').value,
          timerDuration: settingsEl.querySelector('#ps-timer').value,
        });
      };
    }
    settingsEl.classList.remove('hidden');
    settingsEl.querySelector('#ps-teams').value = state.settings.teamCount;
    settingsEl.querySelector('#ps-rows').value = state.settings.gridRows;
    settingsEl.querySelector('#ps-cols').value = state.settings.gridCols;
    settingsEl.querySelector('#ps-timer').value = state.settings.timerDuration;
  } else if (settingsEl) {
    settingsEl.classList.add('hidden');
  }
}

function renderWinnerOverlay() {
  const overlay = $('#winner-overlay');
  if (!state.winner) {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  const text = $('#winner-text');
  const info = state.teamInfo[state.winner];

  if (state.assassinLoser && info) {
    text.textContent = `${info.name} проиграли! (убийца)`;
    text.style.color = info.color;
  } else if (info) {
    text.textContent = `${info.name} победили!`;
    text.style.color = info.color;
  } else {
    text.textContent = 'Игра окончена!';
    text.style.color = '#eee';
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
