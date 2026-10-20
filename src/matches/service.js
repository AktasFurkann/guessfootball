import { matches, predictions, users } from '../db.js';
import { fetchFeaturedDay, fetchGames, gameStatus, COMPETITION_ORDER } from './source.js';

/**
 * Mac tahmini servisi: gunun maclarini onbellege alir, canli skorlari yeniler,
 * tahminleri kilitler ve maclar bitince tahminleri sonuclandirip para dagitir.
 *
 * Render'in ucretsiz plani bos kalinca uyudugu icin zamanlayiciya guvenilmez;
 * her istekte de gecikmis isler (biten mac, sonuclanmamis tahmin) yapilir.
 */

/** Dogru 1-X-2 tahmini. */
export const PICK_COINS = 50;
/** Kesin skoru bilmek (1-X-2 parasina ek). */
export const EXACT_COINS = 1000;

const TZ = 'Europe/Istanbul';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Gun listesi bu kadar eskiyse arka planda yeniden cekilir. */
const DAY_STALE_MS = 30 * 60 * 1000;
/** Canli skor yenileme araligi (istek tetiklemeli + zamanlayici). */
const REFRESH_MIN_MS = 45 * 1000;
/** Testlerde Transfermarkt'a gidilmesin: MATCH_SYNC=off. */
const syncEnabled = () => process.env.MATCH_SYNC !== 'off';

/** Turkiye saatiyle tarih (YYYY-MM-DD); offset gun ekler/cikarir. */
export function dateTR(offsetDays = 0, now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(now + offsetDays * DAY_MS),
  );
}

export const isValidDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''));

const daySyncedAt = new Map(); // date -> ms
const daySyncing = new Map(); // date -> Promise

/** Gunun listesini Transfermarkt'tan ceker ve veritabanina yazar. */
async function syncDay(date) {
  const docs = await fetchFeaturedDay(date);
  if (docs.length) {
    await matches().bulkWrite(
      docs.map((doc) => ({ updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true } })),
      { ordered: false },
    );
  }
  daySyncedAt.set(date, Date.now());
  await settleFinished(docs.filter((d) => d.status === 'finished' || d.status === 'void').map((d) => d._id));
  return docs.length;
}

/** Ayni gun icin eszamanli cekimleri tek istege baglar. */
function syncDayOnce(date) {
  if (!daySyncing.has(date)) {
    daySyncing.set(
      date,
      syncDay(date).finally(() => daySyncing.delete(date)),
    );
  }
  return daySyncing.get(date);
}

let lastRefresh = 0;
let refreshing = null;

