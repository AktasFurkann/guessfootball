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
  names: ['OYUNCU 1', 'OYUNCU 2'],
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
  length: document.getElementById('screen-length'),
  mode: document.getElementById('screen-mode'),
  online: document.getElementById('screen-online'),
  settings: document.getElementById('screen-settings'),
  game: document.getElementById('screen-game'),
  squad: document.getElementById('screen-squad'),
  quit: document.getElementById('screen-quit'),
};
let currentGameScreen = 'game';
let settingsReturn = 'menu';
let newGameVotes = new Set();

function show(name) {
  for (const el of Object.values(screens)) el.classList.remove('is-active');
  screens[name].classList.add('is-active');
  if (name === 'game' || name === 'squad') currentGameScreen = name;
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

// ================= SES + SIRA SAYACI =================
const TURN_SECONDS = 15; // src/realtime.js içindeki süreyle aynı tutulur
let _audioCtx = null;

function ensureAudio() {
  if (!_audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    _audioCtx = new Ctor();
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
  return _audioCtx;
}

function tone(freq, offset, duration, opts = {}) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const { type = 'sine', gain = 0.16 } = opts;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  const t0 = ctx.currentTime + offset;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

/** Sıra sana geçti: belirgin iki tonlu "ding-dong". */
function playYourTurn() {
  tone(659, 0, 0.12, { type: 'sine', gain: 0.22 });
  tone(880, 0.11, 0.2, { type: 'sine', gain: 0.22 });
}
/** Sıra rakibe geçti: kısa, alçak bir tık. */
function playSwitch() {
  tone(330, 0, 0.08, { type: 'sine', gain: 0.12 });
}
function playTick() {
  tone(880, 0, 0.045, { type: 'square', gain: 0.07 });
}
function playTock() {
  tone(440, 0, 0.05, { type: 'square', gain: 0.07 });
}
function playTimesUp() {
  tone(523, 0, 0.16, { type: 'sawtooth', gain: 0.13 });
  tone(392, 0.17, 0.24, { type: 'sawtooth', gain: 0.13 });
}

const countdown = { id: null, remaining: 0, tick: 0, tickOn: false };

function setTurnTimer(seconds) {
  for (const id of ['turn-timer', 'sq-timer']) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (seconds == null) {
      el.hidden = true;
      el.classList.remove('is-low');
    } else {
      el.hidden = false;
      el.textContent = `⏱ ${seconds}`;
      el.classList.toggle('is-low', seconds <= 5);
    }
  }
}

function stopCountdown() {
  if (countdown.id) {
    clearInterval(countdown.id);
    countdown.id = null;
  }
  countdown.remaining = 0;
  setTurnTimer(null);
}

/**
 * Geri sayımı başlatır. `tick` doğruysa tik-tak sesi çalar (genelde sıra
 * sende olduğunda çalar; rakip sırasında görsel sayaç kalır ama sessizdir).
 */
function startCountdown(seconds = TURN_SECONDS, { tick = false } = {}) {
  stopCountdown();
  const n = Number(seconds) || TURN_SECONDS;
  countdown.remaining = n;
  countdown.tick = 0;
  countdown.tickOn = !!tick;
  setTurnTimer(n);
  if (countdown.tickOn) playTick();
  countdown.id = setInterval(() => {
    countdown.remaining -= 1;
    countdown.tick += 1;
    if (countdown.remaining <= 0) {
      stopCountdown();
      if (countdown.tickOn) playTimesUp();
      return;
    }
    setTurnTimer(countdown.remaining);
    if (!countdown.tickOn) return;
    if (countdown.remaining <= 5) {
      (countdown.tick % 2 === 0 ? playTock : playTick)();
    } else {
      playTick();
    }
  }, 1000);
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
  currentLocalMode = 'closest';
  if (state.resetOnNewGame) {
    state.scores = [0, 0];
    state.round = 0;
  }
  updateScoreboard();
  show('game');
  nextRound();
}

// ---- ayarlar ekrani ----
function openSettings(returnTo = 'menu') {
  settingsReturn = returnTo;
  $('#setting-name1').value = state.names[0];
  $('#setting-name2').value = state.names[1];
  $('#setting-reset').checked = state.resetOnNewGame;
  $('#settings-hint').textContent = '';
  show('settings');
}
function saveSettingsFromForm() {
  const n1 = $('#setting-name1').value.trim().toUpperCase() || 'OYUNCU 1';
  const n2 = $('#setting-name2').value.trim().toUpperCase() || 'OYUNCU 2';
  state.names = [n1, n2];
  state.resetOnNewGame = $('#setting-reset').checked;
  saveSettings();
  updateScoreboard();
  $('#settings-hint').textContent = 'Kaydedildi ✓';
}

// ---- oyun ici menü + çıkış onayı ----
function openPauseMenu() {
  $('#quit-confirm').hidden = true;
  $('#pause-menu').hidden = false;
}
function closePauseMenu() {
  $('#pause-menu').hidden = true;
  $('#quit-confirm').hidden = true;
}
function showQuitConfirm() {
  $('#pause-menu').hidden = true;
  $('#quit-confirm').hidden = false;
}
function cancelQuit() {
  $('#quit-confirm').hidden = true;
  $('#pause-menu').hidden = false;
}
function confirmQuit() {
  closePauseMenu();
  $('#newgame-confirm').hidden = true;
  newGameVotes = new Set();
  settingsReturn = 'menu';
  leaveOnlineIfAny();
  show('menu');
}

// ---- yeni oyun (iki oyuncu onayi) ----
function requestNewGame() {
  closePauseMenu();
  if (online.active && online.socket && online.roomCode) {
    online.socket.emit('game:new');
    setPrimary('BEKLENİYOR…', 'new-game', true);
    setPrimarySquad('BEKLENİYOR…', 'new-game', true);
    toast('Yeni oyun isteği gönderildi. Rakip onaylayınca başlar.');
    return;
  }
  openNewGameConfirm();
}

function openNewGameConfirm() {
  closePauseMenu();
  newGameVotes = new Set();
  $('#newgame-name-0').textContent = state.names[0];
  $('#newgame-name-1').textContent = state.names[1];
  for (const side of [0, 1]) {
    const btn = $(`#newgame-vote-${side}`);
    btn.disabled = false;
    btn.classList.remove('is-voted');
    btn.innerHTML = `<span class="newgame-vote-name" id="newgame-name-${side}">${state.names[side]}</span> — EVET`;
  }
  $('#newgame-confirm').hidden = false;
}

function closeNewGameConfirm() {
  $('#newgame-confirm').hidden = true;
  newGameVotes = new Set();
}

function voteLocalNewGame(side) {
  if (![0, 1].includes(side)) return;
  const btn = $(`#newgame-vote-${side}`);
  if (newGameVotes.has(side) || btn.disabled) return;
  newGameVotes.add(side);
  btn.disabled = true;
  btn.classList.add('is-voted');
  btn.innerHTML = `<span class="newgame-vote-name">${state.names[side]}</span> — ONAYLANDI ✓`;

  if (newGameVotes.has(0) && newGameVotes.has(1)) {
    startLocalNewGame();
  }
}

function startLocalNewGame() {
  closeNewGameConfirm();
  if (currentLocalMode === 'compare') startCompareGame();
  else if (currentLocalMode === 'squad') startSquadGame(squad.length);
  else if (currentLocalMode === 'superlig') startSuperligGame(squad.length);
  else if (currentLocalMode === 'market') startMarketGame(squad.length);
  else startClosestGame();
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
    case 'choose-game':
      leaveOnlineIfAny();
      chooseGame(target.dataset.mode);
      break;
    case 'choose-length':
      chooseLength(target.dataset.length);
      break;
    case 'mode-local':
      startLocalGame();
      break;
    case 'mode-online':
      openOnline(pendingGameMode, pendingGameLength);
      break;
    case 'online-dice-roll':
      online.socket?.emit('dice:roll');
      $('#odice-btn').disabled = true;
      break;
    case 'open-settings':
      openSettings('menu');
      break;
    case 'save-settings':
      saveSettingsFromForm();
      break;
    case 'back-menu':
      if (settingsReturn === 'game') {
        settingsReturn = 'menu';
        show(currentGameScreen);
        break;
      }
      leaveOnlineIfAny();
      show('menu');
      break;
    case 'open-pause':
      openPauseMenu();
      break;
    case 'pause-resume':
      closePauseMenu();
      break;
    case 'pause-settings':
      closePauseMenu();
      openSettings('game');
      break;
    case 'pause-quit':
      showQuitConfirm();
      break;
    case 'quit-confirm-yes':
      confirmQuit();
      break;
    case 'quit-confirm-no':
      cancelQuit();
      break;
    case 'start-closest':
      startClosestGame();
      break;
    case 'start-compare':
      startCompareGame();
      break;
    case 'start-squad':
      startSquadGame();
      break;
    case 'start-superlig':
      startSuperligGame();
      break;
    case 'squad-roll':
      squadRollDice();
      break;
    case 'squad-send':
      squadSend();
      break;
    case 'squad-next':
      squadNextRound();
      break;
    case 'reveal-row':
      submitRow();
      break;
    case 'compare-guess':
      compareSubmit();
      break;
    case 'compare-next':
      compareNextRound();
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
    case 'online-compare-guess':
      onlineCompareGuess();
      break;
    case 'online-squad-send':
      onlineSquadSend();
      break;
    case 'online-superlig-send':
      onlineSuperligSend();
      break;
    case 'online-market-send':
      onlineMarketSend();
      break;
    case 'online-next-round':
      online.socket?.emit('game:next-round');
      break;
    case 'new-game':
      requestNewGame();
      break;
    case 'newgame-vote':
      voteLocalNewGame(Number(target.dataset.side));
      break;
    case 'newgame-cancel':
      closeNewGameConfirm();
      break;
    default:
      break;
  }
});

// Oyun ici menünün arka planına tıklayınca menüyü kapat (devam et).
document.addEventListener('click', (event) => {
  if (event.target !== $('#pause-menu')) return;
  closePauseMenu();
});

