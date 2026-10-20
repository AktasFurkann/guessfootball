'use strict';

/**
 * Hesap, profil ve mac tahmini arayuzu.
 *
 * app.js'ten sonra yuklenir ve onun yardimcilarini ($, show, screens,
 * escapeHtml, imgUrl, MODE_TITLES, online…) kullanir. app.js de buradaki
 * authToken / currentAccount / syncNameInputs / onSocketCreated /
 * reportSoloGame fonksiyonlarini (varsa) cagirir.
 *
 * "Beni hatirla": giris yapinca sunucunun verdigi oturum anahtari
 * localStorage'da tutulur; sayfa her acildiginda /api/auth/me ile dogrulanir,
 * sifre bir daha sorulmaz. Cikis yapinca anahtar silinir ve sunucuda da iptal edilir.
 */

const TOKEN_KEY = 'gf.token';
const account = { user: null, token: null };

/** app.js soket baglantisinda kullanir. */
function authToken() {
  return account.token;
}
function currentAccount() {
  return account.user;
}

function loadToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function storeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* depolama kapali olabilir: oturum yalnizca bu sekmede yasar */
  }
}

/** JSON API cagrisi (oturum anahtariyla). Hata mesaji sunucudan gelir. */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(account.token ? { Authorization: `Bearer ${account.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Bağlantı hatası (${res.status})`), { status: res.status });
  return data;
}

const formatCoins = (n) => `🪙 ${Number(n || 0).toLocaleString('tr-TR')}`;

/** Hesap degisti: menu, rozetler, ad alanlari ve soket kimligi guncellenir. */
function setAccount(user, token) {
  const changed = String(account.user?.id ?? '') !== String(user?.id ?? '');
  account.user = user;
  if (token !== undefined) {
    account.token = token;
    storeToken(token);
  }
  renderAccountUi();
  if (changed) refreshSocketIdentity();
}

/** Odada degilken soketi yeniden baglar ki sunucu yeni kimligi gorsun. */
function refreshSocketIdentity() {
  if (online.socket && !online.roomCode) online.socket.disconnect().connect();
}

function renderAccountUi() {
  const user = account.user;
  $('#menu-user').hidden = !user;
  $('#menu-profile-btn').textContent = user ? 'PROFİL' : 'GİRİŞ YAP';
  if (user) {
    $('#menu-user-name').textContent = `👤 ${user.username}`;
    $('#menu-user-coins').textContent = formatCoins(user.coins);
  }
  const badge = $('#predict-coins');
  badge.hidden = !user;
  if (user) badge.textContent = formatCoins(user.coins);
  syncNameInputs();
}

/** Giris yapildiysa online ad alanlari hesap adiyla dolar ve kilitlenir. */
function syncNameInputs() {
  for (const input of [$('#online-name'), $('#servers-name')]) {
    if (!input) continue;
    if (account.user) {
      input.value = account.user.username;
      input.readOnly = true;
      input.title = 'Giriş yaptığın hesabın adı kullanılır.';
    } else {
      input.readOnly = false;
      input.title = '';
    }
  }
}

/** Bakiye vb. degismis olabilir (tahmin sonucu, online galibiyet). */
async function refreshMe() {
  if (!account.token) return;
  try {
    const { user } = await api('/api/auth/me');
    setAccount(user);
  } catch (error) {
    if (error.status === 401) setAccount(null, null); // oturum suresi dolmus / iptal
  }
}

/** app.js soketi kurunca: oyun bitince bakiyeyi tazele. */
function onSocketCreated(socket) {
  for (const event of ['game:over', 'squad:over', 'superlig:over', 'market:over']) {
    socket.on(event, () => setTimeout(refreshMe, 1500));
  }
}

/** Tek kisilik kadro oyunu bitti (app.js cagirir). */
function reportSoloGame(mode, length, total) {
  if (!account.user) return;
  api('/api/games/solo', { method: 'POST', body: { mode, length, total } }).catch(() => {});
}

// ================= GIRIS / KAYIT =================
const authState = { tab: 'login', returnTo: 'menu' };

