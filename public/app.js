'use strict';

/**
 * GuessFootball - "En Yakin Tahmin" oyunu (iki oyuncu, ayni ekran).
 *
 * Akis: ortaya rastgele bir oyuncu gelir. Satirlar SIRAYLA oynanir; once
 * aktif satiri iki oyuncu da doldurur, "Goster" ile o satirin dogru degeri
 * acilir ve en yakin tahmin o satiri kazanir, sonra "Sonraki Satir" ile bir
 * alta gecilir. Bes satir bitince "Sonraki Oyuncu" yeni futbolcu getirir.
 * Skorlar turlar boyunca birikir.
 */

// value(answers) -> dogru sayisal deger (veya null: puanlanmaz)
// format(v)      -> ekranda gosterim
const ROWS = [
  {
    key: 'careerGoals',
    label: 'KARİYER GOLÜ',
    hint: 'gol sayısı',
    value: (a) => a.careerGoals,
    format: (v) => `${v}`,
  },
  {
    key: 'marketValue',
    label: 'EN YÜKSEK DEĞER',
    hint: 'milyon € (zirve)',
    // Ulastigi en yuksek piyasa degeri (milyon euro). Kullanici da milyon girer.
    value: (a) => (a.marketValue == null ? null : a.marketValue / 1_000_000),
    format: (v) => `€${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')}M`,
  },
  {
    key: 'clubCount',
    label: 'KARİYER TAKIMI',
    hint: 'kaç takım?',
    value: (a) => a.clubCount,
    format: (v) => `${v} takım`,
  },
  {
    key: 'heightCm',
    label: 'BOY',
    hint: 'cm',
    value: (a) => a.heightCm,
    format: (v) => `${v} cm`,
  },
  {
    key: 'birthYear',
    label: 'DOĞUM TARİHİ',
    hint: 'yıl',
    value: (a) => a.birthYear,
    format: (v, a) => a.dateOfBirth || `${v}`,
  },
];

const state = {
  names: ['HİKMET', 'MERT'],
  resetOnNewGame: true,
  scores: [0, 0],
  round: 0,
  current: null, // {name, portraitUrl, answers}
  activeRow: 0, // su an oynanan satirin indexi
  rowRevealed: false, // aktif satirin sonucu acildi mi
  roundWins: [0, 0], // bu turda satir bazinda kazanimlar
};

// ---- kalici ayarlar ----
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('gf.settings') || '{}');
    if (Array.isArray(saved.names) && saved.names.length === 2) state.names = saved.names;
    if (typeof saved.resetOnNewGame === 'boolean') state.resetOnNewGame = saved.resetOnNewGame;
  } catch {
    /* varsayilanlarla devam */
  }
}
function saveSettings() {
  localStorage.setItem(
    'gf.settings',
    JSON.stringify({ names: state.names, resetOnNewGame: state.resetOnNewGame }),
  );
}

// ---- ekran gecisleri ----
const screens = {
  menu: document.getElementById('screen-menu'),
  select: document.getElementById('screen-select'),
  mode: document.getElementById('screen-mode'),
  online: document.getElementById('screen-online'),
  settings: document.getElementById('screen-settings'),
  game: document.getElementById('screen-game'),
  quit: document.getElementById('screen-quit'),
};
function show(name) {
  for (const el of Object.values(screens)) el.classList.remove('is-active');
  screens[name].classList.add('is-active');
}

