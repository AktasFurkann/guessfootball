import { users, gameResults, predictions, matches } from '../db.js';
import { usernameKey, publicUser } from '../auth/accounts.js';

/**
 * Oyun sonuclari ve profil istatistikleri.
 *
 * Sayaclar kullanici dokumaninda tutulmaz; her profil acilisinda ham
 * kayitlardan (gameResults, predictions) hesaplanir. Boylece bir hata ya da
 * yarim kalan yazma sayaclari kaydirmaz.
 */

/** Online oyunu kazanan hesaba verilen para. */
export const ONLINE_WIN_COINS = 20;
export const GAME_MODES = ['closest', 'compare', 'squad', 'superlig', 'market'];
const DRAFT_MODES = new Set(['squad', 'superlig', 'market']);

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * Bitmis bir online oyunu kaydeder. Giris yapmamis (misafir) oyuncu userId'siz
 * yazilir: kendi profili olmaz ama rakibinin istatistigine sayilir.
 * @param {{mode:string, length?:string, pool?:string, players:{userId?:ObjectId|null, username:string, score:number}[]}} game
 */
export async function recordOnlineGame({ mode, length = null, pool = null, players }) {
  if (players.length !== 2 || !players.some((p) => p.userId)) return null; // kaydedilecek hesap yok
  const [a, b] = players.map((p) => Number(p.score) || 0);
  const winnerIndex = a === b ? null : a > b ? 0 : 1;
  const doc = {
    kind: 'online',
    mode,
    length,
    pool,
    at: new Date(),
    players: players.map((p) => ({ userId: p.userId ?? null, username: p.username, score: Number(p.score) || 0 })),
    winnerIndex,
  };
  await gameResults().insertOne(doc);
  const winner = winnerIndex == null ? null : players[winnerIndex];
  if (winner?.userId) await users().updateOne({ _id: winner.userId }, { $inc: { coins: ONLINE_WIN_COINS } });
  return doc;
}

/** Tek kisilik (kadro modlari) bitmis oyun. */
export async function recordSoloGame(user, { mode, length, total }) {
  if (!DRAFT_MODES.has(mode)) throw Object.assign(new Error('Geçersiz mod.'), { status: 400 });
  const score = Number(total);
  if (!Number.isFinite(score) || score < 0 || score > 1e6) throw Object.assign(new Error('Geçersiz skor.'), { status: 400 });
  await gameResults().insertOne({
    kind: 'solo',
    mode,
    length: length === 'long' ? 'long' : 'short',
    at: new Date(),
    players: [{ userId: user._id, username: user.username, score }],
    winnerIndex: null,
  });
}

/** Bir oyunun, verilen kullanici acisindan sonucu: 'won' | 'lost' | 'drawn'. */
function outcomeFor(game, userId) {
  const index = game.players.findIndex((p) => sameId(p.userId, userId));
  if (game.winnerIndex == null) return 'drawn';
  return game.winnerIndex === index ? 'won' : 'lost';
}

const emptyLine = () => ({ played: 0, won: 0, lost: 0, drawn: 0 });

/** Ekranda gosterilecek kisa oyun ozeti (rakip ve skor). */
function gameSummary(game, userId) {
  const meIndex = game.players.findIndex((p) => sameId(p.userId, userId));
  const me = game.players[meIndex];
  const opp = game.players[1 - meIndex] ?? null;
  return {
    at: game.at,
    kind: game.kind,
    mode: game.mode,
    length: game.length,
    myScore: me?.score ?? 0,
    opponent: opp ? { username: opp.username, score: opp.score, isGuest: !opp.userId } : null,
    outcome: game.kind === 'online' ? outcomeFor(game, userId) : null,
  };
}

async function gameStats(userId) {
  const list = await gameResults().find({ 'players.userId': userId }).sort({ at: -1 }).limit(5000).toArray();
  const online = { total: emptyLine(), byMode: Object.fromEntries(GAME_MODES.map((m) => [m, emptyLine()])) };
  const solo = {};
  for (const game of list) {
    if (game.kind === 'online') {
      const outcome = outcomeFor(game, userId);
      for (const line of [online.total, online.byMode[game.mode] ?? (online.byMode[game.mode] = emptyLine())]) {
        line.played += 1;
        line[outcome] += 1;
      }
    } else {
      const me = game.players[0];
      const line = (solo[game.mode] ??= { played: 0, best: 0 });
      line.played += 1;
      line.best = Math.max(line.best, me?.score ?? 0);
    }
  }
  return { online, solo, recent: list.slice(0, 15).map((g) => gameSummary(g, userId)), list };
}