function openAuth(returnTo = 'menu') {
  authState.returnTo = returnTo;
  setAuthTab('login');
  $('#auth-hint').textContent = '';
  $('#auth-password').value = '';
  show('auth');
  setTimeout(() => $('#auth-username').focus(), 50);
}

function setAuthTab(tab) {
  authState.tab = tab === 'register' ? 'register' : 'login';
  const isRegister = authState.tab === 'register';
  for (const el of document.querySelectorAll('#screen-auth .tab')) {
    el.classList.toggle('is-active', el.dataset.tab === authState.tab);
  }
  $('#auth-title').textContent = isRegister ? 'Kayıt Ol' : 'Giriş Yap';
  $('#auth-submit').textContent = isRegister ? 'KAYIT OL' : 'GİRİŞ YAP';
  $('#auth-password').autocomplete = isRegister ? 'new-password' : 'current-password';
  $('#auth-note').textContent = isRegister
    ? 'Yeni hesap 1.000 para ile başlar. Bu cihazda açık kalırsın.'
    : 'Bu cihazda açık kalırsın; bir daha şifre sormaz.';
  $('#auth-hint').textContent = '';
}

async function submitAuth(event) {
  event.preventDefault();
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  const button = $('#auth-submit');
  button.disabled = true;
  $('#auth-hint').textContent = '';
  try {
    const path = authState.tab === 'register' ? '/api/auth/register' : '/api/auth/login';
    const { token, user } = await api(path, { method: 'POST', body: { username, password } });
    setAccount(user, token);
    $('#auth-password').value = '';
    returnAfterAuth();
  } catch (error) {
    $('#auth-hint').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function returnAfterAuth() {
  if (authState.returnTo === 'predict') openPredict();
  else if (authState.returnTo === 'profile') openProfile();
  else show('menu');
}

async function logoutAccount() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    /* sunucuya ulasilamasa da bu cihazdan cikis yapilir */
  }
  setAccount(null, null);
  show('menu');
}

// ================= PROFIL =================
const profileState = { username: null, returnTo: 'menu' };

const fmtDay = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'short' });
const fmtDate = (iso) => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Kendi profili (username yoksa) ya da baskasinin profili. */
async function openProfile(username = null, { returnTo } = {}) {
  if (!username && !account.user) return openAuth('profile');
  profileState.username = username || account.user.username;
  if (returnTo) profileState.returnTo = returnTo;
  $('#profile-title').textContent = profileState.username;
  $('#profile-body').innerHTML = '<p class="server-list__empty">Yükleniyor…</p>';
  $('#profile-search').value = '';
  $('#profile-search-list').hidden = true;
  show('profile');
  try {
    const [profile, board] = await Promise.all([
      api(`/api/users/${encodeURIComponent(profileState.username)}`),
      api('/api/users/leaderboard').catch(() => ({ results: [] })),
    ]);
    if (profile.isSelf) setAccount({ ...account.user, ...profile.user });
    $('#profile-body').innerHTML = renderProfile(profile, board.results);
  } catch (error) {
    $('#profile-body').innerHTML = `<p class="server-list__empty">${escapeHtml(error.message)}</p>`;
  }
}

const tile = (value, label, cls = '') =>
  `<div class="stat-tile ${cls}"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`;

const recordText = (line) => `${line.won}G · ${line.drawn}B · ${line.lost}M`;