// ---- yardimcilar ----
const $ = (sel) => document.querySelector(sel);
const clampNumber = (raw) => {
  const cleaned = String(raw).replace(',', '.').replace(/[^0-9.]/g, '');
  if (cleaned === '') return null; // bos girdi: 0 degil, "tahmin yok"
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

function toast(message, ms = 3200) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

function setPrimary(text, action, disabled = false) {
  const primary = $('#btn-primary');
  primary.textContent = text;
  primary.dataset.action = action;
  primary.disabled = disabled;
}

// ---- tahtayi kur ----
function renderRows(rowsArr = ROWS) {
  const container = $('#rows');
  container.innerHTML = '';

  rowsArr.forEach((row, index) => {
    const el = document.createElement('div');
    el.className = 'row is-locked';
    el.dataset.key = row.key;
    el.dataset.index = index;
    el.innerHTML = `
      <div class="row__cell" data-side="0">
        <input inputmode="decimal" placeholder="${row.hint}" aria-label="${state.names[0]} ${row.label}" disabled />
        <span class="row__diff"></span>
      </div>
      <div class="row__label">
        <b>${row.label}</b>
        <span class="row__answer" data-answer></span>
      </div>
      <div class="row__cell" data-side="1">
        <input inputmode="decimal" placeholder="${row.hint}" aria-label="${state.names[1]} ${row.label}" disabled />
        <span class="row__diff"></span>
      </div>`;
    container.appendChild(el);
  });
}

function updateScoreboard() {
  $('#score-name1').textContent = state.names[0];
  $('#score-name2').textContent = state.names[1];
  $('#score-value1').textContent = state.scores[0];
  $('#score-value2').textContent = state.scores[1];
}

/** Verilen satiri aktif eder: girisleri acar, digerlerini kilitler. */
function setActiveRow(index) {
  state.activeRow = index;
  state.rowRevealed = false;

  document.querySelectorAll('.row').forEach((rowEl) => {
    const i = Number(rowEl.dataset.index);
    const inputs = rowEl.querySelectorAll('input');
    rowEl.classList.remove('is-active', 'is-locked');

    if (i === index) {
      rowEl.classList.add('is-active');
      inputs.forEach((input) => {
        input.disabled = false;
      });
    } else if (i > index) {
      rowEl.classList.add('is-locked');
      inputs.forEach((input) => {
        input.disabled = true;
      });
    }
  });

  $('#round-tag').textContent = `Satır ${index + 1}/${ROWS.length}`;
  setPrimary('GÖSTER', 'reveal-row');
  // Aktif satirin ilk girisine odaklan.
  document.querySelector(`.row[data-index="${index}"] input`)?.focus();
}

// ---- yeni tur (yeni oyuncu) ----
async function nextRound() {
  setPrimary('YÜKLENİYOR…', 'reveal-row', true);

  try {
    const res = await fetch('/api/game/random');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    state.current = await res.json();
  } catch (err) {
    toast(`Oyuncu alınamadı: ${err.message}`);
    setPrimary('TEKRAR DENE', 'next');
    return;
  }

  state.round += 1;
  state.roundWins = [0, 0];

  $('#hero-name').textContent = state.current.name;
  const photo = $('#hero-photo');
  photo.src = state.current.portraitUrl || '';
  photo.alt = state.current.name;

  renderRows();
  updateScoreboard();
  for (const card of document.querySelectorAll('.scorecard')) card.classList.remove('is-winner');

  setActiveRow(0);
}

/**
 * "Goster" akisi: once iki oyuncunun da tahmin girdigini dogrular, sonra
 * aktif satiri acar/puanlar ve tek basista bir sonraki satiri aktif eder
 * (son satirda "Sonraki Oyuncu"ya gecer).
 */
function submitRow() {
  if (state.rowRevealed || !state.current) return;

  const rowEl = document.querySelector(`.row[data-index="${state.activeRow}"]`);
  const inputs = rowEl.querySelectorAll('input');
  const filled = [clampNumber(inputs[0].value), clampNumber(inputs[1].value)];

  // Iki oyuncu da tahmin girmeden diger satira gecilmez.
  if (filled[0] == null || filled[1] == null) {
    const missing = filled[0] == null ? 0 : 1;
    toast(`${state.names[missing]} tahminini girmeli.`, 2200);
    inputs[missing].focus();
    return;
  }

  revealRow();

  if (state.activeRow >= ROWS.length - 1) {
    announceRound();
    setPrimary('SONRAKİ OYUNCU ›', 'next');
  } else {
    setActiveRow(state.activeRow + 1); // butonu tekrar "GOSTER" yapar
  }
}

// ---- aktif satiri ac ve puanla ----
function revealRow() {
  const row = ROWS[state.activeRow];
  const rowEl = document.querySelector(`.row[data-index="${state.activeRow}"]`);
  const inputs = rowEl.querySelectorAll('input');
  const cells = rowEl.querySelectorAll('.row__cell');
  const answerEl = rowEl.querySelector('[data-answer]');
  const truth = row.value(state.current.answers);

  for (const input of inputs) input.disabled = true;
  rowEl.classList.remove('is-active');
  rowEl.classList.add('is-done');
  state.rowRevealed = true;

  // Veri yok: satir puanlanmaz.
  if (truth == null) {
    answerEl.textContent = 'veri yok';
    return;
  }

  answerEl.textContent = row.format(truth, state.current.answers);

  const guesses = [clampNumber(inputs[0].value), clampNumber(inputs[1].value)];
  const diffs = guesses.map((g) => (g == null ? Infinity : Math.abs(g - truth)));
  const best = Math.min(diffs[0], diffs[1]);

  diffs.forEach((d, i) => {
    const cell = cells[i];
    const diffEl = cell.querySelector('.row__diff');
    if (d === best) {
      cell.classList.add('is-win');
      state.roundWins[i] += 1;
      state.scores[i] += 1;
    } else {
      cell.classList.add('is-lose');
    }
    diffEl.textContent = d === 0 ? 'tam isabet!' : `fark ${formatDiff(d, row.key)}`;
  });

  updateScoreboard();
  flashLeader();
}

function formatDiff(d, key) {
  if (key === 'marketValue') return `${d.toFixed(1)}M`;
  return `${Math.round(d)}`;
}

/** Su anki toplam skora gore onde olan karti vurgular. */
function flashLeader() {
  const cards = document.querySelectorAll('.scorecard');
  cards.forEach((c) => c.classList.remove('is-winner'));
  if (state.scores[0] !== state.scores[1]) {
    cards[state.scores[0] > state.scores[1] ? 0 : 1].classList.add('is-winner');
  }
}

function announceRound() {
  const [a, b] = state.roundWins;
  let msg;
  if (a === b) {
    msg = `Bu oyuncuda berabere: ${a}-${b}. Toplam ${state.names[0]} ${state.scores[0]} – ${state.scores[1]} ${state.names[1]}`;
  } else {
    const winner = a > b ? state.names[0] : state.names[1];
    msg = `Bu oyuncuyu ${winner} aldı (${Math.max(a, b)}-${Math.min(a, b)}). Toplam ${state.scores[0]}–${state.scores[1]}`;
  }
  toast(msg);
}

// ---- oyunu baslat ----
function startClosestGame() {
  if (state.resetOnNewGame) {
    state.scores = [0, 0];
    state.round = 0;
  }
  updateScoreboard();
  show('game');
  nextRound();
}

// ---- ayarlar ekrani ----
function openSettings() {
  $('#setting-name1').value = state.names[0];
  $('#setting-name2').value = state.names[1];
  $('#setting-reset').checked = state.resetOnNewGame;
  $('#settings-hint').textContent = '';
  show('settings');
}
function saveSettingsFromForm() {
  const n1 = $('#setting-name1').value.trim().toUpperCase() || 'HİKMET';
  const n2 = $('#setting-name2').value.trim().toUpperCase() || 'MERT';
  state.names = [n1, n2];
  state.resetOnNewGame = $('#setting-reset').checked;
  saveSettings();
  updateScoreboard();
  $('#settings-hint').textContent = 'Kaydedildi ✓';
}

// ---- olay yonlendirme ----
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  switch (target.dataset.action) {
    case 'open-play':
      leaveOnlineIfAny();
      show('select');
      break;
    case 'open-closest-mode':
      leaveOnlineIfAny();
      show('mode');
      break;
    case 'open-settings':
      openSettings();
      break;
    case 'save-settings':
      saveSettingsFromForm();
      break;
    case 'back-menu':
      leaveOnlineIfAny();
      show('menu');
      break;
    case 'start-closest':
      startClosestGame();
      break;
    case 'reveal-row':
      submitRow();
      break;
    case 'next':
      nextRound();
      break;
    case 'quit':
      show('quit');
      break;
    // --- online ---
    case 'open-online':
      openOnline();
      break;
    case 'online-create':
      onlineCreate();
      break;
    case 'online-join':
      onlineJoin();
      break;
    case 'online-start':
      online.socket?.emit('game:start');
      break;
    case 'online-leave':
      leaveOnlineIfAny();
      show('mode');
      break;
    case 'online-guess':
      onlineGuess();
      break;
    case 'online-next':
      online.socket?.emit('game:next');
      break;
    default:
      break;
  }
});