/** Baslamis/baslamak uzere olan ve bitmemis maclarin skorunu yeniler. */
export async function refreshActive({ force = false } = {}) {
  if (refreshing) return refreshing;
  if (!force && Date.now() - lastRefresh < REFRESH_MIN_MS) return null;
  lastRefresh = Date.now();
  refreshing = (async () => {
    const now = Date.now();
    const active = await matches()
      .find(
        {
          status: { $in: ['scheduled', 'live'] },
          kickoff: { $lte: new Date(now + 2 * 60 * 1000), $gte: new Date(now - 2 * DAY_MS) },
        },
        { projection: { _id: 1 } },
      )
      .toArray();
    if (active.length && syncEnabled()) {
      const games = await fetchGames(active.map((m) => String(m._id)));
      const done = [];
      await Promise.all(
        games.map((game) => {
          const update = { ...gameStatus(game), updatedAt: new Date() };
          if (update.status === 'finished' || update.status === 'void') done.push(Number(game.id));
          return matches().updateOne({ _id: Number(game.id) }, { $set: update });
        }),
      );
      await settleFinished(done);
    }
    await settleBacklog();
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Bir gunun maclarini hazirlar: veritabaninda yoksa bekleyerek ceker, eskiyse
 * arka planda tazeler; canli skorlari da yeniler (Transfermarkt'a ulasilamazsa
 * veritabanindaki son hal kullanilir).
 */
export async function ensureDay(date) {
  if (!syncEnabled()) return settleBacklog();
  const count = await matches().countDocuments({ date });
  const stale = Date.now() - (daySyncedAt.get(date) ?? 0) > DAY_STALE_MS;
  if (!count) {
    await syncDayOnce(date).catch((error) => console.warn('[matches] Gün alınamadı:', date, error.message));
  } else if (stale) {
    syncDayOnce(date).catch((error) => console.warn('[matches] Gün tazelenemedi:', date, error.message));
  }
  await refreshActive().catch((error) => console.warn('[matches] Skorlar yenilenemedi:', error.message));
}

/** Gunun maclari: turnuva sirasina, sonra saate gore. */
export async function listDay(date) {
  const list = await matches().find({ date }).toArray();
  const rank = (id) => {
    const i = COMPETITION_ORDER.indexOf(id);
    return i < 0 ? COMPETITION_ORDER.length : i;
  };
  return list.sort((a, b) => rank(a.competition.id) - rank(b.competition.id) || a.kickoff - b.kickoff);
}

/** Tahmin edilebilir mi? (baslama saatinden once ve iptal edilmemis) */
export const isOpen = (match, now = Date.now()) => match.status === 'scheduled' && now < new Date(match.kickoff).getTime();

/** 90 dakikanin sonucu: '1' | 'X' | '2'. Uzatma/penaltiya giden mac beraberliktir. */
export function resultPick(match) {
  if (!match.regularScoreKnown) return 'X';
  const { home, away } = match.score;
  return home > away ? '1' : home < away ? '2' : 'X';
}

/** Tek bir tahminin sonucu (saf fonksiyon; test edilebilir). */
export function evaluatePrediction(prediction, match) {
  if (match.status === 'void' || !match.score) return { void: true, correctPick: false, exactScore: false, coins: 0 };
  const correctPick = prediction.pick === resultPick(match);
  const exactScore =
    !!prediction.score &&
    match.regularScoreKnown &&
    prediction.score.home === match.score.home &&
    prediction.score.away === match.score.away;
  return {
    void: false,
    correctPick,
    exactScore,
    coins: (correctPick ? PICK_COINS : 0) + (exactScore ? EXACT_COINS : 0),
    finalScore: match.score,
    resultPick: resultPick(match),
  };
}

/** Biten/iptal maclarin tahminlerini sonuclandirir (tekrar calistirmak guvenlidir). */
export async function settleFinished(matchIds) {
  if (!matchIds.length) return;
  const done = await matches()
    .find({ _id: { $in: matchIds }, status: { $in: ['finished', 'void'] } })
    .toArray();
  for (const match of done) {
    const open = await predictions().find({ matchId: match._id, settled: false }).toArray();
    for (const prediction of open) {
      const result = evaluatePrediction(prediction, match);
      // settled:false kosulu ayni tahminin iki kez para kazandirmasini engeller.
      const { modifiedCount } = await predictions().updateOne(
        { _id: prediction._id, settled: false },
        { $set: { settled: true, settledAt: new Date(), result } },
      );
      if (modifiedCount && result.coins) {
        await users().updateOne({ _id: prediction.userId }, { $inc: { coins: result.coins } });
      }
    }
  }
}

/** Sonuclanmamis tahmini olan ama maci bitmis kayitlari yakalar (uyuyan sunucu). */
async function settleBacklog() {
  const ids = await predictions().distinct('matchId', { settled: false });
  if (!ids.length) return;
  const finished = await matches().distinct('_id', { _id: { $in: ids }, status: { $in: ['finished', 'void'] } });
  await settleFinished(finished);
}

export class PredictionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const parseGoals = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 30 ? n : null;
};

/**
 * Tahmini kaydeder/gunceller. Skor verilirse 1-X-2 skordan turetilir (celiski
 * olmasin). Mac basladiktan sonra tahmin degistirilemez.
 */
export async function savePrediction(user, matchId, { pick, score } = {}) {
  const match = await matches().findOne({ _id: Number(matchId) });
  if (!match) throw new PredictionError('Maç bulunamadı.', 404);
  if (!isOpen(match)) throw new PredictionError('Bu maç başladı, tahmin kapandı.', 409);

  let cleanScore = null;
  if (score && (score.home !== '' || score.away !== '') && score.home != null && score.away != null) {
    const home = parseGoals(score.home);
    const away = parseGoals(score.away);
    if (home == null || away == null) throw new PredictionError('Skor 0-30 arası tam sayı olmalı.');
    cleanScore = { home, away };
  }
  let cleanPick = cleanScore
    ? cleanScore.home > cleanScore.away
      ? '1'
      : cleanScore.home < cleanScore.away
        ? '2'
        : 'X'
    : pick;
  cleanPick = String(cleanPick ?? '').toUpperCase();
  if (!['1', 'X', '2'].includes(cleanPick)) throw new PredictionError('1, X veya 2 seç.');

  const now = new Date();
  await predictions().updateOne(
    { userId: user._id, matchId: match._id },
    {
      $set: { pick: cleanPick, score: cleanScore, updatedAt: now, date: match.date },
      $setOnInsert: { userId: user._id, matchId: match._id, createdAt: now, settled: false },
    },
    { upsert: true },
  );
  return { matchId: match._id, pick: cleanPick, score: cleanScore };
}

/** Kullanicinin verilen maclardaki tahminleri: matchId -> tahmin. */
export async function predictionsFor(userId, matchIds) {
  const list = await predictions()
    .find({ userId, matchId: { $in: matchIds } }, { projection: { _id: 0, matchId: 1, pick: 1, score: 1, settled: 1, result: 1 } })
    .toArray();
  return Object.fromEntries(list.map((p) => [p.matchId, p]));
}

/**
 * Son 2 gunde "iptal" isaretlenmis maclari yeniden acar ve tahminlerini
 * sonuclanmamis hale getirir; bir sonraki yenileme durumlarini bastan hesaplar.
 * Gercekten iptal olan mac yine iptal bulunur (0 para), yani tekrar calismasi
 * guvenlidir. Eski bir hatada canli maclar ("Playing") iptal sayilmisti.
 */
export async function reopenRecentVoid(now = Date.now()) {
  const recent = await matches()
    .find({ status: 'void', kickoff: { $gte: new Date(now - 2 * DAY_MS), $lte: new Date(now) } }, { projection: { _id: 1 } })
    .toArray();
  if (!recent.length) return 0;
  const ids = recent.map((m) => m._id);
  await matches().updateMany({ _id: { $in: ids } }, { $set: { status: 'live' } });
  await predictions().updateMany(
    { matchId: { $in: ids }, settled: true, 'result.void': true },
    { $set: { settled: false }, $unset: { result: '', settledAt: '' } },
  );
  return ids.length;
}

let timers = [];

/** Sunucu ayaktayken: bugun/yarin listesini ve canli skorlari duzenli tazeler. */
export function startMatchScheduler() {
  if (!syncEnabled()) return;
  const run = (fn) => fn().catch((error) => console.warn('[matches]', error.message));
  // Acilista bugun, sonra dun (sonuclar) ve yarin: ilk acan kullanici beklemesin.
  run(async () => {
    const reopened = await reopenRecentVoid();
    if (reopened) console.log(`[matches] ${reopened} iptal görünen maç yeniden kontrol ediliyor`);
    await refreshActive({ force: true }).catch(() => {});
    for (const offset of [0, -1, 1]) await syncDayOnce(dateTR(offset)).catch(() => {});
  });
  timers = [
    setInterval(() => run(() => refreshActive({ force: true })), 60 * 1000),
    setInterval(() => run(() => syncDayOnce(dateTR(0))), DAY_STALE_MS),
    setInterval(() => run(() => syncDayOnce(dateTR(1))), 3 * 60 * 60 * 1000),
  ];
  for (const timer of timers) timer.unref?.();
}