/** viewer'in target'a karsi rekabeti (viewer acisindan). */
function headToHead(targetGames, targetId, viewerId) {
  const shared = targetGames.filter(
    (g) => g.kind === 'online' && g.players.some((p) => sameId(p.userId, viewerId)) && g.players.some((p) => sameId(p.userId, targetId)),
  );
  const line = emptyLine();
  const byMode = {};
  for (const game of shared) {
    const outcome = outcomeFor(game, viewerId);
    line.played += 1;
    line[outcome] += 1;
    const m = (byMode[game.mode] ??= emptyLine());
    m.played += 1;
    m[outcome] += 1;
  }
  return { ...line, byMode, recent: shared.slice(0, 10).map((g) => gameSummary(g, viewerId)) };
}

async function predictionStats(userId) {
  const list = await predictions().find({ userId }).sort({ date: -1, matchId: 1 }).limit(300).toArray();
  const summary = { total: list.length, settled: 0, pending: 0, correct: 0, wrong: 0, exact: 0, void: 0, coinsWon: 0 };
  for (const p of list) {
    if (!p.settled) summary.pending += 1;
    else if (p.result?.void) summary.void += 1;
    else {
      summary.settled += 1;
      if (p.result.correctPick) summary.correct += 1;
      else summary.wrong += 1;
      if (p.result.exactScore) summary.exact += 1;
      summary.coinsWon += p.result.coins || 0;
    }
  }

  // Gecmis: maclarla birlestir, son 100 tahmin.
  const recent = list.slice(0, 100);
  const matchDocs = await matches()
    .find({ _id: { $in: recent.map((p) => p.matchId) } }, { projection: { home: 1, away: 1, competition: 1, kickoff: 1, score: 1, status: 1, regularScoreKnown: 1 } })
    .toArray();
  const byId = new Map(matchDocs.map((m) => [m._id, m]));
  const history = recent
    .map((p) => {
      const m = byId.get(p.matchId);
      if (!m) return null;
      return {
        date: p.date,
        matchId: p.matchId,
        home: m.home?.name,
        away: m.away?.name,
        competition: m.competition?.name,
        kickoff: m.kickoff,
        status: m.status,
        finalScore: m.score,
        pick: p.pick,
        score: p.score,
        settled: p.settled,
        result: p.result ?? null,
      };
    })
    .filter(Boolean);
  return { summary, history };
}

/** Profil: hedef kullanicinin herkese acik bilgileri (+ bakan kisiyle rekabet). */
export async function getProfile(username, viewer = null) {
  const target = await users().findOne({ usernameKey: usernameKey(username) }, { projection: { password: 0 } });
  if (!target) return null;
  const [games, preds] = await Promise.all([gameStats(target._id), predictionStats(target._id)]);
  const isSelf = sameId(viewer?._id, target._id);
  return {
    user: publicUser(target),
    isSelf,
    games: { online: games.online, solo: games.solo, recent: games.recent },
    predictions: preds,
    headToHead: viewer && !isSelf ? { opponent: target.username, ...headToHead(games.list, target._id, viewer._id) } : null,
  };
}

/** Kullanici adi aramasi (profil bulmak icin). */
export async function searchUsers(q, limit = 10) {
  const key = usernameKey(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!key) return [];
  const list = await users()
    .find({ usernameKey: { $regex: `^${key}` } }, { projection: { username: 1, coins: 1 } })
    .limit(limit)
    .toArray();
  return list.map((u) => ({ username: u.username, coins: u.coins ?? 0 }));
}

/** Para siralamasi (profil ekraninda kucuk tablo). */
export async function leaderboard(limit = 10) {
  const list = await users().find({}, { projection: { username: 1, coins: 1 } }).sort({ coins: -1 }).limit(limit).toArray();
  return list.map((u) => ({ username: u.username, coins: u.coins ?? 0 }));
}