function renderProfile(p, board) {
  const s = p.predictions.summary;
  const accuracy = s.settled ? `%${Math.round((s.correct / s.settled) * 100)}` : '—';
  const parts = [];

  parts.push(`
    <div class="profile-card">
      <div>
        <div class="profile-card__name">${escapeHtml(p.user.username)}${p.isSelf ? ' <small>(sen)</small>' : ''}</div>
        <small>Üyelik: ${escapeHtml(fmtDate(p.user.createdAt))}</small>
      </div>
      <div class="profile-card__coins">${escapeHtml(formatCoins(p.user.coins))}</div>
    </div>`);

  if (p.headToHead) parts.push(renderHeadToHead(p.headToHead));
  else if (!p.isSelf && !account.user) {
    parts.push('<p class="profile-note">Aranızdaki rekabeti görmek için giriş yap.</p>');
  }

  parts.push(`
    <section class="profile-section">
      <h3>Maç Tahminleri</h3>
      <div class="stat-grid">
        ${tile(s.total, 'Tahmin')}
        ${tile(s.correct, 'Doğru', 'is-good')}
        ${tile(s.wrong, 'Yanlış', 'is-bad')}
        ${tile(s.exact, 'Kesin skor', 'is-gold')}
        ${tile(s.pending, 'Bekleyen')}
        ${tile(accuracy, 'İsabet')}
        ${tile(Number(s.coinsWon).toLocaleString('tr-TR'), 'Kazanılan para')}
      </div>
      ${renderPredictionHistory(p.predictions.history)}
    </section>`);

  parts.push(renderGames(p.games));

  if (board?.length) {
    parts.push(`
      <section class="profile-section">
        <h3>Para Sıralaması</h3>
        <ol class="leaderboard">
          ${board
            .map(
              (u) =>
                `<li class="${u.username === p.user.username ? 'is-me' : ''}" data-action="view-profile" data-username="${escapeHtml(u.username)}">
                  <span>${escapeHtml(u.username)}</span><b>${escapeHtml(formatCoins(u.coins))}</b></li>`,
            )
            .join('')}
        </ol>
      </section>`);
  }

  if (p.isSelf) parts.push('<button class="btn btn--ghost" data-action="profile-logout">ÇIKIŞ YAP</button>');
  return parts.join('');
}

function renderHeadToHead(h) {
  const modes = Object.entries(h.byMode)
    .map(([mode, line]) => `<li><span>${escapeHtml(MODE_TITLES[mode] ?? mode)}</span><b>${escapeHtml(recordText(line))}</b></li>`)
    .join('');
  return `
    <section class="profile-section profile-section--h2h">
      <h3>Rekabet: Sen vs ${escapeHtml(h.opponent)}</h3>
      ${
        h.played
          ? `<div class="h2h">
              <div class="h2h__side is-good"><b>${h.won}</b><span>galibiyetin</span></div>
              <div class="h2h__side"><b>${h.drawn}</b><span>berabere</span></div>
              <div class="h2h__side is-bad"><b>${h.lost}</b><span>mağlubiyetin</span></div>
            </div>
            <ul class="mode-lines">${modes}</ul>
            ${renderRecentGames(h.recent)}`
          : '<p class="profile-note">Henüz birbirinize karşı online oyun oynamadınız.</p>'
      }
    </section>`;
}

const PICK_TEXT = { 1: '1', X: 'X', 2: '2' };

function predictionBadge(item) {
  if (!item.settled) return '<span class="result-badge">⏳ bekliyor</span>';
  if (item.result?.void) return '<span class="result-badge">iptal</span>';
  if (item.result?.correctPick) {
    const extra = item.result.exactScore ? ' 🎯' : '';
    return `<span class="result-badge is-good">✓ +${item.result.coins}${extra}</span>`;
  }
  return '<span class="result-badge is-bad">✗</span>';
}

function renderPredictionHistory(history) {
  if (!history.length) return '<p class="profile-note">Henüz tahmin yok.</p>';
  const byDay = new Map();
  for (const item of history) {
    if (!byDay.has(item.date)) byDay.set(item.date, []);
    byDay.get(item.date).push(item);
  }
  return [...byDay.entries()]
    .map(([date, items]) => {
      const settled = items.filter((i) => i.settled && !i.result?.void);
      const right = settled.filter((i) => i.result.correctPick).length;
      const summary = settled.length
        ? `${right} doğru, ${settled.length - right} yanlış`
        : `${items.length} tahmin, sonuç bekleniyor`;
      const rows = items
        .map((i) => {
          const final = i.finalScore ? `${i.finalScore.home}-${i.finalScore.away}` : 'vs';
          const guess = `${PICK_TEXT[i.pick] ?? i.pick}${i.score ? ` (${i.score.home}-${i.score.away})` : ''}`;
          return `<li class="history-row">
              <span class="history-row__match">${escapeHtml(i.home)} <b>${escapeHtml(final)}</b> ${escapeHtml(i.away)}</span>
              <span class="history-row__guess">Tahmin: ${escapeHtml(guess)}</span>
              ${predictionBadge(i)}
            </li>`;
        })
        .join('');
      return `<div class="history-day"><h4>${escapeHtml(fmtDay(date))} <small>${escapeHtml(summary)}</small></h4><ul>${rows}</ul></div>`;
    })
    .join('');
}