// Enter: aktif buton neyse onu tetikle.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (!screens.game.classList.contains('is-active')) return;
  event.preventDefault();
  const action = $('#btn-primary').dataset.action;
  if (action === 'reveal-row') submitRow();
  else if (action === 'next') nextRound();
  else if (action === 'online-guess') onlineGuess();
  else if (action === 'online-next') online.socket?.emit('game:next');
});

// ================= ONLINE MOD =================
const online = {
  socket: null,
  roomCode: null,
  youId: null,
  oppId: null,
  isHost: false,
  players: [],
  rows: [],
  activeRow: 0,
  submitted: false,
  active: false, // online oyun ekrani acik mi
};

/** Socket baglantisini (bir kez) kurar ve olaylari baglar. */
function connectSocket() {
  if (online.socket) return online.socket;
  const socket = io();
  online.socket = socket;

  socket.on('room:update', renderLobby);
  socket.on('opponent:left', (room) => {
    toast('Rakip odadan ayrıldı.');
    online.roomCode = room.code;
    if (online.active) {
      online.active = false;
      showLobby(room.code);
    }
    renderLobby(room);
  });
  socket.on('game:error', ({ message }) => toast(message || 'Bir hata oluştu.'));
  socket.on('game:round', onOnlineRound);
  socket.on('row:progress', onOnlineProgress);
  socket.on('row:result', onOnlineResult);
  socket.on('row:active', ({ activeRow }) => setOnlineActiveRow(activeRow));
  socket.on('round:end', onOnlineRoundEnd);

  return socket;
}