// Enter: aktif buton neyse onu tetikle.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (!$('#newgame-confirm').hidden) return;

  // Kadro modu: oneri listesi kapaliyken Enter aktif butonu tetikler.
  if (screens.squad.classList.contains('is-active')) {
    const openList = document.querySelector('#screen-squad .suggest:not([hidden])');
    if (openList) return; // acik liste varsa secimi autocomplete yapar
    event.preventDefault();
    const action = $('#sq-btn').dataset.action;
    if (action === 'squad-send') squadSend();
    else if (action === 'squad-next') squadNextRound();
    else if (action === 'online-squad-send') onlineSquadSend();
    else if (action === 'online-superlig-send') onlineSuperligSend();
    else if (action === 'online-market-send') onlineMarketSend();
    else if (action === 'online-next-round') online.socket?.emit('game:next-round');
    else if (action === 'new-game') requestNewGame();
    return;
  }

  if (!screens.game.classList.contains('is-active')) return;
  event.preventDefault();
  const action = $('#btn-primary').dataset.action;
  if (action === 'reveal-row') submitRow();
  else if (action === 'next') nextRound();
  else if (action === 'online-guess') onlineGuess();
  else if (action === 'online-next') online.socket?.emit('game:next');
  else if (action === 'online-next-round') online.socket?.emit('game:next-round');
  else if (action === 'compare-next') compareNextRound();
  else if (action === 'new-game') requestNewGame();
  // compare-guess: Enter otomatik tamamlamada secim icin kullanildigindan
  // butona birakilir (asagida autocomplete Enter'i yonetir).
});

// ================= OYUN MODU SEÇİMİ =================
const MODE_TITLES = {
  closest: 'En Yakın Tahmin',
  compare: 'Kariyer Kıyası',
  squad: 'Milli Kadro',
  superlig: 'Süper Lig Gol',
  market: 'Bonservis Avı',
};
// Kadro kuran modlar: uzun/kısa oyun seçimi sunulur.
const DRAFT_MODES = new Set(['squad', 'superlig', 'market']);
let pendingGameMode = 'closest';
let pendingGameLength = 'short';
let currentLocalMode = 'closest';

function chooseGame(mode) {
  pendingGameMode = MODE_TITLES[mode] ? mode : 'closest';
  pendingGameLength = 'short';
  if (DRAFT_MODES.has(pendingGameMode)) {
    $('#length-title').textContent = MODE_TITLES[pendingGameMode];
    show('length');
  } else {
    $('#mode-title').textContent = MODE_TITLES[pendingGameMode];
    show('mode');
  }
}

function chooseLength(length) {
  pendingGameLength = length === 'long' ? 'long' : 'short';
  $('#mode-title').textContent = MODE_TITLES[pendingGameMode];
  show('mode');
}

function startLocalGame() {
  if (pendingGameMode === 'compare') startCompareGame();
  else if (pendingGameMode === 'squad') startSquadGame(pendingGameLength);
  else if (pendingGameMode === 'superlig') startSuperligGame(pendingGameLength);
  else if (pendingGameMode === 'market') startMarketGame(pendingGameLength);
  else startClosestGame();
}

// ================= ONLINE MOD =================
const online = {
  socket: null,
  mode: 'closest',
  length: 'short',
  roomCode: null,
  youId: null,
  oppId: null,
  isHost: false,
  players: [],
  rows: [],
  activeRow: 0,
  submitted: false,
  active: false, // online oyun ekrani acik mi
  // turn-based (compare/squad) durum
  turnId: null,
  center: null, // compare orta oyuncu
  slots: {}, // squad: id -> slot dizisi
  country: null, // squad ulke
  target: null, // squad hedef slot
};

/** Socket baglantisini (bir kez) kurar ve olaylari baglar. */
function connectSocket() {
  if (online.socket) return online.socket;
  const socket = io();
  online.socket = socket;

  socket.on('room:update', renderLobby);
  socket.on('opponent:left', (room) => {
    stopCountdown();
    toast('Rakip odadan ayrıldı.');
    online.roomCode = room.code;
    if (online.active) {
      online.active = false;
      showLobby(room.code);
    }
    renderLobby(room);
  });
  socket.on('game:error', ({ message }) => toast(message || 'Bir hata oluştu.'));
  socket.on('game:new-vote', ({ votes }) => {
    toast(`Yeni oyun için ${votes || 0}/2 onay.`);
  });

  // ---- closest ----
  socket.on('game:round', onOnlineRound);
  socket.on('row:progress', onOnlineProgress);
  socket.on('row:result', onOnlineResult);
  socket.on('row:active', ({ activeRow }) => setOnlineActiveRow(activeRow));
  socket.on('round:end', onOnlineRoundEnd);
  socket.on('row:timeout', ({ by }) => {
    const mine = by?.includes(online.youId);
    toast(mine ? 'Süren doldu — boş tahmin.' : 'Rakip süreyi aştı — boş tahmin.');
    playTimesUp();
  });

  // ---- zar (compare + squad) ----
  socket.on('dice:begin', ({ room }) => {
    online.players = room.players;
    online.isHost = room.hostId === online.youId;
    online.oppId = room.players.find((p) => p.id !== online.youId)?.id ?? null;
    openOnlineDice();
  });
  socket.on('dice:update', ({ rolls }) => {
    for (const [id, v] of Object.entries(rolls)) {
      const die = $(`#odie-${id === online.youId ? 0 : 1}`);
      if (die) {
        die.classList.remove('is-rolling');
        die.textContent = DICE[v - 1] || '⚀';
      }
    }
  });
  socket.on('dice:tie', () => {
    $('#odie-0').classList.remove('is-rolling');
    $('#odie-1').classList.remove('is-rolling');
    $('#odice-result').textContent = 'Berabere! Tekrar atın.';
    const btn = $('#odice-btn');
    btn.textContent = 'TEKRAR AT';
    btn.disabled = false;
  });
  socket.on('dice:winner', ({ starterId, rolls }) => {
    for (const [id, v] of Object.entries(rolls)) {
      const die = $(`#odie-${id === online.youId ? 0 : 1}`);
      if (die) die.textContent = DICE[v - 1] || '⚀';
    }
    const side = starterId === online.youId ? 0 : 1;
    $(`#odie-${side}`).classList.add('is-winner');
    $('#odice-result').textContent = starterId === online.youId ? 'Sen başlıyorsun!' : 'Rakip başlıyor.';
    $('#odice-btn').hidden = true;
  });

  // ---- compare (Kariyer Kıyası) ----
  socket.on('compare:round', onOnlineCompareRound);
  socket.on('compare:guessed', ({ by, timeout }) => {
    const side = by === online.youId ? 0 : 1;
    const cell = document.querySelector(
      `#rows .row[data-index="${online.compareActiveRow}"] .row__cell[data-side="${side}"]`,
    );
    const diff = cell?.querySelector('.row__diff');
    if (diff && !cell.classList.contains('is-win') && !cell.classList.contains('is-lose')) {
      diff.textContent = timeout ? 'süre doldu ⏱' : 'yazdı ✓';
    }
    if (timeout) {
      toast(by === online.youId ? 'Süren doldu — boş tahmin.' : 'Rakip süreyi aştı — boş tahmin.');
    }
  });
  socket.on('compare:turn', ({ turnId }) => setOnlineCompareTurn(turnId));
  socket.on('compare:result', onOnlineCompareResult);
  socket.on('compare:active', ({ activeRow, turnId }) => {
    online.compareActiveRow = activeRow;
    setOnlineCompareTurn(turnId);
  });
  socket.on('compare:over', onOnlineCompareOver);

  // ---- squad (Milli Kadro) ----
  socket.on('squad:round', onOnlineSquadRound);
  socket.on('squad:placed', onOnlineSquadPlaced);
  socket.on('squad:turn', ({ turnId }) => setOnlineSquadTurn(turnId));
  socket.on('squad:round-done', () => {
    stopCountdown();
    squad.turn = -1;
    renderPitch(0);
    renderPitch(1);
    $('#sq-turn').textContent = '';
    $('#sq-card-0').classList.remove('is-turn');
    $('#sq-card-1').classList.remove('is-turn');
    if (online.isHost) setPrimarySquad('YENİ ÜLKE ›', 'online-next-round');
    else setPrimarySquad('HOST BEKLENİYOR…', 'online-next-round', true);
  });
  socket.on('squad:over', ({ scores }) => {
    stopCountdown();
    squad.over = true;
    squad.turn = -1;
    renderPitch(0);
    renderPitch(1);
    const a = scores[online.youId] ?? 0;
    const b = scores[online.oppId] ?? 0;
    const verdict = a > b ? 'Kazandın! 🎉' : a < b ? 'Rakip kazandı.' : 'Berabere!';
    $('#sq-turn').textContent = '';
    toast(`Kadrolar tamam — ${verdict} (${a}–${b} maç)`, 5000);
    setPrimarySquad('YENİ OYUN', 'new-game');
  });

  // ---- superlig (Süper Lig Gol) ----
  socket.on('superlig:round', onOnlineSuperligRound);
  socket.on('superlig:placed', onOnlineSuperligPlaced);
  socket.on('superlig:turn', ({ turnId }) => setOnlineSuperligTurn(turnId));
  socket.on('superlig:round-done', () => {
    stopCountdown();
    squad.turn = -1;
    renderPitch(0);
    renderPitch(1);
    $('#sq-turn').textContent = '';
    $('#sq-card-0').classList.remove('is-turn');
    $('#sq-card-1').classList.remove('is-turn');
    if (online.isHost) setPrimarySquad('YENİ TAKIM ›', 'online-next-round');
    else setPrimarySquad('HOST BEKLENİYOR…', 'online-next-round', true);
  });
  socket.on('superlig:over', ({ scores }) => {
    stopCountdown();
    squad.over = true;
    squad.turn = -1;
    renderPitch(0);
    renderPitch(1);
    const a = scores[online.youId] ?? 0;
    const b = scores[online.oppId] ?? 0;
    const verdict = a > b ? 'Kazandın! 🎉' : a < b ? 'Rakip kazandı.' : 'Berabere!';
    $('#sq-turn').textContent = '';
    toast(`Kadrolar tamam — ${verdict} (${a}–${b} gol)`, 5000);
    setPrimarySquad('YENİ OYUN', 'new-game');
  });

  // ---- market (Bonservis Avı) ----
  socket.on('market:round', onOnlineMarketRound);
  socket.on('market:placed', onOnlineMarketPlaced);
  socket.on('market:turn', ({ turnId }) => setOnlineMarketTurn(turnId));
  socket.on('market:round-done', () => {
    stopCountdown();
    squad.turn = -1;
    renderPitch(0);
    renderPitch(1);
    $('#sq-turn').textContent = '';
    $('#sq-card-0').classList.remove('is-turn');
    $('#sq-card-1').classList.remove('is-turn');
    if (online.isHost) setPrimarySquad('YENİ TAKIM ›', 'online-next-round');
    else setPrimarySquad('HOST BEKLENİYOR…', 'online-next-round', true);
  });
  socket.on('market:over', ({ scores }) => {
    stopCountdown();
    squad.over = true;
    squad.turn = -1;
    renderPitch(0);
    renderPitch(1);
    const a = scores[online.youId] ?? 0;
    const b = scores[online.oppId] ?? 0;
    const verdict = a > b ? 'Kazandın! 🎉' : a < b ? 'Rakip kazandı.' : 'Berabere!';
    $('#sq-turn').textContent = '';
    toast(`Kadrolar tamam — ${verdict} (${formatFee(a)}–${formatFee(b)})`, 5000);
    setPrimarySquad('YENİ OYUN', 'new-game');
  });

  return socket;
}