function renderGames(games) {
  const total = games.online.total;
  const modes = Object.entries(games.online.byMode)
    .filter(([, line]) => line.played)
    .map(
      ([mode, line]) =>
        `<li><span>${escapeHtml(MODE_TITLES[mode] ?? mode)}</span><b>${line.played} oyun · ${escapeHtml(recordText(line))}</b></li>`,
    )
    .join('');
  const solo = Object.entries(games.solo)
    .map(([mode, line]) => {
      const best = mode === 'market' ? formatFee(line.best) : line.best;
      return `<li><span>${escapeHtml(MODE_TITLES[mode] ?? mode)} (tek kişilik)</span><b>${line.played} oyun · en iyi ${escapeHtml(best)}</b></li>`;
    })
    .join('');
  return `
    <section class="profile-section">
      <h3>Oyunlar</h3>
      <div class="stat-grid">
        ${tile(total.played, 'Online oyun')}
        ${tile(total.won, 'Galibiyet', 'is-good')}
        ${tile(total.drawn, 'Beraberlik')}
        ${tile(total.lost, 'Mağlubiyet', 'is-bad')}
      </div>
      ${modes || solo ? `<ul class="mode-lines">${modes}${solo}</ul>` : '<p class="profile-note">Henüz kayıtlı oyun yok. Online ve tek kişilik oyunlar burada sayılır.</p>'}
      ${games.recent.length ? `<h4>Son oyunlar</h4>${renderRecentGames(games.recent)}` : ''}
    </section>`;
}

const OUTCOME_TEXT = { won: 'Kazandı', lost: 'Kaybetti', drawn: 'Berabere' };

function renderRecentGames(list) {
  return `<ul class="recent-games">${list
    .map((g) => {
      const mode = MODE_TITLES[g.mode] ?? g.mode;
      const fmt = (v) => (g.mode === 'market' ? formatFee(v) : v);
      const vs = g.opponent
        ? `vs ${escapeHtml(g.opponent.username)}${g.opponent.isGuest ? ' (misafir)' : ''} · ${escapeHtml(fmt(g.myScore))}–${escapeHtml(fmt(g.opponent.score))}`
        : `tek kişilik · ${escapeHtml(fmt(g.myScore))}`;
      const cls = g.outcome === 'won' ? 'is-good' : g.outcome === 'lost' ? 'is-bad' : '';
      return `<li><span>${escapeHtml(mode)} · ${vs}</span>${g.outcome ? `<b class="${cls}">${OUTCOME_TEXT[g.outcome]}</b>` : ''}</li>`;
    })
    .join('')}</ul>`;
}

/** Profil ekranindaki oyuncu aramasi. */
const searchProfiles = debounce(async (q) => {
  const list = $('#profile-search-list');
  if (q.trim().length < 2) {
    list.hidden = true;
    return;
  }
  try {
    const { results } = await api(`/api/users/search?q=${encodeURIComponent(q.trim())}`);
    list.innerHTML = results.length
      ? results
          .map((u) => `<li data-action="view-profile" data-username="${escapeHtml(u.username)}"><b>${escapeHtml(u.username)}</b><small>${escapeHtml(formatCoins(u.coins))}</small></li>`)
          .join('')
      : '<li class="is-empty"><small>Bulunamadı</small></li>';
    list.hidden = false;
  } catch {
    list.hidden = true;
  }
}, 250);

// ================= MAC TAHMINI =================
const predictState = { offset: 0, data: null, drafts: new Map(), timer: null, loading: false };
const DAY_MS = 24 * 60 * 60 * 1000;

