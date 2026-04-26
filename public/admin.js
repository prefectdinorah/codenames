// Monopoly admin panel — baron-only editor for decks and logos.
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => (root || document).querySelectorAll(sel);

  // ======= API helpers =======
  // App may be served under a prefix (e.g. /games/ behind nginx); resolve absolute /api paths
  // to the same prefix so they reach the codenames container, not siblings.
  const APP_BASE = (() => {
    const p = location.pathname;
    if (p.endsWith('/')) return p.replace(/\/$/, '');
    const i = p.lastIndexOf('/');
    return i > 0 ? p.substring(0, i) : '';
  })();

  function url(path) {
    if (path.startsWith('http')) return path;
    if (path.startsWith('/')) return APP_BASE + path;
    return path;
  }

  function adminName() { return localStorage.getItem('codenames-name') || ''; }

  async function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({}, o.headers || {}, { 'X-Admin-Name': adminName() });
    if (o.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      o.body = JSON.stringify(o.json);
    }
    const res = await fetch(url(path), { method: o.method || 'GET', headers, body: o.body });
    if (!res.ok) {
      let err = 'request failed';
      try { err = (await res.json()).error || err; } catch (_) {}
      throw new Error(err);
    }
    return res.json();
  }

  function toast(msg, kind) {
    const el = $('#admin-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'admin-toast ' + (kind || 'info');
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 3000);
  }

  // ======= State =======
  const adm = {
    decks: [],       // [{ id, name, locked }]
    currentDeckId: null,
    currentDeck: null,
    editingCellIndex: null,
    logos: [],       // [{ id, name, tags, url, uploadedAt }]
    logoFilter: '',
  };

  // ======= Panel show/hide =======
  const openBtn = $('#btn-admin-open');
  const closeBtn = $('#btn-admin-close');
  const overlay = $('#admin-overlay');

  if (openBtn) openBtn.addEventListener('click', openPanel);
  if (closeBtn) closeBtn.addEventListener('click', closePanel);

  async function openPanel() {
    overlay.classList.remove('hidden');
    try {
      await Promise.all([loadDecks(), loadLogos()]);
      renderDecksTab();
      renderLogosTab();
      switchTab('decks');
    } catch (err) {
      toast('Не удалось открыть: ' + err.message, 'error');
    }
  }
  function closePanel() {
    overlay.classList.add('hidden');
    adm.currentDeck = null;
    adm.currentDeckId = null;
    adm.editingCellIndex = null;
  }

  $$('.admin-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  function switchTab(tab) {
    $$('.admin-tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#admin-tab-decks').classList.toggle('hidden', tab !== 'decks');
    $('#admin-tab-logos').classList.toggle('hidden', tab !== 'logos');
  }

  // ======= Data loaders =======
  async function loadDecks() {
    const res = await api('/api/admin/decks');
    adm.decks = res.decks || [];
    // Refresh the settings dropdown too
    populateDeckDropdown();
  }
  async function loadLogos() {
    const res = await api('/api/admin/logos');
    adm.logos = res.logos || [];
  }
  async function loadDeck(id) {
    const res = await api('/api/admin/decks/' + encodeURIComponent(id));
    adm.currentDeckId = res.id;
    adm.currentDeck = res.deck;
  }

  function populateDeckDropdown() {
    // Called both by admin (after changes) and by app.js after state update.
    const sel = document.querySelector('#sm-deck');
    if (!sel) return;
    fetch(url('/api/monopoly/decks')).then((r) => r.json()).then((data) => {
      const prev = sel.value;
      sel.innerHTML = '';
      for (const d of data.decks || []) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name + (d.locked ? '' : ' ✎');
        sel.appendChild(opt);
      }
      if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    }).catch(() => {});
  }
  window.mpPopulateDeckDropdown = populateDeckDropdown;

  // ======= DECKS TAB =======
  function renderDecksTab() {
    const root = $('#admin-tab-decks');
    root.innerHTML = '';
    if (adm.currentDeck) return renderDeckEditor(root);
    renderDeckList(root);
  }

  function renderDeckList(root) {
    const list = document.createElement('div');
    list.className = 'admin-deck-list';

    for (const d of adm.decks) {
      const card = document.createElement('div');
      card.className = 'admin-deck-card';
      const title = document.createElement('div');
      title.className = 'admin-deck-title';
      title.textContent = d.name + (d.locked ? ' 🔒' : '');
      card.appendChild(title);

      const actions = document.createElement('div');
      actions.className = 'admin-deck-actions';

      const editBtn = document.createElement('button');
      editBtn.textContent = d.locked ? 'Смотреть' : 'Редактировать';
      editBtn.onclick = async () => {
        try { await loadDeck(d.id); renderDecksTab(); }
        catch (err) { toast(err.message, 'error'); }
      };
      actions.appendChild(editBtn);

      const dupBtn = document.createElement('button');
      dupBtn.textContent = 'Дублировать';
      dupBtn.onclick = async () => {
        const name = prompt('Название новой колоды:', d.name + ' копия');
        if (!name) return;
        const newId = 'deck_' + Date.now().toString(36);
        try {
          const res = await api('/api/admin/decks/' + encodeURIComponent(d.id) + '/duplicate', {
            method: 'POST', json: { newId, newName: name },
          });
          await loadDecks();
          await loadDeck(res.id);
          renderDecksTab();
          toast('Колода создана', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
      actions.appendChild(dupBtn);

      if (!d.locked) {
        const delBtn = document.createElement('button');
        delBtn.className = 'admin-btn-danger';
        delBtn.textContent = 'Удалить';
        delBtn.onclick = async () => {
          if (!confirm(`Удалить «${d.name}»?`)) return;
          try {
            await api('/api/admin/decks/' + encodeURIComponent(d.id), { method: 'DELETE' });
            await loadDecks();
            renderDecksTab();
            toast('Удалено', 'success');
          } catch (err) { toast(err.message, 'error'); }
        };
        actions.appendChild(delBtn);
      }
      card.appendChild(actions);
      list.appendChild(card);
    }

    const newCard = document.createElement('div');
    newCard.className = 'admin-deck-card admin-deck-card-new';
    newCard.textContent = '+ Новая колода (клонировать классическую)';
    newCard.onclick = async () => {
      const name = prompt('Название новой колоды:', 'Моя колода');
      if (!name) return;
      const newId = 'deck_' + Date.now().toString(36);
      try {
        const res = await api('/api/admin/decks/classic/duplicate', {
          method: 'POST', json: { newId, newName: name },
        });
        await loadDecks();
        await loadDeck(res.id);
        renderDecksTab();
      } catch (err) { toast(err.message, 'error'); }
    };
    list.appendChild(newCard);

    root.appendChild(list);
  }

  function renderDeckEditor(root) {
    const deck = adm.currentDeck;
    const locked = deck.locked;

    // Header — back button + deck name + save
    const header = document.createElement('div');
    header.className = 'admin-editor-header';

    const back = document.createElement('button');
    back.className = 'admin-btn-ghost';
    back.textContent = '← К списку';
    back.onclick = () => { adm.currentDeck = null; adm.editingCellIndex = null; renderDecksTab(); };
    header.appendChild(back);

    const nameWrap = document.createElement('div');
    nameWrap.className = 'admin-deck-name-wrap';
    const nameLabel = document.createElement('div');
    nameLabel.className = 'admin-section-label';
    nameLabel.textContent = 'Колода';
    nameWrap.appendChild(nameLabel);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = deck.name;
    nameInput.disabled = locked;
    nameInput.className = 'admin-deck-name-input';
    nameInput.oninput = () => { deck.name = nameInput.value; };
    nameWrap.appendChild(nameInput);
    header.appendChild(nameWrap);

    if (!locked) {
      const saveBtn = document.createElement('button');
      saveBtn.className = 'admin-btn-primary';
      saveBtn.textContent = 'Сохранить';
      saveBtn.onclick = async () => {
        try {
          await api('/api/admin/decks/' + encodeURIComponent(adm.currentDeckId), {
            method: 'PUT', json: deck,
          });
          toast('Сохранено', 'success');
          await loadDecks();
        } catch (err) { toast(err.message, 'error'); }
      };
      header.appendChild(saveBtn);
    } else {
      const note = document.createElement('span');
      note.className = 'admin-note';
      note.textContent = 'Только чтение — дублируй для правок';
      header.appendChild(note);
    }
    root.appendChild(header);

    // Board (centered, large)
    const boardWrap = document.createElement('div');
    boardWrap.className = 'admin-board-wrap';
    const boardBox = document.createElement('div');
    boardBox.className = 'admin-board-minigrid';
    renderBoardGrid(boardBox, deck, locked);
    boardWrap.appendChild(boardBox);
    root.appendChild(boardWrap);

    // Cell editor — below the board, full width
    const cellBox = document.createElement('div');
    cellBox.className = 'admin-cell-editor';
    renderCellEditor(cellBox, deck, locked);
    root.appendChild(cellBox);

    // Groups editor — collapsible at the bottom
    root.appendChild(renderGroupsEditor(deck, locked));
  }

  function renderGroupsEditor(deck, locked) {
    const box = document.createElement('details');
    box.className = 'admin-groups-box';
    const sum = document.createElement('summary');
    sum.textContent = 'Группы (' + Object.keys(deck.groups).length + ')';
    box.appendChild(sum);
    const list = document.createElement('div');
    list.className = 'admin-groups-list';
    for (const [gid, g] of Object.entries(deck.groups)) {
      const row = document.createElement('div');
      row.className = 'admin-group-row';

      const name = document.createElement('input');
      name.type = 'text';
      name.value = g.name;
      name.disabled = locked;
      name.oninput = () => { g.name = name.value; };
      row.appendChild(name);

      const color = document.createElement('input');
      color.type = 'color';
      color.value = g.color;
      color.disabled = locked;
      color.oninput = () => { g.color = color.value; };
      row.appendChild(color);

      const idLabel = document.createElement('span');
      idLabel.className = 'admin-group-id';
      idLabel.textContent = gid;
      row.appendChild(idLabel);

      if (!locked) {
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'Удалить группу (клетки останутся — перепривяжи вручную)';
        del.onclick = () => { delete deck.groups[gid]; renderDeckEditor($('#admin-tab-decks')); };
        row.appendChild(del);
      }
      list.appendChild(row);
    }
    if (!locked) {
      const addRow = document.createElement('div');
      addRow.className = 'admin-group-row';
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Добавить группу';
      addBtn.onclick = () => {
        const id = prompt('ID группы (латинские буквы/цифры/подчёркивание):');
        if (!id || !/^[a-z0-9_]+$/.test(id)) { toast('ID только латиница/цифры/_ ', 'error'); return; }
        if (deck.groups[id]) { toast('ID уже существует', 'error'); return; }
        deck.groups[id] = { name: 'Новая группа', color: '#888888' };
        renderDeckEditor($('#admin-tab-decks'));
      };
      addRow.appendChild(addBtn);
      list.appendChild(addRow);
    }
    box.appendChild(list);
    return box;
  }

  function cellPosition(index) {
    if (index === 0) return { r: 11, c: 11 };
    if (index < 10) return { r: 11, c: 11 - index };
    if (index === 10) return { r: 11, c: 1 };
    if (index < 20) return { r: 21 - index, c: 1 };
    if (index === 20) return { r: 1, c: 1 };
    if (index < 30) return { r: 1, c: index - 19 };
    if (index === 30) return { r: 1, c: 11 };
    return { r: index - 29, c: 11 };
  }

  function cellInfo(deck, sq) {
    if (sq.type === 'property') return deck.properties[sq.slug];
    if (sq.type === 'transport') return deck.transport[sq.slug];
    if (sq.type === 'utility') return deck.utilities[sq.slug];
    return null;
  }

  function cellDisplayName(deck, sq) {
    const info = cellInfo(deck, sq);
    if (info) return info.name;
    if (sq.type === 'tax') return sq.name || 'Налог';
    if (sq.type === 'go') return 'GO';
    if (sq.type === 'jail') return 'Тюрьма';
    if (sq.type === 'go_to_jail') return 'В тюрьму';
    if (sq.type === 'parking') return 'Парковка';
    if (sq.type === 'chance') return 'Шанс';
    if (sq.type === 'chest') return 'Казна';
    return sq.type;
  }

  function renderBoardGrid(root, deck, locked) {
    root.innerHTML = '';
    for (let i = 0; i < deck.board.length; i++) {
      const sq = deck.board[i];
      const { r, c } = cellPosition(i);
      const cell = document.createElement('div');
      cell.className = 'admin-cell admin-cell-' + sq.type;
      cell.style.gridRow = r;
      cell.style.gridColumn = c;
      if (i === adm.editingCellIndex) cell.classList.add('admin-cell-selected');

      if (sq.type === 'property') {
        const info = deck.properties[sq.slug];
        const strip = document.createElement('div');
        strip.className = 'admin-cell-strip';
        strip.style.background = deck.groups[info?.group]?.color || '#444';
        cell.appendChild(strip);
      }
      const label = document.createElement('div');
      label.className = 'admin-cell-label';
      label.textContent = cellDisplayName(deck, sq);
      cell.appendChild(label);

      const idx = document.createElement('div');
      idx.className = 'admin-cell-idx';
      idx.textContent = i;
      cell.appendChild(idx);

      cell.onclick = () => { adm.editingCellIndex = i; renderDeckEditor($('#admin-tab-decks')); };
      root.appendChild(cell);
    }
  }

  function renderCellEditor(root, deck, locked) {
    root.innerHTML = '';
    if (adm.editingCellIndex === null) {
      root.innerHTML = '<div class="admin-cell-empty">Кликни клетку на доске, чтобы её отредактировать</div>';
      return;
    }
    const idx = adm.editingCellIndex;
    const sq = deck.board[idx];
    const TYPE_LABELS = {
      property: 'Компания', transport: 'Транспорт', utility: 'Ресурс', tax: 'Налог',
      chance: 'Шанс', chest: 'Казна', go: 'Старт', jail: 'Тюрьма',
      go_to_jail: 'В тюрьму', parking: 'Парковка',
    };

    const h = document.createElement('h3');
    h.textContent = `Клетка #${idx} · ${cellDisplayName(deck, sq)}`;
    root.appendChild(h);

    const grid = document.createElement('div');
    grid.className = 'admin-cell-editor-grid';
    root.appendChild(grid);

    // Type selector
    const typeLabel = document.createElement('label');
    typeLabel.className = 'admin-field';
    typeLabel.textContent = 'Тип клетки';
    const typeSel = document.createElement('select');
    typeSel.disabled = locked;
    for (const t of ['property', 'transport', 'utility', 'tax', 'chance', 'chest', 'go', 'jail', 'go_to_jail', 'parking']) {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = TYPE_LABELS[t] || t;
      if (t === sq.type) opt.selected = true;
      typeSel.appendChild(opt);
    }
    typeSel.onchange = () => {
      const t = typeSel.value;
      const oldSlug = sq.slug;
      if (oldSlug) {
        delete deck.properties[oldSlug];
        delete deck.transport[oldSlug];
        delete deck.utilities[oldSlug];
      }
      sq.type = t;
      delete sq.slug; delete sq.name; delete sq.amount;
      if (t === 'property') {
        sq.slug = 'prop_' + Date.now().toString(36);
        const firstGroup = Object.keys(deck.groups)[0];
        deck.properties[sq.slug] = { name: 'Компания', group: firstGroup, price: 100, rent: [10, 30, 90, 160, 250, 400], house: 50 };
      } else if (t === 'transport') {
        sq.slug = 'tr_' + Date.now().toString(36);
        deck.transport[sq.slug] = { name: 'Транспорт', price: 200 };
      } else if (t === 'utility') {
        sq.slug = 'ut_' + Date.now().toString(36);
        deck.utilities[sq.slug] = { name: 'Ресурс', price: 150 };
      } else if (t === 'tax') {
        sq.name = 'Налог'; sq.amount = 100;
      }
      renderDeckEditor($('#admin-tab-decks'));
    };
    typeLabel.appendChild(typeSel);
    grid.appendChild(typeLabel);

    const info = cellInfo(deck, sq);
    if (info) {
      grid.appendChild(textField('Название', info.name, locked, (v) => { info.name = v; refreshGrid(); }));
      grid.appendChild(numberField('Цена', info.price, locked, (v) => { info.price = v; }));

      if (sq.type === 'property') {
        // Group
        const grpLabel = document.createElement('label');
        grpLabel.className = 'admin-field';
        grpLabel.textContent = 'Группа';
        const grpSel = document.createElement('select');
        grpSel.disabled = locked;
        for (const [gid, g] of Object.entries(deck.groups)) {
          const opt = document.createElement('option');
          opt.value = gid; opt.textContent = g.name;
          if (gid === info.group) opt.selected = true;
          grpSel.appendChild(opt);
        }
        grpSel.onchange = () => { info.group = grpSel.value; refreshGrid(); };
        grpLabel.appendChild(grpSel);
        grid.appendChild(grpLabel);

        grid.appendChild(numberField('Стоимость дома', info.house || 0, locked, (v) => { info.house = v; }));

        const rentTitle = document.createElement('div');
        rentTitle.className = 'admin-subtitle';
        rentTitle.textContent = 'Рента по уровню застройки';
        grid.appendChild(rentTitle);

        const rentBox = document.createElement('div');
        rentBox.className = 'admin-rent-grid';
        const rentLabels = ['База', '1 дом', '2 дома', '3 дома', '4 дома', 'Отель'];
        for (let r = 0; r < 6; r++) {
          rentBox.appendChild(numberField(rentLabels[r], info.rent[r] || 0, locked, (v) => { info.rent[r] = v; }));
        }
        grid.appendChild(rentBox);
      }

      grid.appendChild(logoPickerField(info, locked));
    } else if (sq.type === 'tax') {
      grid.appendChild(textField('Название', sq.name || '', locked, (v) => { sq.name = v; refreshGrid(); }));
      grid.appendChild(numberField('Сумма', sq.amount || 0, locked, (v) => { sq.amount = v; }));
    } else {
      const note = document.createElement('div');
      note.className = 'admin-note';
      note.textContent = 'У этого типа нет редактируемых полей.';
      grid.appendChild(note);
    }

    function refreshGrid() {
      renderBoardGrid($('.admin-board-minigrid'), deck, locked);
    }
  }

  function textField(label, value, disabled, onChange) {
    const l = document.createElement('label');
    l.className = 'admin-field';
    l.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = value || ''; inp.disabled = disabled;
    inp.oninput = () => onChange(inp.value);
    l.appendChild(inp);
    return l;
  }
  function numberField(label, value, disabled, onChange) {
    const l = document.createElement('label');
    l.className = 'admin-field';
    l.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = value; inp.disabled = disabled;
    inp.oninput = () => onChange(parseInt(inp.value, 10) || 0);
    l.appendChild(inp);
    return l;
  }

  function logoPickerField(info, disabled) {
    const l = document.createElement('div');
    l.className = 'admin-field admin-logo-field';
    const label = document.createElement('div');
    label.textContent = 'Логотип:';
    l.appendChild(label);

    const preview = document.createElement('div');
    preview.className = 'admin-logo-preview';
    const current = info.logoId ? adm.logos.find((x) => x.id === info.logoId) : null;
    if (current) {
      const img = document.createElement('img');
      img.src = current.url;
      img.alt = current.name;
      preview.appendChild(img);
      const nm = document.createElement('span');
      nm.textContent = current.name;
      preview.appendChild(nm);
    } else {
      preview.textContent = info.logoUrl ? '(внешний URL)' : '(не выбран)';
    }
    l.appendChild(preview);

    if (!disabled) {
      const btns = document.createElement('div');
      btns.className = 'admin-logo-btns';
      const pick = document.createElement('button');
      pick.textContent = 'Выбрать из библиотеки';
      pick.onclick = (ev) => { ev.preventDefault(); openLogoPicker((logo) => { info.logoId = logo.id; delete info.logoUrl; renderCellEditor($('.admin-cell-editor'), adm.currentDeck, false); }); };
      btns.appendChild(pick);
      if (info.logoId || info.logoUrl) {
        const clear = document.createElement('button');
        clear.textContent = 'Убрать';
        clear.onclick = (ev) => { ev.preventDefault(); delete info.logoId; delete info.logoUrl; renderCellEditor($('.admin-cell-editor'), adm.currentDeck, false); };
        btns.appendChild(clear);
      }
      l.appendChild(btns);
    }
    return l;
  }

  // ======= Logo picker modal =======
  function openLogoPicker(onPick) {
    const modal = document.createElement('div');
    modal.className = 'admin-modal';
    const box = document.createElement('div');
    box.className = 'admin-modal-box';

    const header = document.createElement('div');
    header.className = 'admin-modal-header';
    header.innerHTML = '<h3>Выбери логотип</h3>';
    const close = document.createElement('button');
    close.textContent = '✕';
    close.onclick = () => modal.remove();
    header.appendChild(close);
    box.appendChild(header);

    const filter = document.createElement('input');
    filter.type = 'text';
    filter.placeholder = 'Поиск по названию или тегу…';
    filter.className = 'admin-logo-filter';
    box.appendChild(filter);

    const grid = document.createElement('div');
    grid.className = 'admin-logo-grid';
    box.appendChild(grid);

    function renderGrid() {
      const q = filter.value.trim().toLowerCase();
      grid.innerHTML = '';
      const filtered = adm.logos.filter((l) => {
        if (!q) return true;
        return l.name.toLowerCase().includes(q) || (l.tags || []).some((t) => t.toLowerCase().includes(q));
      });
      if (!filtered.length) {
        grid.innerHTML = '<div class="admin-note">Ничего не найдено. Загрузи логотип во вкладке «Логотипы».</div>';
        return;
      }
      for (const logo of filtered) {
        const tile = document.createElement('button');
        tile.className = 'admin-logo-tile';
        tile.onclick = () => { onPick(logo); modal.remove(); };
        const img = document.createElement('img');
        img.src = logo.url;
        img.alt = logo.name;
        tile.appendChild(img);
        const cap = document.createElement('div');
        cap.textContent = logo.name;
        tile.appendChild(cap);
        grid.appendChild(tile);
      }
    }
    filter.oninput = renderGrid;
    renderGrid();

    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  // ======= LOGOS TAB =======
  function renderLogosTab() {
    const root = $('#admin-tab-logos');
    root.innerHTML = '';

    // Upload form
    const form = document.createElement('form');
    form.className = 'admin-upload-form';
    form.innerHTML = `
      <h3>Загрузить логотип</h3>
      <label>Название <input type="text" name="name" required maxlength="60"></label>
      <label>Теги (через запятую) <input type="text" name="tags"></label>
      <label>Файл <input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" required></label>
      <button type="submit">Загрузить</button>
    `;
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      try {
        const res = await fetch(url('/api/admin/logos'), {
          method: 'POST',
          headers: { 'X-Admin-Name': adminName() },
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'upload failed');
        toast('Загружено', 'success');
        form.reset();
        await loadLogos();
        renderLogosTab();
      } catch (err) { toast(err.message, 'error'); }
    };
    root.appendChild(form);

    // Search
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Поиск…';
    search.className = 'admin-logo-filter';
    search.value = adm.logoFilter;
    search.oninput = () => { adm.logoFilter = search.value; renderLogosTab(); };
    root.appendChild(search);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'admin-logo-grid';
    const q = adm.logoFilter.trim().toLowerCase();
    const filtered = adm.logos.filter((l) => {
      if (!q) return true;
      return l.name.toLowerCase().includes(q) || (l.tags || []).some((t) => t.toLowerCase().includes(q));
    });
    if (!filtered.length) {
      grid.innerHTML = '<div class="admin-note">Логотипов пока нет.</div>';
    } else {
      for (const logo of filtered) {
        const tile = document.createElement('div');
        tile.className = 'admin-logo-tile';
        const img = document.createElement('img');
        img.src = logo.url;
        img.alt = logo.name;
        tile.appendChild(img);
        const cap = document.createElement('div');
        cap.textContent = logo.name;
        tile.appendChild(cap);
        const del = document.createElement('button');
        del.textContent = 'Удалить';
        del.className = 'admin-btn-danger admin-logo-del';
        del.onclick = async () => {
          try {
            const usage = await api('/api/admin/logos/' + encodeURIComponent(logo.id) + '/usage');
            if (usage.usage.length) {
              if (!confirm(`Логотип используется в ${usage.usage.length} клетках. Всё равно удалить?`)) return;
            } else {
              if (!confirm('Удалить логотип?')) return;
            }
            await api('/api/admin/logos/' + encodeURIComponent(logo.id), { method: 'DELETE' });
            await loadLogos();
            renderLogosTab();
            toast('Удалено', 'success');
          } catch (err) { toast(err.message, 'error'); }
        };
        tile.appendChild(del);
        grid.appendChild(tile);
      }
    }
    root.appendChild(grid);
  }

  // Populate dropdown on initial load too
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', populateDeckDropdown);
  } else {
    populateDeckDropdown();
  }
})();