function openOnline(mode = 'closest', length = 'short') {
  online.mode = ['closest', 'compare', 'squad', 'superlig', 'market'].includes(mode) ? mode : 'closest';
  online.length = length === 'long' ? 'long' : 'short';
  connectSocket();
  online.active = false;
  $('#online-entry').hidden = false;
  $('#online-lobby').hidden = true;
  $('#online-hint').textContent = '';
  $('#online-dice').hidden = true;
  $('#online-name').value = state.names[0];
  const title = $('#screen-online h2');
  if (title) title.textContent = `Online — ${MODE_TITLES[online.mode] || 'Oyna'}`;
  show('online');
}

function onlineCreate() {
  const name = $('#online-name').value.trim() || 'Oyuncu 1';
  connectSocket().emit('room:create', { name, mode: online.mode, length: online.length }, (res) => {
    if (!res?.ok) return ($('#online-hint').textContent = res?.error || 'Oda kurulamadı.');
    online.roomCode = res.code;
    online.youId = res.youId;
    online.isHost = true;
    if (res.mode) online.mode = res.mode;
    if (res.length) online.length = res.length;
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
    online.mode = res.mode || 'closest';
    online.length = res.length || 'short';
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
  stopCountdown();
  online.roomCode = null;
  online.active = false;
  $('#online-dice').hidden = true;
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
  startCountdown(TURN_SECONDS, { tick: true });
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
  stopCountdown();
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
  stopCountdown();
  const you = scores[online.youId] ?? 0;
  const opp = scores[online.oppId] ?? 0;
  const verdict = you > opp ? 'Öndesin! 🎉' : you < opp ? 'Rakip önde.' : 'Berabere.';
  toast(`Bu oyuncu bitti. ${verdict} Toplam ${you}–${opp}`);

  if (online.isHost) setPrimary('SONRAKİ OYUNCU ›', 'online-next');
  else setPrimary('HOST BEKLENİYOR…', 'online-next', true);
}

// ================= KARİYER KIYASI MODU =================
const compare = {
  center: null, // {id,name,portraitUrl,rows,values}
  rows: [],
  activeRow: 0,
  revealed: false,
  round: 0,
  picks: [null, null], // aktif satir icin {id,name}
  statsCache: new Map(), // id -> values
};

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Kiyas degerini ekranda gosterime cevirir. */
function compareFormat(key, v) {
  if (v == null) return '—';
  if (key === 'marketValue') {
    const m = v / 1_000_000;
    return `€${m.toFixed(m < 10 ? 1 : 0).replace('.', ',')}M`;
  }
  if (key === 'heightCm') return `${v} cm`;
  return `${v}`;
}

function compareDiffLabel(key, d) {
  if (key === 'marketValue') return `fark €${(d / 1_000_000).toFixed(1)}M`;
  return `fark ${Math.round(d)}`;
}

async function fetchCompareStats(id) {
  if (compare.statsCache.has(id)) return compare.statsCache.get(id);
  const res = await fetch(`/api/game/compare/player/${id}`);
  if (!res.ok) throw new Error('istatistik alınamadı');
  const data = await res.json();
  compare.statsCache.set(id, data.values);
  return data.values;
}

async function startCompareGame() {
  currentLocalMode = 'compare';
  if (state.resetOnNewGame) {
    state.scores = [0, 0];
    state.round = 0;
  }
  compare.round = 0;
  compare.statsCache.clear();
  show('game');
  await compareNextRound();
}

async function compareNextRound() {
  setPrimary('YÜKLENİYOR…', 'compare-guess', true);
  try {
    const res = await fetch('/api/game/compare/random');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    compare.center = await res.json();
  } catch (err) {
    toast(`Oyuncu alınamadı: ${err.message}`);
    setPrimary('TEKRAR DENE', 'compare-next');
    return;
  }

  compare.rows = compare.center.rows;
  compare.activeRow = 0;
  compare.round += 1;

  $('#score-name1').textContent = state.names[0];
  $('#score-name2').textContent = state.names[1];
  $('#score-value1').textContent = state.scores[0];
  $('#score-value2').textContent = state.scores[1];

  $('#hero-name').textContent = compare.center.name;
  const photo = $('#hero-photo');
  photo.src = compare.center.portraitUrl || '';
  photo.alt = compare.center.name;

  renderCompareRows();
  for (const card of document.querySelectorAll('.scorecard')) card.classList.remove('is-winner');
  setCompareActiveRow(0);
}

function renderCompareRows() {
  const container = $('#rows');
  container.innerHTML = '';
  compare.rows.forEach((row, index) => {
    const el = document.createElement('div');
    el.className = 'row is-locked';
    el.dataset.index = index;
    el.innerHTML = `
      ${nameCell(0, row)}
      <div class="row__label">
        <b>${row.label}</b>
        <span class="row__answer" data-answer></span>
      </div>
      ${nameCell(1, row)}`;
    container.appendChild(el);
  });
}

function nameCell(side, row) {
  return `
    <div class="row__cell row__cell--name" data-side="${side}">
      <input type="text" class="name-input" placeholder="oyuncu ara…" autocomplete="off" disabled
             aria-label="${state.names[side]} - ${row.label}" />
      <ul class="suggest" hidden></ul>
      <span class="row__answer-name" data-name></span>
      <span class="row__diff"></span>
    </div>`;
}

function setCompareActiveRow(index) {
  compare.activeRow = index;
  compare.revealed = false;
  compare.picks = [null, null];

  document.querySelectorAll('#rows .row').forEach((rowEl) => {
    const i = Number(rowEl.dataset.index);
    const inputs = rowEl.querySelectorAll('input');
    rowEl.classList.remove('is-active', 'is-locked');
    if (i === index) {
      rowEl.classList.add('is-active');
      inputs.forEach((inp, side) => {
        inp.disabled = false;
        inp.value = '';
        attachAutocomplete(inp, side);
      });
    } else if (i > index) {
      rowEl.classList.add('is-locked');
      inputs.forEach((inp) => (inp.disabled = true));
    }
  });

  $('#round-tag').textContent = `Satır ${index + 1}/${compare.rows.length}`;
  setPrimary('GÖSTER', 'compare-guess');
  document.querySelector(`#rows .row[data-index="${index}"] input`)?.focus();
}

/** Bir isim girisine otomatik tamamlama baglar. */
function attachAutocomplete(input, side) {
  const cell = input.closest('.row__cell');
  const list = cell.querySelector('.suggest');
  let items = [];
  let active = -1;

  const hide = () => {
    list.hidden = true;
    active = -1;
  };
  const render = (results) => {
    items = results;
    list.innerHTML = results
      .map(
        (r, i) =>
          `<li data-i="${i}" class="${i === active ? 'is-active' : ''}"><b>${r.name}</b>` +
          `<small>${[r.country, r.position, r.club, r.birthYear ? `${r.birthYear}` : null]
            .filter(Boolean)
            .join(' · ')}${r.isNew ? ' · yeni' : ''}</small></li>`,
      )
      .join('');
    list.hidden = results.length === 0;
  };

  const pick = (r) => {
    if (!r) return;
    input.value = r.name;
    compare.picks[side] = { id: r.id, name: r.name };
    hide();
  };

  const run = debounce(async (q) => {
    if (q.trim().length < 2) return hide();
    try {
      // live=1: DB'de yoksa Transfermarkt'tan da ara (emekli/eksik oyuncular).
      const res = await fetch(`/api/players/search?live=1&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      active = -1;
      render(data.results || []);
    } catch {
      hide();
    }
  }, 220);

  input.oninput = () => {
    compare.picks[side] = null; // yeniden yaziyorsa secim gecersiz
    run(input.value);
  };
  input.onkeydown = (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, items.length - 1);
      render(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      render(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(items[active >= 0 ? active : 0]);
    } else if (e.key === 'Escape') {
      hide();
    }
  };
  input.onblur = () => setTimeout(hide, 150); // tiklama secimine firsat ver
  list.onmousedown = (e) => {
    const li = e.target.closest('li');
    if (li) pick(items[Number(li.dataset.i)]);
  };
}

/** Secilmemis ama yazilmis bir taraf icin ilk arama sonucunu otomatik sec. */
async function resolvePick(side) {
  if (compare.picks[side]) return compare.picks[side];
  const input = document.querySelector(`#rows .row[data-index="${compare.activeRow}"] .row__cell[data-side="${side}"] input`);
  const text = input.value.trim();
  if (!text) return null;
  try {
    const res = await fetch(`/api/players/search?q=${encodeURIComponent(text)}`);
    const data = await res.json();
    const first = data.results?.[0];
    if (first) {
      compare.picks[side] = { id: first.id, name: first.name };
      input.value = first.name;
      return compare.picks[side];
    }
  } catch {
    /* yok say */
  }
  return null;
}

async function compareSubmit() {
  if (compare.revealed || !compare.center) return;

  const [p0, p1] = await Promise.all([resolvePick(0), resolvePick(1)]);
  if (!p0 || !p1) {
    const side = !p0 ? 0 : 1;
    toast(`${state.names[side]} bir oyuncu ismi yazmalı.`, 2200);
    document.querySelector(`#rows .row[data-index="${compare.activeRow}"] .row__cell[data-side="${side}"] input`)?.focus();
    return;
  }

  setPrimary('AÇILIYOR…', 'compare-guess', true);
  let s0;
  let s1;
  try {
    [s0, s1] = await Promise.all([fetchCompareStats(p0.id), fetchCompareStats(p1.id)]);
  } catch (err) {
    toast(`Hata: ${err.message}`);
    setPrimary('GÖSTER', 'compare-guess');
    return;
  }

  const row = compare.rows[compare.activeRow];
  const key = row.key;
  const target = compare.center.values[key];
  const rowEl = document.querySelector(`#rows .row[data-index="${compare.activeRow}"]`);
  const cells = rowEl.querySelectorAll('.row__cell');
  const inputs = rowEl.querySelectorAll('input');

  rowEl.classList.remove('is-active');
  rowEl.classList.add('is-done');
  rowEl.querySelector('[data-answer]').textContent = compareFormat(key, target);
  for (const inp of inputs) inp.disabled = true;

  const picks = [p0, p1];
  const stats = [s0, s1];
  const vals = [stats[0][key], stats[1][key]];
  const diffs = vals.map((v) => (v == null || target == null ? Infinity : Math.abs(v - target)));

  // Hedef yoksa satir puanlanmaz.
  const best = target == null ? Infinity : Math.min(diffs[0], diffs[1]);

  [0, 1].forEach((side) => {
    const cell = cells[side];
    cell.querySelector('[data-name]').textContent = compareFormat(key, vals[side]);
    const diffEl = cell.querySelector('.row__diff');
    if (best !== Infinity && diffs[side] === best) {
      cell.classList.add('is-win');
      state.scores[side] += 1;
      diffEl.textContent = diffs[side] === 0 ? 'tam isabet!' : compareDiffLabel(key, diffs[side]);
    } else if (best !== Infinity) {
      cell.classList.add('is-lose');
      diffEl.textContent = compareDiffLabel(key, diffs[side]);
    } else {
      diffEl.textContent = '—';
    }
  });

  $('#score-value1').textContent = state.scores[0];
  $('#score-value2').textContent = state.scores[1];
  const cards = document.querySelectorAll('.scorecard');
  cards.forEach((c) => c.classList.remove('is-winner'));
  if (state.scores[0] !== state.scores[1]) cards[state.scores[0] > state.scores[1] ? 0 : 1].classList.add('is-winner');

  compare.revealed = true;

  if (compare.activeRow >= compare.rows.length - 1) {
    const [a, b] = state.scores;
    const verdict = a === b ? 'Berabere' : `${state.names[a > b ? 0 : 1]} önde`;
    toast(`Oyuncu bitti — ${verdict} (${a}–${b})`);
    setPrimary('SONRAKİ OYUNCU ›', 'compare-next');
  } else {
    setCompareActiveRow(compare.activeRow + 1);
  }
}

// ================= MİLLİ KADRO MODU =================
const POS_LABEL = { Kaleci: 'KL', Defans: 'DEF', 'Orta Saha': 'ORT', Forvet: 'FOR' };
// Uzun oyun (1-4-4-2) tam pozisyon kısaltmaları.
const LONG_LABEL = {
  Kaleci: 'KL',
  'Sağ Bek': 'SĞB',
  'Sol Bek': 'SLB',
  Stoper: 'STP',
  'Sağ Kanat': 'SAĞ',
  'Sol Kanat': 'SOL',
  'Ofansif Orta Saha': 'OOS',
  'Defansif Orta Saha': 'DOS',
  Santrafor: 'FOR',
};
const slotLabelOf = (key) => LONG_LABEL[key] ?? POS_LABEL[key] ?? key ?? '';
// Sahada gosterim sirasi (ust: forvet, alt: kaleci) ve her satirdaki mevki.
const PITCH_ROWS = ['Forvet', 'Orta Saha', 'Defans', 'Kaleci'];

const squad = {
  mode: 'squad', // 'squad' (Milli Kadro) | 'superlig' (Süper Lig Gol)
  length: 'short', // 'short' | 'long'
  formation: [], // [{pos, short}]
  slots: [[], []], // her taraf: [{pos, filled, player}]
  entity: null, // { key, name, image } (ulke adi veya takim id'si)
  reel: [], // cark + havuz (uygun ulke/takim listesi)
  totals: [0, 0],
  round: 0,
  over: false,
  usedIds: new Set(), // oyun boyunca kullanilan oyuncular (tekrar yok)
  usedEntities: new Set(), // gelen ulke/takim (tekrar yok)
  starter: 0, // bu turda ilk yazan (her tur donusumlu)
  turn: 0, // su an sirasi gelen oyuncu
  placed: [false, false], // bu turda yerlestirdi mi
  pick: [null, null], // aktif secim {id, name}
  target: 0, // sirasi gelenin doldurdugu slot (tiklanarak degisir)
};

/** Moda gore sabit metin/url bilgileri. */
function draftCfg() {
  if (squad.mode === 'market') {
    return {
      mode: 'market',
      entityName: 'takım',
      unit: '€M',
      searchKey: 'marketTeam',
      formationUrl: `/api/game/market/formation?length=${squad.length}`,
      poolUrl: `/api/game/market/teams?length=${squad.length}`,
      poolKey: 'teams',
      playerUrl: (id, key) => `/api/game/market/player/${id}?team=${encodeURIComponent(key)}`,
      objective: '🎯 Gelen takımdan en yüksek bonservisli kadroyu kur!',
      nextLabel: 'YENİ TAKIM ›',
      normalize: (item) => ({ key: item.id, name: item.name, image: item.crestUrl || null }),
    };
  }
  if (squad.mode === 'superlig') {
    return {
      mode: 'superlig',
      entityName: 'takım',
      unit: 'gol',
      searchKey: 'team',
      formationUrl: `/api/game/superlig/formation?length=${squad.length}`,
      poolUrl: `/api/game/superlig/teams?length=${squad.length}`,
      poolKey: 'teams',
      playerUrl: (id, key) => `/api/game/superlig/player/${id}?team=${encodeURIComponent(key)}`,
      objective: '🎯 Süper Lig takımında en çok gol atmış kadroyu kur!',
      nextLabel: 'YENİ TAKIM ›',
      normalize: (item) => ({ key: item.id, name: item.name, image: item.crestUrl || null }),
    };
  }
  return {
    mode: 'squad',
    entityName: 'ülke',
    unit: 'maç',
    searchKey: 'country',
    formationUrl: `/api/game/squad/formation?length=${squad.length}`,
    poolUrl: `/api/game/squad/countries?length=${squad.length}`,
    poolKey: 'countries',
    playerUrl: (id, key) => `/api/game/squad/player/${id}?country=${encodeURIComponent(key)}`,
    objective: '🎯 Milli takımda en çok maça çıkmış kadroyu kur!',
    nextLabel: 'YENİ ÜLKE ›',
    normalize: (item) => ({ key: item.country, name: item.country, image: item.flag || null }),
  };
}

/** Bayrak/logo "cark"ini ~2 sn dondurur, sonra gercek varlikta durur. */
function spinEntity(finalEntity) {
  return new Promise((resolve) => {
    const flag = $('#sq-flag');
    const nameEl = $('#sq-country');
    flag.classList.toggle('is-crest', squad.mode !== 'squad');
    const reel = squad.reel.length ? squad.reel : [finalEntity];
    if (reel.length < 2) {
      flag.src = finalEntity.image || '';
      nameEl.textContent = finalEntity.name;
      return resolve();
    }
    flag.classList.add('is-spinning');
    const start = Date.now();
    const tick = () => {
      const r = reel[Math.floor(Math.random() * reel.length)];
      flag.src = r.image || '';
      nameEl.textContent = r.name;
      if (Date.now() - start < 2000) {
        // Hizli baslar, sona dogru yavaslar (daha "cark" hissi).
        const t = (Date.now() - start) / 2000;
        setTimeout(tick, 60 + t * t * 160);
      } else {
        flag.classList.remove('is-spinning');
        flag.src = finalEntity.image || '';
        nameEl.textContent = finalEntity.name;
        resolve();
      }
    };
    tick();
  });
}

function remainingSlotKeys(side) {
  return [...new Set(squad.slots[side].filter((s) => !s.filled).map((s) => s.key ?? s.pos))];
}

/** Otomatik tamamlama araması için mevki filtresi (kısa: bölge, uzun: tam pozisyon). */
function squadSearchParams(side, q) {
  const cfg = draftCfg();
  const targetSlot = squad.target !== null ? squad.slots[side][squad.target] : null;
  const keys = targetSlot ? [targetSlot.key ?? targetSlot.pos] : remainingSlotKeys(side);
  const params = new URLSearchParams({ [cfg.searchKey]: squad.entity.key, limit: '60' });
  if (keys.length) {
    if (squad.length === 'long') params.set('keys', keys.join(','));
    else params.set('positions', keys.join(','));
  }
  if (q) params.set('q', q);
  return params;
}

function setSquadMode(mode, length = 'short') {
  squad.mode = mode;
  squad.length = length === 'long' ? 'long' : 'short';
  const cfg = draftCfg();
  $('#sq-objective').textContent = cfg.objective;
  $('#sq-unit-1').textContent = cfg.unit;
  $('#sq-unit-2').textContent = cfg.unit;
  $('#sq-flag').classList.toggle('is-crest', mode !== 'squad');
}

/** Bonservis değerini tek ondalık + virgülle gösterir. */
function marketNumber(v) {
  const n = Number(v) || 0;
  if (n === 0) return '0';
  return (Math.floor(n * 10) / 10).toFixed(1).replace('.', ',');
}

function formatFee(v) {
  return `€${marketNumber(v)}M`;
}

function squadTotalText(v) {
  return squad.mode === 'market' ? marketNumber(v) : `${v}`;
}

function updateSquadTotals(a, b) {
  $('#sq-total1').textContent = squadTotalText(a);
  $('#sq-total2').textContent = squadTotalText(b);
}

async function startDraftGame(mode, length = 'short') {
  currentLocalMode = mode;
  setSquadMode(mode, length);
  const cfg = draftCfg();

  // Ekrani hemen ac + "Hazırlanıyor…" goster (ilk yuklemede indeks kurulabilir).
  show('squad');
  $('#dice-title').textContent = 'Hazırlanıyor…';
  $('#dice-result').textContent = 'İlk açılışta oyuncu veritabanı hazırlanıyor';
  $('#dice-btn').hidden = true;
  $('#sq-dice').hidden = false;

  const res = await fetch(cfg.formationUrl);
  squad.formation = (await res.json()).formation;
  try {
    const pool = await (await fetch(cfg.poolUrl)).json();
    squad.reel = (pool[cfg.poolKey] || []).map(cfg.normalize);
  } catch {
    squad.reel = [];
  }
  $('#dice-btn').hidden = false;
  squad.slots = [0, 1].map(() =>
    squad.formation.map((f) => ({ pos: f.pos, key: f.key ?? f.pos, filled: false, player: null })),
  );
  squad.totals = [0, 0];
  squad.round = 0;
  squad.over = false;
  squad.usedIds = new Set();
  squad.usedEntities = new Set();

  $('#sq-name1').textContent = state.names[0];
  $('#sq-name2').textContent = state.names[1];
  updateSquadTotals(0, 0);
  $('#sq-total1').closest('.squad-total').classList.remove('is-winner', 'is-turn');
  $('#sq-total2').closest('.squad-total').classList.remove('is-winner', 'is-turn');
  for (const side of [0, 1]) $(`#sq-input-${side}`).value = '';
  renderPitch(0);
  renderPitch(1);
  show('squad');
  openDice(); // once zar: kim baslayacak
}

async function startSquadGame(length) {
  await startDraftGame('squad', length);
}

async function startSuperligGame(length) {
  await startDraftGame('superlig', length);
}

async function startMarketGame(length) {
  await startDraftGame('market', length);
}

// ---- zar ile baslayanin belirlenmesi ----
const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function openDice() {
  $('#dice-name-0').textContent = state.names[0];
  $('#dice-name-1').textContent = state.names[1];
  $('#die-0').textContent = '⚀';
  $('#die-1').textContent = '⚀';
  $('#die-0').classList.remove('is-winner');
  $('#die-1').classList.remove('is-winner');
  $('#dice-title').textContent = 'Kim başlıyor?';
  $('#dice-result').textContent = '';
  const btn = $('#dice-btn');
  btn.textContent = 'ZAR AT';
  btn.disabled = false;
  btn.hidden = false;
  $('#sq-dice').hidden = false;
}

function squadRollDice() {
  const btn = $('#dice-btn');
  btn.disabled = true;
  $('#dice-result').textContent = '';
  const d0 = $('#die-0');
  const d1 = $('#die-1');
  d0.classList.add('is-rolling');
  d1.classList.add('is-rolling');
  d0.classList.remove('is-winner');
  d1.classList.remove('is-winner');

  const start = Date.now();
  const spin = () => {
    d0.textContent = DICE[Math.floor(Math.random() * 6)];
    d1.textContent = DICE[Math.floor(Math.random() * 6)];
    if (Date.now() - start < 1300) {
      setTimeout(spin, 90);
    } else {
      const r0 = 1 + Math.floor(Math.random() * 6);
      const r1 = 1 + Math.floor(Math.random() * 6);
      d0.textContent = DICE[r0 - 1];
      d1.textContent = DICE[r1 - 1];
      d0.classList.remove('is-rolling');
      d1.classList.remove('is-rolling');

      if (r0 === r1) {
        $('#dice-result').textContent = `Berabere (${r0}-${r1}), tekrar at!`;
        btn.textContent = 'TEKRAR AT';
        btn.disabled = false;
        return;
      }
      const winner = r0 > r1 ? 0 : 1;
      $(`#die-${winner}`).classList.add('is-winner');
      $('#dice-result').textContent = `${state.names[winner]} başlıyor! (${r0}-${r1})`;
      squad.starter = winner;
      setTimeout(() => {
        $('#sq-dice').hidden = true;
        squadNextRound();
      }, 1300);
    }
  };
  spin();
}

function renderPitch(side) {
  const pitch = $(`#sq-pitch-${side}`);
  pitch.innerHTML = '';
  // Dizilişte gerçekten var olan satırları göster (kaleci yoksa kaleci satırı çıkmaz).
  const rows = PITCH_ROWS.filter((rp) => squad.formation.some((f) => f.pos === rp));
  for (const rowPos of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'pitch-row';
    squad.slots[side].forEach((slot, idx) => {
      if (slot.pos !== rowPos) return;
      const el = document.createElement('div');
      let cls = 'slot';
      if (slot.filled) cls += ' is-filled';
      else if (!squad.over && side === squad.turn) {
        cls += ' is-clickable';
        if (idx === squad.target) cls += ' is-target';
      }
      el.className = cls;
      el.dataset.slot = idx;
      if (slot.filled && slot.player) {
        const valueText = squad.mode === 'market' ? formatFee(slot.player.value) : slot.player.value;
        el.innerHTML = slot.player.timeout
          ? `<div class="slot__circle">⏱</div><div class="slot__caps">0</div><div class="slot__name">SÜRE DOLDU</div>`
          : `
            <div class="slot__circle">${slot.player.portraitUrl ? `<img src="${slot.player.portraitUrl}" alt="">` : slotLabelOf(slot.key ?? slot.pos)}</div>
            <div class="slot__caps">${valueText}</div>
            <div class="slot__name">${shortName(slot.player.name)}</div>`;
      } else {
        el.innerHTML = `<div class="slot__circle">${slotLabelOf(slot.key ?? slot.pos)}</div><div class="slot__caps"></div><div class="slot__name"></div>`;
      }
      rowEl.appendChild(el);
    });
    pitch.appendChild(rowEl);
  }
}

function shortName(name) {
  const parts = String(name).split(' ');
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name;
}

/** Havuzdan (reel) daha once gelmemis rastgele ulke/takim sec. */
function pickEntity() {
  const pool = squad.reel.filter((e) => !squad.usedEntities.has(e.key));
  const list = pool.length ? pool : squad.reel;
  return list[Math.floor(Math.random() * list.length)];
}

async function squadNextRound() {
  if (squad.over) return;
  const cfg = draftCfg();
  squad.entity = pickEntity();
  if (!squad.entity) {
    toast(`Uygun ${cfg.entityName} bulunamadı.`);
    return;
  }
  squad.usedEntities.add(squad.entity.key);
  squad.round += 1;
  squad.placed = [false, false];
  squad.pick = [null, null];
  $('#sq-round').textContent = `Tur ${squad.round}`;

  // Girisleri kilitle, temizle, bayrak carkini dondur.
  for (const side of [0, 1]) {
    const input = $(`#sq-input-${side}`);
    input.disabled = true;
    input.value = '';
    input.closest('.sq-input-wrap').classList.add('is-off');
    const list = input.closest('.sq-input-wrap').querySelector('.suggest');
    list.innerHTML = '';
    list.hidden = true;
  }
  setPrimarySquad('…', 'squad-send', true);
  await spinEntity(squad.entity);
  $('#sq-flag').alt = squad.entity.name;

  setTurnUI(squad.starter); // ilk yazan bu turda
}

/** Sirasi gelen oyuncunun girisini acar, digerini kilitler/soluklastirir. */
function setTurnUI(side) {
  squad.turn = side;
  [0, 1].forEach((s) => {
    const input = $(`#sq-input-${s}`);
    const wrap = input.closest('.sq-input-wrap');
    $(`#sq-card-${s}`).classList.toggle('is-turn', s === side);
    if (s === side) {
      wrap.classList.remove('is-off');
      input.disabled = false;
      input.placeholder = `${squad.entity.name} oyuncusu…`;
      attachSquadAutocomplete(input, s);
    } else {
      wrap.classList.add('is-off');
      input.disabled = true;
    }
  });
  // Baslangicta hedef YOK: tum takim (kalan mevkiler) onerilir. Bir slota
  // tiklarsa o mevkiye filtreler; ayni slota tekrar tiklarsa yine tum takim.
  squad.target = null;
  renderPitch(side);
  const input = $(`#sq-input-${side}`);
  input.placeholder = `${squad.entity.name} oyuncusu…`;
  const list = input.closest('.sq-input-wrap').querySelector('.suggest');
  list.innerHTML = '';
  list.hidden = true;

  $('#sq-turn').textContent = `Sıra: ${state.names[side]}`;
  setPrimarySquad('GÖNDER', 'squad-send');
  // Otomatik odak/acilis YOK: kullanici girise tiklayinca oneri cikar.
}

/** Hedef bolgeyi belirler (null = tum takim). Ayni slota tekrar tiklamak kapatir. */
function setTarget(slotIdx) {
  const side = squad.turn;
  squad.target = squad.target === slotIdx ? null : slotIdx; // toggle
  renderPitch(side); // is-target vurgusu
  const input = $(`#sq-input-${side}`);
  const targetSlot = squad.target !== null ? squad.slots[side][squad.target] : null;
  const cat = targetSlot ? targetSlot.key ?? targetSlot.pos : null;
  input.placeholder = cat ? `${squad.entity.name} — ${slotLabelOf(cat)}` : `${squad.entity.name} oyuncusu…`;
  // Slota tiklayinca HEMEN acma; sadece liste zaten acıksa tazele.
  const list = input.closest('.sq-input-wrap').querySelector('.suggest');
  if (!list.hidden) input.dispatchEvent(new Event('input'));
}

// Slot'a tiklayinca (sirasi gelenin sahasinda, bos slot) o bolgeyi hedefle/kapat.
document.addEventListener('click', (event) => {
  if (squad.over) return;
  if (!screens.squad.classList.contains('is-active')) return;
  const slotEl = event.target.closest('.slot.is-clickable');
  if (!slotEl) return;
  const pitch = slotEl.closest('.pitch');
  const side = Number(pitch.id.split('-').pop());
  if (side !== squad.turn) return;
  const idx = Number(slotEl.dataset.slot);
  if (squad.slots[side][idx].filled) return;
  setTarget(idx); // odak vermiyoruz; kullanici girise tiklayinca acilir
});

function setPrimarySquad(text, action, disabled = false) {
  const b = $('#sq-btn');
  b.textContent = text;
  b.dataset.action = action;
  b.disabled = disabled;
}

/** Kadro modunda ulke + kalan mevki filtresiyle otomatik tamamlama. */
function attachSquadAutocomplete(input, side) {
  const wrap = input.closest('.sq-input-wrap');
  const list = wrap.querySelector('.suggest');
  let items = [];
  let active = -1;

  const hide = () => {
    list.hidden = true;
    active = -1;
  };
  const render = (results) => {
    // Oyunda zaten kullanilmis oyuncular oneride cikmasin.
    items = results.filter((r) => !squad.usedIds.has(r.id));
    list.innerHTML = items
      .map(
        (r, i) =>
          `<li data-i="${i}" class="${i === active ? 'is-active' : ''}"><b>${r.name}</b>` +
          `<small>${r.position || ''}</small></li>`,
      )
      .join('');
    list.hidden = items.length === 0;
  };
  const pick = (r) => {
    if (!r) return;
    input.value = r.name;
    squad.pick[side] = { id: r.id, name: r.name };
    hide();
  };

  const fetchList = async (q) => {
    const params = squadSearchParams(side, q);
    try {
      const res = await fetch(`/api/players/search?${params}`);
      const data = await res.json();
      active = -1;
      render(data.results || []);
    } catch {
      hide();
    }
  };
  const run = debounce((q) => fetchList(q), 160);

  input.oninput = () => {
    squad.pick[side] = null;
    run(input.value.trim());
  };
  input.onfocus = () => {
    if (!input.value.trim()) fetchList(''); // tiklayinca ulkenin en cok maçlilari
  };
  input.onkeydown = (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, items.length - 1);
      render(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      render(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(items[active >= 0 ? active : 0]);
    } else if (e.key === 'Escape') {
      hide();
    }
  };
  input.onblur = () => setTimeout(hide, 150);
  list.onmousedown = (e) => {
    const li = e.target.closest('li');
    if (li) pick(items[Number(li.dataset.i)]);
  };
}

/** Sirasi gelen oyuncunun secimini alir; yazip secmediyse ilk sonucu coz. */
async function resolveCurrentPick(side) {
  if (squad.pick[side]) return squad.pick[side];
  const input = $(`#sq-input-${side}`);
  const text = input.value.trim();
  if (!text) return null;
  const params = squadSearchParams(side, text);
  try {
    const res = await fetch(`/api/players/search?${params}`);
    const first = (await res.json()).results?.find((r) => !squad.usedIds.has(r.id));
    if (first) {
      squad.pick[side] = { id: first.id, name: first.name };
      input.value = first.name;
      return squad.pick[side];
    }
  } catch {
    /* yok say */
  }
  return null;
}

async function squadSend() {
  if (squad.over || !squad.entity) return;
  const side = squad.turn;
  if (squad.placed[side]) return; // bu turda zaten yerlestirdi
  const cfg = draftCfg();

  const pick = await resolveCurrentPick(side);
  if (!pick) {
    toast(`${state.names[side]} bir oyuncu seçmeli.`, 2200);
    $(`#sq-input-${side}`).focus();
    return;
  }
  if (squad.usedIds.has(pick.id)) {
    toast('Bu oyuncu bu oyunda kullanıldı, başkasını seç.', 2400);
    return;
  }

  setPrimarySquad('…', 'squad-send', true);
  let st;
  try {
    st = await fetch(cfg.playerUrl(pick.id, squad.entity.key)).then((r) => r.json());
  } catch {
    toast('İstatistik alınamadı.');
    setPrimarySquad('GÖNDER', 'squad-send');
    return;
  }

  // Hedef slot bos ve secilen oyuncunun mevkisiyle uyumlu olmali.
  const playerKey = squad.length === 'long' ? st.key ?? st.slot : st.slot;
  const target = squad.slots[side][squad.target];
  if (!target || target.filled || (target.key ?? target.pos) !== playerKey) {
    // Uyumlu degilse: oyuncunun mevkisine ait bos slot var mi bul.
    const alt = squad.slots[side].findIndex((s) => !s.filled && (s.key ?? s.pos) === playerKey);
    if (alt < 0) {
      toast(`${slotLabelOf(playerKey) || 'Bu mevki'} için boş yer yok, başka oyuncu seç.`, 2600);
      setPrimarySquad('GÖNDER', 'squad-send');
      return;
    }
    squad.target = alt;
  }

  // Yerlestir + puanla.
  const slotIdx = squad.target;
  const slot = squad.slots[side][slotIdx];
  slot.filled = true;
  const value = squad.mode === 'superlig' ? st.goals : squad.mode === 'market' ? st.fee : st.caps;
  slot.player = { id: st.id, name: st.name, value, portraitUrl: st.portraitUrl };
  squad.usedIds.add(st.id);
  squad.totals[side] += value || 0;
  squad.placed[side] = true;
  const input = $(`#sq-input-${side}`);
  input.disabled = true;
  const valueLabel = squad.mode === 'market' ? formatFee(value) : `${value} ${cfg.unit}`;
  input.value = `${st.name} · ${valueLabel}`;
  input.closest('.sq-input-wrap').classList.add('is-off');
  $(`#sq-card-${side}`).classList.remove('is-turn');
  renderPitch(side);

  updateSquadTotals(squad.totals[0], squad.totals[1]);
  const tops = document.querySelectorAll('.squad-total');
  tops.forEach((t) => t.classList.remove('is-winner'));
  if (squad.totals[0] !== squad.totals[1]) tops[squad.totals[0] > squad.totals[1] ? 0 : 1].classList.add('is-winner');

  const other = 1 - side;
  if (!squad.placed[other]) {
    setTurnUI(other); // sira diger oyuncuya
    return;
  }

  // Iki taraf da yerlestirdi -> tur bitti.
  $('#sq-turn').textContent = '';
  const full = squad.slots[0].every((s) => s.filled) && squad.slots[1].every((s) => s.filled);
  if (full) {
    squad.over = true;
    const [a, b] = squad.totals;
    const verdict = a === b ? 'Berabere!' : `${state.names[a > b ? 0 : 1]} kazandı!`;
    const totalsText =
      squad.mode === 'market' ? `${formatFee(a)} - ${formatFee(b)}` : `${a} - ${b} ${cfg.unit}`;
    toast(`Kadrolar tamam — ${verdict} (${totalsText})`, 5000);
    setPrimarySquad('YENİ OYUN', 'new-game');
  } else {
    squad.starter = 1 - squad.starter; // sonraki turda diger oyuncu baslar
    setPrimarySquad(cfg.nextLabel, 'squad-next');
  }
}

// ================= ONLINE — ZAR (compare + squad ortak) =================
function openOnlineDice() {
  const you = online.players.find((p) => p.id === online.youId);
  const opp = online.players.find((p) => p.id !== online.youId);
  $('#odice-name-0').textContent = (you?.name || 'SEN').toUpperCase();
  $('#odice-name-1').textContent = (opp?.name || 'RAKİP').toUpperCase();
  $('#odie-0').textContent = '⚀';
  $('#odie-1').textContent = '⚀';
  $('#odie-0').classList.remove('is-winner', 'is-rolling');
  $('#odie-1').classList.remove('is-winner', 'is-rolling');
  $('#odice-title').textContent = 'Kim başlıyor?';
  $('#odice-result').textContent = '';
  const btn = $('#odice-btn');
  btn.textContent = 'ZAR AT';
  btn.disabled = false;
  btn.hidden = false;
  $('#online-dice').hidden = false;
}

// ================= ONLINE — KARİYER KIYASI =================
function onOnlineCompareRound({ player, rows, activeRow, turnId, room, scores }) {
  $('#online-dice').hidden = true;
  online.mode = 'compare';
  online.active = true;
  online.isHost = room.hostId === online.youId;
  online.oppId = room.players.find((p) => p.id !== online.youId)?.id ?? null;
  online.players = room.players;
  online.compareRows = rows;
  online.compareActiveRow = activeRow ?? 0;
  online.center = player;
  online.comparePick = null;

  const you = room.players.find((p) => p.id === online.youId);
  const opp = room.players.find((p) => p.id !== online.youId);
  $('#score-name1').textContent = (you?.name || 'SEN').toUpperCase();
  $('#score-name2').textContent = (opp?.name || 'RAKİP').toUpperCase();
  $('#score-value1').textContent = scores[online.youId] ?? 0;
  $('#score-value2').textContent = scores[online.oppId] ?? 0;

  $('#hero-name').textContent = player.name;
  const photo = $('#hero-photo');
  photo.src = player.portraitUrl || '';
  photo.alt = player.name;

  renderOnlineCompareRows();
  for (const card of document.querySelectorAll('.scorecard')) card.classList.remove('is-winner');
  show('game');
  setOnlineCompareTurn(turnId);
}

function renderOnlineCompareRows() {
  const container = $('#rows');
  container.innerHTML = '';
  online.compareRows.forEach((row, index) => {
    const el = document.createElement('div');
    el.className = 'row is-locked';
    el.dataset.index = index;
    el.innerHTML = `
      <div class="row__cell row__cell--name" data-side="0">
        <input type="text" class="name-input" placeholder="oyuncu ara…" autocomplete="off" disabled />
        <ul class="suggest" hidden></ul>
        <span class="row__answer-name" data-name></span>
        <span class="row__diff"></span>
      </div>
      <div class="row__label">
        <b>${row.label}</b>
        <span class="row__answer" data-answer></span>
      </div>
      <div class="row__cell row__cell--name" data-side="1">
        <input type="text" class="name-input" placeholder="rakip…" autocomplete="off" disabled />
        <ul class="suggest" hidden></ul>
        <span class="row__answer-name" data-name></span>
        <span class="row__diff"></span>
      </div>`;
    container.appendChild(el);
  });
}

/** Sirayi ayarlar: yalnizca sirasi gelen oyuncunun (sen) girisi acilir. */
function setOnlineCompareTurn(turnId) {
  online.turnId = turnId;
  online.comparePick = null;
  const idx = online.compareActiveRow;
  const mine = turnId === online.youId;

  document.querySelectorAll('#rows .row').forEach((rowEl) => {
    const i = Number(rowEl.dataset.index);
    const inputs = rowEl.querySelectorAll('input');
    rowEl.classList.remove('is-active', 'is-locked');
    if (i === idx) {
      rowEl.classList.add('is-active');
      inputs[1].disabled = true;
      if (mine) {
        inputs[0].disabled = false;
        inputs[0].value = '';
        inputs[0].placeholder = 'oyuncu ara…';
        attachOnlineCompareAutocomplete(inputs[0]);
      } else {
        inputs[0].disabled = true;
        inputs[0].placeholder = 'sıra rakipte…';
        inputs[1].placeholder = 'rakip yazıyor…';
      }
    } else if (i > idx) {
      rowEl.classList.add('is-locked');
      inputs.forEach((inp) => (inp.disabled = true));
    }
  });

  $('#round-tag').textContent = `Satır ${idx + 1}/${online.compareRows.length}`;
  if (mine) {
    setPrimary('GÖNDER', 'online-compare-guess');
    document.querySelector(`#rows .row[data-index="${idx}"] .row__cell[data-side="0"] input`)?.focus();
  } else {
    setPrimary('RAKİP YAZIYOR…', 'online-compare-guess', true);
  }
  startCountdown(TURN_SECONDS, { tick: mine });
  if (mine) playYourTurn();
  else playSwitch();
}

/** Online kiyas icin isim otomatik tamamlama (secimi online.comparePick'e yazar). */
function attachOnlineCompareAutocomplete(input) {
  const cell = input.closest('.row__cell');
  const list = cell.querySelector('.suggest');
  let items = [];
  let active = -1;

  const hide = () => {
    list.hidden = true;
    active = -1;
  };
  const render = (results) => {
    items = results;
    list.innerHTML = results
      .map(
        (r, i) =>
          `<li data-i="${i}" class="${i === active ? 'is-active' : ''}"><b>${r.name}</b>` +
          `<small>${[r.country, r.position, r.club].filter(Boolean).join(' · ')}</small></li>`,
      )
      .join('');
    list.hidden = results.length === 0;
  };
  const pick = (r) => {
    if (!r) return;
    input.value = r.name;
    online.comparePick = { id: r.id, name: r.name };
    hide();
  };
  const run = debounce(async (q) => {
    if (q.trim().length < 2) return hide();
    try {
      const res = await fetch(`/api/players/search?live=1&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      active = -1;
      render(data.results || []);
    } catch {
      hide();
    }
  }, 220);

  input.oninput = () => {
    online.comparePick = null;
    run(input.value);
  };
  input.onkeydown = (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, items.length - 1);
      render(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      render(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(items[active >= 0 ? active : 0]);
    } else if (e.key === 'Escape') {
      hide();
    }
  };
  input.onblur = () => setTimeout(hide, 150);
  list.onmousedown = (e) => {
    const li = e.target.closest('li');
    if (li) pick(items[Number(li.dataset.i)]);
  };
}

async function resolveOnlineComparePick() {
  if (online.comparePick) return online.comparePick;
  const input = document.querySelector(
    `#rows .row[data-index="${online.compareActiveRow}"] .row__cell[data-side="0"] input`,
  );
  const text = input?.value.trim();
  if (!text) return null;
  try {
    const res = await fetch(`/api/players/search?q=${encodeURIComponent(text)}`);
    const first = (await res.json()).results?.[0];
    if (first) {
      online.comparePick = { id: first.id, name: first.name };
      input.value = first.name;
      return online.comparePick;
    }
  } catch {
    /* yok say */
  }
  return null;
}

async function onlineCompareGuess() {
  if (online.turnId !== online.youId) return;
  const pick = await resolveOnlineComparePick();
  if (!pick) {
    toast('Bir oyuncu ismi yaz.', 2000);
    document
      .querySelector(`#rows .row[data-index="${online.compareActiveRow}"] .row__cell[data-side="0"] input`)
      ?.focus();
    return;
  }
  online.socket.emit('compare:guess', { playerId: pick.id });
  stopCountdown();
  const input = document.querySelector(
    `#rows .row[data-index="${online.compareActiveRow}"] .row__cell[data-side="0"] input`,
  );
  if (input) {
    input.disabled = true;
    input.value = pick.name;
  }
  setPrimary('RAKİP BEKLENİYOR…', 'online-compare-guess', true);
}

function onOnlineCompareResult({ rowIndex, key, truthText, truthValue, guesses, winners, scores }) {
  stopCountdown();
  const rowEl = document.querySelector(`#rows .row[data-index="${rowIndex}"]`);
  if (!rowEl) return;
  rowEl.classList.remove('is-active');
  rowEl.classList.add('is-done');
  rowEl.querySelector('[data-answer]').textContent = truthText;
  const cells = rowEl.querySelectorAll('.row__cell');
  const inputs = rowEl.querySelectorAll('input');

  [online.youId, online.oppId].forEach((id, side) => {
    const g = guesses[id] || {};
    inputs[side].disabled = true;
    inputs[side].value = g.name || '';
    const cell = cells[side];
    cell.querySelector('[data-name]').textContent = compareFormat(key, g.value);
    const diffEl = cell.querySelector('.row__diff');
    cell.classList.remove('is-win', 'is-lose');
    if (winners.includes(id)) cell.classList.add('is-win');
    else if (winners.length) cell.classList.add('is-lose');
    if (truthValue == null || g.value == null) diffEl.textContent = '—';
    else
      diffEl.textContent =
        Math.abs(g.value - truthValue) === 0 ? 'tam isabet!' : compareDiffLabel(key, Math.abs(g.value - truthValue));
  });

  $('#score-value1').textContent = scores[online.youId] ?? 0;
  $('#score-value2').textContent = scores[online.oppId] ?? 0;
  flashOnlineLeader(scores);
}

function onOnlineCompareOver({ scores }) {
  stopCountdown();
  const you = scores[online.youId] ?? 0;
  const opp = scores[online.oppId] ?? 0;
  const verdict = you > opp ? 'Kazandın! 🎉' : you < opp ? 'Rakip kazandı.' : 'Berabere.';
  toast(`Oyuncu bitti. ${verdict} (${you}–${opp})`);
  if (online.isHost) setPrimary('SONRAKİ OYUNCU ›', 'online-next-round');
  else setPrimary('HOST BEKLENİYOR…', 'online-next-round', true);
}

// ================= ONLINE — MİLLİ KADRO =================
async function onlineEnsureReel() {
  if (squad.reel && squad.reel.length) return;
  const cfg = draftCfg();
  try {
    const pool = await (await fetch(cfg.poolUrl)).json();
    squad.reel = (pool[cfg.poolKey] || []).map(cfg.normalize);
  } catch {
    squad.reel = [];
  }
}

/** Sunucudan gelen (id->slots) yapiyi ekran taraflarina (0=sen,1=rakip) esler. */
function applyOnlineSlots(slots) {
  const map = (arr) =>
    (arr || []).map((s) => ({
      pos: s.pos,
      key: s.key ?? s.pos,
      filled: s.filled,
      player: s.player
        ? { ...s.player, value: s.player.caps ?? s.player.goals ?? s.player.fee ?? 0 }
        : null,
    }));
  squad.slots = [map(slots[online.youId]), map(slots[online.oppId])];
}

function refreshUsedIdsFromSlots() {
  squad.usedIds = new Set();
  for (const arr of squad.slots)
    for (const s of arr) if (s.filled && s.player && s.player.id != null) squad.usedIds.add(s.player.id);
}

async function onOnlineSquadRound({ country, formation, length, round, turnId, slots, scores, room }) {
  $('#online-dice').hidden = true;
  online.mode = 'squad';
  setSquadMode('squad', length);
  online.active = true;
  online.isHost = room.hostId === online.youId;
  online.oppId = room.players.find((p) => p.id !== online.youId)?.id ?? null;
  online.players = room.players;

  squad.formation = formation;
  squad.entity = draftCfg().normalize(country);
  squad.over = false;
  squad.reel = []; // uzun/kısa değişiminde eski havuz kalmasın
  squad.pick = [null, null];
  squad.target = null;
  applyOnlineSlots(slots);
  refreshUsedIdsFromSlots();

  const you = room.players.find((p) => p.id === online.youId);
  const opp = room.players.find((p) => p.id !== online.youId);
  $('#sq-name1').textContent = (you?.name || 'SEN').toUpperCase();
  $('#sq-name2').textContent = (opp?.name || 'RAKİP').toUpperCase();
  squad.totals = [scores[online.youId] ?? 0, scores[online.oppId] ?? 0];
  updateSquadTotals(squad.totals[0], squad.totals[1]);
  $('#sq-round').textContent = `Tur ${round}`;
  for (const t of document.querySelectorAll('.squad-total')) t.classList.remove('is-winner', 'is-turn');

  // Girisleri kilitle (spin bitince sira acilir).
  for (const side of [0, 1]) {
    const input = $(`#sq-input-${side}`);
    input.disabled = true;
    input.value = '';
    input.closest('.sq-input-wrap').classList.add('is-off');
    const l = input.closest('.sq-input-wrap').querySelector('.suggest');
    l.innerHTML = '';
    l.hidden = true;
  }
  squad.turn = -1;
  renderPitch(0);
  renderPitch(1);
  setPrimarySquad('…', 'online-squad-send', true);
  show('squad');

  await onlineEnsureReel();
  await spinEntity(squad.entity);
  $('#sq-flag').alt = squad.entity.name;
  setOnlineSquadTurn(turnId);
}

/** Online kadroda sirayi ayarlar: sirasi sende ise (side 0) girisin/tahta acilir. */
function setOnlineSquadTurn(turnId) {
  const myTurn = turnId === online.youId;
  squad.turn = myTurn ? 0 : -1; // -1: hicbir tahta tiklanamaz
  squad.target = null;
  squad.pick = [null, null];
  renderPitch(0);
  renderPitch(1);

  $('#sq-card-0').classList.toggle('is-turn', myTurn);
  $('#sq-card-1').classList.toggle('is-turn', turnId === online.oppId);

  const input = $('#sq-input-0');
  const wrap = input.closest('.sq-input-wrap');
  if (myTurn) {
    wrap.classList.remove('is-off');
    input.disabled = false;
    input.value = '';
    input.placeholder = `${squad.entity.name} oyuncusu…`;
    attachSquadAutocomplete(input, 0);
    $('#sq-turn').textContent = 'Sıra: SEN';
    setPrimarySquad('GÖNDER', 'online-squad-send');
  } else {
    wrap.classList.add('is-off');
    input.disabled = true;
    input.value = '';
    $('#sq-turn').textContent = 'Sıra: RAKİP';
    setPrimarySquad('RAKİP OYNUYOR…', 'online-squad-send', true);
  }
  // Rakip girisi ekranimda hep kapali.
  const owrap = $('#sq-input-1').closest('.sq-input-wrap');
  owrap.classList.add('is-off');
  $('#sq-input-1').disabled = true;
  startCountdown(TURN_SECONDS, { tick: myTurn });
  if (myTurn) playYourTurn();
  else playSwitch();
}

async function onlineSquadSend() {
  if (squad.over || !squad.entity) return;
  if (squad.turn !== 0) return; // rakip sirasi
  const pick = await resolveCurrentPick(0);
  if (!pick) {
    toast('Bir oyuncu seç.', 2000);
    $('#sq-input-0').focus();
    return;
  }
  if (squad.usedIds.has(pick.id)) {
    toast('Bu oyuncu bu oyunda kullanıldı, başkasını seç.', 2400);
    return;
  }
  setPrimarySquad('…', 'online-squad-send', true);
  const slotIdx = squad.target != null ? squad.target : -1;
  online.socket.emit('squad:place', { playerId: pick.id, slotIdx });
  stopCountdown();
}

function onOnlineSquadPlaced({ by, player, slots, scores, timeout }) {
  stopCountdown();
  applyOnlineSlots(slots);
  if (player && player.id != null) squad.usedIds.add(player.id);
  squad.totals = [scores[online.youId] ?? 0, scores[online.oppId] ?? 0];
  updateSquadTotals(squad.totals[0], squad.totals[1]);
  const tops = document.querySelectorAll('.squad-total');
  tops.forEach((t) => t.classList.remove('is-winner'));
  if (squad.totals[0] !== squad.totals[1]) tops[squad.totals[0] > squad.totals[1] ? 0 : 1].classList.add('is-winner');

  if (by === online.youId) {
    const i = $('#sq-input-0');
    const cfg = draftCfg();
    i.value = timeout ? '⏱ süre doldu' : `${player.name} · ${player.caps} ${cfg.unit}`;
    i.disabled = true;
    i.closest('.sq-input-wrap').classList.add('is-off');
    $('#sq-card-0').classList.remove('is-turn');
  }
  if (timeout) {
    toast(by === online.youId ? 'Süren doldu — 0.' : 'Rakip süreyi aştı — 0.');
    playTimesUp();
  }
  renderPitch(0);
  renderPitch(1);
}

// ================= ONLINE — SÜPER LİG GOL =================
async function onOnlineSuperligRound({ team, formation, length, round, turnId, slots, scores, room }) {
  $('#online-dice').hidden = true;
  online.mode = 'superlig';
  setSquadMode('superlig', length);
  online.active = true;
  online.isHost = room.hostId === online.youId;
  online.oppId = room.players.find((p) => p.id !== online.youId)?.id ?? null;
  online.players = room.players;

  squad.formation = formation;
  squad.entity = draftCfg().normalize(team);
  squad.over = false;
  squad.reel = [];
  squad.pick = [null, null];
  squad.target = null;
  applyOnlineSlots(slots);
  refreshUsedIdsFromSlots();

  const you = room.players.find((p) => p.id === online.youId);
  const opp = room.players.find((p) => p.id !== online.youId);
  $('#sq-name1').textContent = (you?.name || 'SEN').toUpperCase();
  $('#sq-name2').textContent = (opp?.name || 'RAKİP').toUpperCase();
  squad.totals = [scores[online.youId] ?? 0, scores[online.oppId] ?? 0];
  updateSquadTotals(squad.totals[0], squad.totals[1]);
  $('#sq-round').textContent = `Tur ${round}`;
  for (const t of document.querySelectorAll('.squad-total')) t.classList.remove('is-winner', 'is-turn');

  for (const side of [0, 1]) {
    const input = $(`#sq-input-${side}`);
    input.disabled = true;
    input.value = '';
    input.closest('.sq-input-wrap').classList.add('is-off');
    const l = input.closest('.sq-input-wrap').querySelector('.suggest');
    l.innerHTML = '';
    l.hidden = true;
  }
  squad.turn = -1;
  renderPitch(0);
  renderPitch(1);
  setPrimarySquad('…', 'online-superlig-send', true);
  show('squad');

  await onlineEnsureReel();
  await spinEntity(squad.entity);
  $('#sq-flag').alt = squad.entity.name;
  setOnlineSuperligTurn(turnId);
}

function setOnlineSuperligTurn(turnId) {
  const myTurn = turnId === online.youId;
  squad.turn = myTurn ? 0 : -1;
  squad.target = null;
  squad.pick = [null, null];
  renderPitch(0);
  renderPitch(1);

  $('#sq-card-0').classList.toggle('is-turn', myTurn);
  $('#sq-card-1').classList.toggle('is-turn', turnId === online.oppId);

  const input = $('#sq-input-0');
  const wrap = input.closest('.sq-input-wrap');
  if (myTurn) {
    wrap.classList.remove('is-off');
    input.disabled = false;
    input.value = '';
    input.placeholder = `${squad.entity.name} oyuncusu…`;
    attachSquadAutocomplete(input, 0);
    $('#sq-turn').textContent = 'Sıra: SEN';
    setPrimarySquad('GÖNDER', 'online-superlig-send');
  } else {
    wrap.classList.add('is-off');
    input.disabled = true;
    input.value = '';
    $('#sq-turn').textContent = 'Sıra: RAKİP';
    setPrimarySquad('RAKİP OYNUYOR…', 'online-superlig-send', true);
  }
  const owrap = $('#sq-input-1').closest('.sq-input-wrap');
  owrap.classList.add('is-off');
  $('#sq-input-1').disabled = true;
  startCountdown(TURN_SECONDS, { tick: myTurn });
  if (myTurn) playYourTurn();
  else playSwitch();
}

async function onlineSuperligSend() {
  if (squad.over || !squad.entity) return;
  if (squad.turn !== 0) return;
  const pick = await resolveCurrentPick(0);
  if (!pick) {
    toast('Bir oyuncu seç.', 2000);
    $('#sq-input-0').focus();
    return;
  }
  if (squad.usedIds.has(pick.id)) {
    toast('Bu oyuncu bu oyunda kullanıldı, başkasını seç.', 2400);
    return;
  }
  setPrimarySquad('…', 'online-superlig-send', true);
  const slotIdx = squad.target != null ? squad.target : -1;
  online.socket.emit('superlig:place', { playerId: pick.id, slotIdx });
  stopCountdown();
}

function onOnlineSuperligPlaced({ by, player, slots, scores, timeout }) {
  stopCountdown();
  applyOnlineSlots(slots);
  if (player && player.id != null) squad.usedIds.add(player.id);
  squad.totals = [scores[online.youId] ?? 0, scores[online.oppId] ?? 0];
  updateSquadTotals(squad.totals[0], squad.totals[1]);
  const tops = document.querySelectorAll('.squad-total');
  tops.forEach((t) => t.classList.remove('is-winner'));
  if (squad.totals[0] !== squad.totals[1]) tops[squad.totals[0] > squad.totals[1] ? 0 : 1].classList.add('is-winner');

  if (by === online.youId) {
    const i = $('#sq-input-0');
    i.value = timeout ? '⏱ süre doldu' : `${player.name} · ${player.goals} gol`;
    i.disabled = true;
    i.closest('.sq-input-wrap').classList.add('is-off');
    $('#sq-card-0').classList.remove('is-turn');
  }
  if (timeout) {
    toast(by === online.youId ? 'Süren doldu — 0 gol.' : 'Rakip süreyi aştı — 0 gol.');
    playTimesUp();
  }
  renderPitch(0);
  renderPitch(1);
}

// ================= ONLINE — BONSERVİS AVI =================
async function onOnlineMarketRound({ team, formation, length, round, turnId, slots, scores, room }) {
  $('#online-dice').hidden = true;
  online.mode = 'market';
  setSquadMode('market', length);
  online.active = true;
  online.isHost = room.hostId === online.youId;
  online.oppId = room.players.find((p) => p.id !== online.youId)?.id ?? null;
  online.players = room.players;

  squad.formation = formation;
  squad.entity = draftCfg().normalize(team);
  squad.over = false;
  squad.reel = [];
  squad.pick = [null, null];
  squad.target = null;
  applyOnlineSlots(slots);
  refreshUsedIdsFromSlots();

  const you = room.players.find((p) => p.id === online.youId);
  const opp = room.players.find((p) => p.id !== online.youId);
  $('#sq-name1').textContent = (you?.name || 'SEN').toUpperCase();
  $('#sq-name2').textContent = (opp?.name || 'RAKİP').toUpperCase();
  squad.totals = [scores[online.youId] ?? 0, scores[online.oppId] ?? 0];
  updateSquadTotals(squad.totals[0], squad.totals[1]);
  $('#sq-round').textContent = `Tur ${round}`;
  for (const t of document.querySelectorAll('.squad-total')) t.classList.remove('is-winner', 'is-turn');

  for (const side of [0, 1]) {
    const input = $(`#sq-input-${side}`);
    input.disabled = true;
    input.value = '';
    input.closest('.sq-input-wrap').classList.add('is-off');
    const l = input.closest('.sq-input-wrap').querySelector('.suggest');
    l.innerHTML = '';
    l.hidden = true;
  }
  squad.turn = -1;
  renderPitch(0);
  renderPitch(1);
  setPrimarySquad('…', 'online-market-send', true);
  show('squad');

  await onlineEnsureReel();
  await spinEntity(squad.entity);
  $('#sq-flag').alt = squad.entity.name;
  setOnlineMarketTurn(turnId);
}

function setOnlineMarketTurn(turnId) {
  const myTurn = turnId === online.youId;
  squad.turn = myTurn ? 0 : -1;
  squad.target = null;
  squad.pick = [null, null];
  renderPitch(0);
  renderPitch(1);

  $('#sq-card-0').classList.toggle('is-turn', myTurn);
  $('#sq-card-1').classList.toggle('is-turn', turnId === online.oppId);

  const input = $('#sq-input-0');
  const wrap = input.closest('.sq-input-wrap');
  if (myTurn) {
    wrap.classList.remove('is-off');
    input.disabled = false;
    input.value = '';
    input.placeholder = `${squad.entity.name} oyuncusu…`;
    attachSquadAutocomplete(input, 0);
    $('#sq-turn').textContent = 'Sıra: SEN';
    setPrimarySquad('GÖNDER', 'online-market-send');
  } else {
    wrap.classList.add('is-off');
    input.disabled = true;
    input.value = '';
    $('#sq-turn').textContent = 'Sıra: RAKİP';
    setPrimarySquad('RAKİP OYNUYOR…', 'online-market-send', true);
  }
  const owrap = $('#sq-input-1').closest('.sq-input-wrap');
  owrap.classList.add('is-off');
  $('#sq-input-1').disabled = true;
  startCountdown(TURN_SECONDS, { tick: myTurn });
  if (myTurn) playYourTurn();
  else playSwitch();
}

async function onlineMarketSend() {
  if (squad.over || !squad.entity) return;
  if (squad.turn !== 0) return;
  const pick = await resolveCurrentPick(0);
  if (!pick) {
    toast('Bir oyuncu seç.', 2000);
    $('#sq-input-0').focus();
    return;
  }
  if (squad.usedIds.has(pick.id)) {
    toast('Bu oyuncu bu oyunda kullanıldı, başkasını seç.', 2400);
    return;
  }
  setPrimarySquad('…', 'online-market-send', true);
  const slotIdx = squad.target != null ? squad.target : -1;
  online.socket.emit('market:place', { playerId: pick.id, slotIdx });
  stopCountdown();
}

function onOnlineMarketPlaced({ by, player, slots, scores, timeout }) {
  stopCountdown();
  applyOnlineSlots(slots);
  if (player && player.id != null) squad.usedIds.add(player.id);
  squad.totals = [scores[online.youId] ?? 0, scores[online.oppId] ?? 0];
  updateSquadTotals(squad.totals[0], squad.totals[1]);
  const tops = document.querySelectorAll('.squad-total');
  tops.forEach((t) => t.classList.remove('is-winner'));
  if (squad.totals[0] !== squad.totals[1]) tops[squad.totals[0] > squad.totals[1] ? 0 : 1].classList.add('is-winner');

  if (by === online.youId) {
    const i = $('#sq-input-0');
    i.value = timeout ? '⏱ süre doldu' : `${player.name} · ${formatFee(player.fee)}`;
    i.disabled = true;
    i.closest('.sq-input-wrap').classList.add('is-off');
    $('#sq-card-0').classList.remove('is-turn');
  }
  if (timeout) {
    toast(by === online.youId ? 'Süren doldu — 0.' : 'Rakip süreyi aştı — 0.');
    playTimesUp();
  }
  renderPitch(0);
  renderPitch(1);
}

// ---- baslat ----
loadSettings();
updateScoreboard();
show('menu');