/** Turkiye saatiyle tarih (sunucuyla ayni gun tanimi). */
const dateTR = (offset = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + offset * DAY_MS),
  );
const timeTR = (iso) =>
  new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

function openPredict() {
  predictState.offset = 0;
  predictState.drafts.clear();
  show('predict');
  renderAccountUi();
  loadPredict();
  clearInterval(predictState.timer);
  // Ekran aciksa dakikada bir canli skor/durum tazele.
  predictState.timer = setInterval(() => {
    if (!screens.predict.classList.contains('is-active')) return clearInterval(predictState.timer);
    loadPredict({ quiet: true });
  }, 60 * 1000);
}

function dayLabel(offset) {
  if (offset === 0) return 'Bugün';
  if (offset === -1) return 'Dün';
  if (offset === 1) return 'Yarın';
  return fmtDay(dateTR(offset));
}

async function loadPredict({ quiet = false } = {}) {
  if (predictState.loading) return;
  const offset = predictState.offset;
  $('#predict-date').textContent = `${dayLabel(offset)} · ${fmtDay(dateTR(offset))}`;
  $('#predict-login').hidden = !!account.user;
  if (!quiet) $('#predict-list').innerHTML = '<p class="server-list__empty">Maçlar yükleniyor… (ilk açılışta biraz sürebilir)</p>';
  predictState.loading = true;
  try {
    const data = await api(`/api/matches?date=${dateTR(offset)}`);
    if (offset !== predictState.offset) return; // bu arada gun degisti
    predictState.data = data;
    if (data.rewards) $('#predict-rules').textContent = `Doğru sonuç +${data.rewards.pick} · Kesin skor +${data.rewards.exact} para`;
    if (data.user) setAccount({ ...account.user, ...data.user });
    // Yazarken ekran yenilenip giris kaybolmasin.
    const typing = document.activeElement?.closest?.('#predict-list');
    if (!quiet || !typing) renderPredictList();
  } catch (error) {
    if (!quiet) $('#predict-list').innerHTML = `<p class="server-list__empty">Maçlar alınamadı: ${escapeHtml(error.message)}</p>`;
  } finally {
    predictState.loading = false;
  }
}

function statusText(m) {
  if (m.status === 'live') return `<span class="live-badge">CANLI${m.minute ? ` ${m.minute}'` : ''}</span>`;
  if (m.status === 'finished') return `<span class="ms-badge">MS${m.addition ? ' (uzt./pen.)' : ''}</span>`;
  if (m.status === 'void') return '<span class="ms-badge">İptal / Ertelendi</span>';
  if (!m.open) return '<span class="live-badge">BAŞLIYOR</span>';
  return `<span class="match-time">${m.timeDefined ? escapeHtml(timeTR(m.kickoff)) : 'Saat belirsiz'}</span>`;
}

const crest = (url) => (url ? `<img src="${escapeHtml(imgUrl(url))}" alt="" loading="lazy" />` : '<span class="crest-blank"></span>');