function openOnline() {
  connectSocket();
  online.active = false;
  $('#online-entry').hidden = false;
  $('#online-lobby').hidden = true;
  $('#online-hint').textContent = '';
  $('#online-name').value = state.names[0];
  show('online');
}

function onlineCreate() {
  const name = $('#online-name').value.trim() || 'Oyuncu 1';
  connectSocket().emit('room:create', { name }, (res) => {
    if (!res?.ok) return ($('#online-hint').textContent = res?.error || 'Oda kurulamadı.');
    online.roomCode = res.code;
    online.youId = res.youId;
    online.isHost = true;
    showLobby(res.code);
  });
}

function onlineJoin() {
  const name = $('#online-name').value.trim() || 'Oyuncu 2';
  const code = $('#online-code').value.trim();
  if (!/^\d{4}$/.test(code)) return ($('#online-hint').textContent = '4 haneli kodu gir.');
  connectSocket().emit('room:join', { code, name }, (res) => {
    if (!res?.ok) return ($('#online-hint').textContent = res?.error || 'Katılınamadı.');
    online.roomCode = res.code;
    online.youId = res.youId;
    online.isHost = false;
    showLobby(res.code);
  });
}

function showLobby(code) {
  $('#online-entry').hidden = true;
  $('#online-lobby').hidden = false;
  $('#room-code-value').textContent = code;
  show('online');
}

/** Lobideki oyuncu listesini ve host/baslat durumunu gunceller. */
function renderLobby(room) {
  online.players = room.players;
  online.isHost = room.hostId === online.youId;

  const list = $('#room-players');
  list.innerHTML = '';
  for (const p of room.players) {
    const li = document.createElement('li');
    li.textContent = p.name + (p.id === online.youId ? ' (sen)' : '');
    if (p.id === room.hostId) li.classList.add('is-host');
    list.appendChild(li);
  }
  if (room.players.length < 2) {
    const li = document.createElement('li');
    li.className = 'is-empty';
    li.textContent = 'Rakip bekleniyor…';
    list.appendChild(li);
  }

  const startBtn = $('#online-start');
  const canStart = online.isHost && room.players.length >= 2;
  startBtn.hidden = !canStart;
  $('#lobby-hint').textContent = canStart
    ? 'Hazırsan başlat!'
    : online.isHost
    ? 'Rakip bekleniyor…'
    : 'Host’un başlatması bekleniyor…';
}

function leaveOnlineIfAny() {
  if (online.socket && online.roomCode) online.socket.emit('room:leave');
  online.roomCode = null;
  online.active = false;
}

// ---- online oyun akisi ----
function onOnlineRound({ player, rows, room }) {
  online.rows = rows;
  online.activeRow = 0;
  online.submitted = false;
  online.active = true;
  online.isHost = room.hostId === online.youId;
  online.oppId = room.players.find((p) => p.id !== online.youId)?.id ?? null;

  // Skor tablosu: SOL = sen, SAG = rakip.
  const you = room.players.find((p) => p.id === online.youId);
  const opp = room.players.find((p) => p.id !== online.youId);
  $('#score-name1').textContent = (you?.name || 'SEN').toUpperCase();
  $('#score-name2').textContent = (opp?.name || 'RAKİP').toUpperCase();
  $('#score-value1').textContent = you?.score ?? 0;
  $('#score-value2').textContent = opp?.score ?? 0;

  $('#hero-name').textContent = player.name;
  const photo = $('#hero-photo');
  photo.src = player.portraitUrl || '';
  photo.alt = player.name;

  renderRows(online.rows);
  for (const card of document.querySelectorAll('.scorecard')) card.classList.remove('is-winner');
  show('game');
  setOnlineActiveRow(0);
}

/** Online modda yalnizca SENIN girisin (sol) aciktir. */
function setOnlineActiveRow(index) {
  online.activeRow = index;
  online.submitted = false;

  document.querySelectorAll('.row').forEach((rowEl) => {
    const i = Number(rowEl.dataset.index);
    const cells = rowEl.querySelectorAll('.row__cell');
    const inputs = rowEl.querySelectorAll('input');
    rowEl.classList.remove('is-active', 'is-locked');
    cells.forEach((c) => c.classList.remove('is-mine'));

    cells.forEach((c) => c.classList.remove('is-waiting'));

    if (i === index) {
      rowEl.classList.add('is-active');
      inputs[0].disabled = false; // sen (sol)
      inputs[1].disabled = true; // rakip (sag)
      cells[0].classList.add('is-mine');
      cells[1].classList.add('is-waiting');
      inputs[1].placeholder = 'rakip giriyor…';
    } else if (i > index) {
      rowEl.classList.add('is-locked');
      inputs.forEach((inp) => (inp.disabled = true));
    }
  });

  $('#round-tag').textContent = `Satır ${index + 1}/${online.rows.length}`;
  setPrimary('GÖNDER', 'online-guess');
  document.querySelector(`.row[data-index="${index}"] input`)?.focus();
}

function onlineGuess() {
  if (online.submitted) return;
  const input = document.querySelector(`.row[data-index="${online.activeRow}"] input`);
  if (clampNumber(input.value) == null) {
    toast('Tahminini gir.', 1800);
    input.focus();
    return;
  }
  online.socket.emit('row:guess', { value: input.value });
  input.disabled = true;
  online.submitted = true;
  setPrimary('RAKİP BEKLENİYOR…', 'online-guess', true);
}

function onOnlineProgress({ submitted }) {
  // Rakip gonderdiyse onun kutusuna isaret koy.
  if (online.oppId && submitted.includes(online.oppId)) {
    const cell = document.querySelector(
      `.row[data-index="${online.activeRow}"] .row__cell[data-side="1"]`,
    );
    const diff = cell?.querySelector('.row__diff');
    if (diff && !cell.classList.contains('is-win') && !cell.classList.contains('is-lose')) {
      diff.textContent = 'gönderdi ✓';
    }
  }
}

function onOnlineResult({ rowIndex, truthText, truthValue, guesses, winners, scores }) {
  const rowEl = document.querySelector(`.row[data-index="${rowIndex}"]`);
  const inputs = rowEl.querySelectorAll('input');
  const cells = rowEl.querySelectorAll('.row__cell');
  const answerEl = rowEl.querySelector('[data-answer]');
  const key = online.rows[rowIndex].key;

  rowEl.classList.remove('is-active');
  rowEl.classList.add('is-done');
  answerEl.textContent = truthText;

  const sideId = [online.youId, online.oppId];
  sideId.forEach((id, side) => {
    const guess = guesses[id];
    inputs[side].value = guess == null ? '' : guess;
    inputs[side].disabled = true;
    const cell = cells[side];
    const diffEl = cell.querySelector('.row__diff');
    cell.classList.remove('is-win', 'is-lose');
    if (winners.includes(id)) cell.classList.add('is-win');
    else if (winners.length) cell.classList.add('is-lose');

    if (truthValue == null || guess == null) diffEl.textContent = '—';
    else diffEl.textContent =
      Math.abs(guess - truthValue) === 0 ? 'tam isabet!' : `fark ${formatDiff(Math.abs(guess - truthValue), key)}`;
  });

  $('#score-value1').textContent = scores[online.youId] ?? 0;
  $('#score-value2').textContent = scores[online.oppId] ?? 0;
  flashOnlineLeader(scores);
}

function flashOnlineLeader(scores) {
  const you = scores[online.youId] ?? 0;
  const opp = scores[online.oppId] ?? 0;
  const cards = document.querySelectorAll('.scorecard');
  cards.forEach((c) => c.classList.remove('is-winner'));
  if (you !== opp) cards[you > opp ? 0 : 1].classList.add('is-winner');
}

function onOnlineRoundEnd({ scores }) {
  const you = scores[online.youId] ?? 0;
  const opp = scores[online.oppId] ?? 0;
  const verdict = you > opp ? 'Öndesin! 🎉' : you < opp ? 'Rakip önde.' : 'Berabere.';
  toast(`Bu oyuncu bitti. ${verdict} Toplam ${you}–${opp}`);

  if (online.isHost) setPrimary('SONRAKİ OYUNCU ›', 'online-next');
  else setPrimary('HOST BEKLENİYOR…', 'online-next', true);
}

// ---- baslat ----
loadSettings();
updateScoreboard();
show('menu');