function renderMatch(m) {
  const pred = m.prediction;
  const draft = predictState.drafts.get(m.id);
  const pick = draft?.pick ?? pred?.pick ?? null;
  const home = draft ? draft.home : pred?.score?.home ?? '';
  const away = draft ? draft.away : pred?.score?.away ?? '';
  const center = m.score ? `${m.score.home} - ${m.score.away}` : 'vs';
  const classes = ['match-card', `is-${m.status}`, !m.open ? 'is-locked' : ''].join(' ');

  let bottom = '';
  if (m.open && account.user) {
    const pickBtn = (p, label) =>
      `<button class="pick ${pick === p ? 'is-selected' : ''}" data-action="predict-pick" data-pick="${p}" title="${label}">${p}</button>`;
    bottom = `
      <div class="match-card__predict">
        <div class="pick-group">${pickBtn('1', 'Ev sahibi kazanır')}${pickBtn('X', 'Beraberlik')}${pickBtn('2', 'Deplasman kazanır')}</div>
        <div class="score-inputs" title="İsteğe bağlı: kesin skor">
          <input type="text" inputmode="numeric" maxlength="2" data-side="home" placeholder="–" value="${escapeHtml(home)}" aria-label="Ev sahibi gol" />
          <span>:</span>
          <input type="text" inputmode="numeric" maxlength="2" data-side="away" placeholder="–" value="${escapeHtml(away)}" aria-label="Deplasman gol" />
        </div>
        <button class="btn btn--primary btn--small" data-action="predict-save">${pred && !draft ? 'GÜNCELLE' : 'KAYDET'}</button>
      </div>
      <p class="match-card__mine">${
        pred && !draft
          ? `✓ Tahminin kaydedildi: <b>${escapeHtml(pred.pick)}</b>${pred.score ? ` (${pred.score.home}-${pred.score.away})` : ''}`
          : draft
            ? 'Kaydedilmedi'
            : 'Skor isteğe bağlı'
      }</p>`;
  } else if (pred) {
    const badge = predictionBadge({ settled: pred.settled, result: pred.result });
    bottom = `<p class="match-card__mine">Tahminin: <b>${escapeHtml(pred.pick)}</b>${pred.score ? ` (${pred.score.home}-${pred.score.away})` : ''} ${badge}</p>`;
  } else if (!m.open) {
    bottom = '<p class="match-card__mine">Tahmin kapandı.</p>';
  }

  return `
    <div class="${classes}" data-match="${m.id}">
      <div class="match-card__meta">${statusText(m)}</div>
      <div class="match-card__teams">
        <span class="team team--home">${crest(m.home.crestUrl)}<b>${escapeHtml(m.home.name ?? '?')}</b></span>
        <span class="match-card__score">${escapeHtml(center)}</span>
        <span class="team team--away"><b>${escapeHtml(m.away.name ?? '?')}</b>${crest(m.away.crestUrl)}</span>
      </div>
      ${bottom}
      <p class="match-card__hint" data-hint></p>
    </div>`;
}

function renderPredictList() {
  const list = predictState.data?.matches ?? [];
  if (!list.length) {
    $('#predict-list').innerHTML =
      '<p class="server-list__empty">Bu gün büyük turnuvalarda maç yok. (Şampiyonlar Ligi, Avrupa/Konferans Ligi, 5 büyük lig, Süper Lig, Türkiye Kupası ve milli maçlar listelenir.)</p>';
    return;
  }
  const groups = new Map();
  for (const m of list) {
    const key = m.competition.name;
    if (!groups.has(key)) groups.set(key, { competition: m.competition, items: [] });
    groups.get(key).items.push(m);
  }
  $('#predict-list').innerHTML = [...groups.values()]
    .map(
      (g) => `
      <div class="comp-group">
        <h3 class="comp-group__title">${g.competition.logoUrl ? `<img src="${escapeHtml(imgUrl(g.competition.logoUrl))}" alt="" />` : ''}${escapeHtml(g.competition.name)}</h3>
        ${g.items.map(renderMatch).join('')}
      </div>`,
    )
    .join('');
}

const matchOf = (id) => predictState.data?.matches.find((m) => m.id === id);

function cardDraft(card) {
  const id = Number(card.dataset.match);
  const m = matchOf(id);
  const current = predictState.drafts.get(id) ?? {
    pick: m?.prediction?.pick ?? null,
    home: m?.prediction?.score?.home ?? '',
    away: m?.prediction?.score?.away ?? '',
  };
  return { id, draft: { ...current } };
}

const pickFromScore = (home, away) => (home > away ? '1' : home < away ? '2' : 'X');

function rerenderCard(id) {
  const card = document.querySelector(`.match-card[data-match="${id}"]`);
  const m = matchOf(id);
  if (!card || !m) return;
  card.outerHTML = renderMatch(m);
}

function onPick(button) {
  const card = button.closest('.match-card');
  const { id, draft } = cardDraft(card);
  draft.pick = button.dataset.pick;
  // Skor secimle celisiyorsa skoru temizle (skor yazilirsa secim skordan gelir).
  if (draft.home !== '' && draft.away !== '' && pickFromScore(Number(draft.home), Number(draft.away)) !== draft.pick) {
    draft.home = '';
    draft.away = '';
  }
  predictState.drafts.set(id, draft);
  rerenderCard(id);
}

function onScoreInput(input) {
  const card = input.closest('.match-card');
  input.value = input.value.replace(/\D/g, '').slice(0, 2);
  const { id, draft } = cardDraft(card);
  draft[input.dataset.side] = input.value;
  if (draft.home !== '' && draft.away !== '') {
    draft.pick = pickFromScore(Number(draft.home), Number(draft.away));
    for (const btn of card.querySelectorAll('.pick')) btn.classList.toggle('is-selected', btn.dataset.pick === draft.pick);
  }
  predictState.drafts.set(id, draft);
  const mine = card.querySelector('.match-card__mine');
  if (mine) mine.textContent = 'Kaydedilmedi';
}

async function savePick(button) {
  const card = button.closest('.match-card');
  const { id, draft } = cardDraft(card);
  const hint = card.querySelector('[data-hint]');
  const hasScore = draft.home !== '' && draft.away !== '';
  if ((draft.home !== '') !== (draft.away !== '')) {
    hint.textContent = 'Skoru iki taraf için de yaz ya da ikisini de boş bırak.';
    return;
  }
  if (!draft.pick && !hasScore) {
    hint.textContent = '1, X ya da 2 seç.';
    return;
  }
  button.disabled = true;
  try {
    const saved = await api(`/api/matches/${id}/prediction`, {
      method: 'PUT',
      body: { pick: draft.pick, score: hasScore ? { home: Number(draft.home), away: Number(draft.away) } : null },
    });
    const m = matchOf(id);
    if (m) m.prediction = { ...(m.prediction ?? {}), pick: saved.pick, score: saved.score, settled: false };
    predictState.drafts.delete(id);
    rerenderCard(id);
  } catch (error) {
    hint.textContent = error.message;
    button.disabled = false;
    if (error.status === 409) loadPredict({ quiet: true }); // mac basladi
  }
}

// ================= OLAYLAR =================
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  switch (target.dataset.action) {
    case 'open-profile':
      openProfile(null, { returnTo: 'menu' });
      break;
    case 'view-profile': {
      // Lobiden bakilirsa geri donunce lobide kalinsin (odadan cikilmasin).
      const fromLobby = screens.online.classList.contains('is-active') && online.roomCode;
      if (fromLobby) profileState.returnTo = 'online';
      else if (!screens.profile.classList.contains('is-active')) profileState.returnTo = 'menu';
      openProfile(target.dataset.username);
      break;
    }
    case 'profile-back':
      if (profileState.returnTo === 'online' && online.roomCode) show('online');
      else show('menu');
      break;
    case 'profile-logout':
      logoutAccount();
      break;
    case 'open-auth':
      openAuth(screens.predict.classList.contains('is-active') ? 'predict' : 'menu');
      break;
    case 'auth-tab':
      setAuthTab(target.dataset.tab);
      break;
    case 'auth-back':
      if (authState.returnTo === 'predict') openPredict();
      else show('menu');
      break;
    case 'open-predict':
      openPredict();
      break;
    case 'predict-day': {
      const next = predictState.offset + Number(target.dataset.step);
      if (next < -3 || next > 3) break; // sunucu ±3 gun tutar
      predictState.offset = next;
      predictState.drafts.clear();
      loadPredict();
      break;
    }
    case 'predict-pick':
      onPick(target);
      break;
    case 'predict-save':
      savePick(target);
      break;
    default:
      break;
  }
});

document.addEventListener('input', (event) => {
  const el = event.target;
  if (el.matches?.('#predict-list .score-inputs input')) onScoreInput(el);
  if (el.id === 'profile-search') searchProfiles(el.value);
});

$('#auth-form').addEventListener('submit', submitAuth);
document.addEventListener('click', (event) => {
  if (!event.target.closest('.user-search')) $('#profile-search-list').hidden = true;
});

// ---- baslat: kayitli oturumu dogrula ----
(function bootAccount() {
  const token = loadToken();
  renderAccountUi();
  if (!token) return;
  account.token = token;
  refreshMe();
})();
