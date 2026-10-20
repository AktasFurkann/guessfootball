import { matches } from '../db.js';
import { fetchEntities } from '../transfermarkt/client.js';
import { fetchGames, gameStatus } from './source.js';

/**
 * Mac detayi: olaylar (gol, kart, degisiklik), takim istatistikleri, kadrolar
 * ve dakika dakika anlatim. Hepsi tmapi `/games` yanitinda zaten var; burada
 * okunur hale getirilir ve oyuncu kimlikleri isimlere cevrilir.
 *
 * Yalnizca listemizde (matches koleksiyonu) olan maclar sorulabilir; vekilin
 * rastgele mac kimlikleriyle Transfermarkt'a istek yagdirmasi engellenir.
 * Tahmin/mac kayitlarina hicbir sey yazilmaz.
 */

/** Durumuna gore onbellek suresi: canli mac sik, bitmis mac seyrek tazelenir. */
const TTL = { live: 25 * 1000, scheduled: 5 * 60 * 1000, finished: 6 * 60 * 60 * 1000, void: 6 * 60 * 60 * 1000 };
const cache = new Map(); // id -> { at, ttl, data }
const inflight = new Map(); // id -> Promise
const playerNames = new Map(); // oyuncu id -> isim (surec boyunca)

/**
 * Kart kodlari (actionReasonId). 20 Ekim 2026'daki Trabzonspor-Besiktas macinda
 * takim istatistigiyle (4 sari) eslestirildi: 301 sari, 311 sahadan cikmis
 * oyuncuya sari. Kirmizi kodlari henuz bir macta gorulmedi; tahmini degerler.
 */
const CARD_KIND = { 301: 'yellow', 311: 'yellow', 302: 'secondYellow', 312: 'secondYellow', 303: 'red', 313: 'red' };

async function resolveNames(ids) {
  const missing = [...new Set(ids.map(String))].filter((id) => id && id !== '0' && !playerNames.has(id));
  if (missing.length) {
    try {
      for (const p of await fetchEntities('players', missing)) playerNames.set(String(p.id), p.name ?? null);
    } catch {
      /* isimler gelmezse kimlik yerine "?" gosterilir */
    }
  }
  return (id) => (id ? playerNames.get(String(id)) ?? null : null);
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Takim istatistiklerini ekranda gosterilecek duz bir nesneye cevirir. */
function clubStats(club) {
  const s = club?.clubStatistics;
  if (!s) return null;
  const g = s.gameStatistics ?? {};
  const goal = s.goalStatistics ?? {};
  const pass = s.passingStatistics ?? {};
  const def = s.defensiveStatistics ?? {};
  const set = s.setPieceStatistics ?? {};
  const pen = s.penaltyStatistics ?? {};
  return {
    possession: num(g.possessionPercentage),
    shots: num(goal.totalShotAttempts),
    shotsOnTarget: num(goal.onTargetShotAttempts),
    shotsOffTarget: num(goal.offTargetShotAttempts),
    shotsBlocked: num(goal.blockedShotAttempts),
    passes: num(pass.totalPasses),
    accuratePasses: num(pass.accuratePasses),
    corners: num(set.cornersTaken),
    offsides: num(def.offsides),
    fouls: num(pen.freeKicksConcededFromFouls),
    tackles: num(def.totalTackles),
    saves: num(def.saves),
    yellowCards: num(g.yellowCards),
    redCards: (num(g.redCards) ?? 0) + (num(g.secondYellowCards) ?? 0),
    throwIns: num(set.throwIns),
  };
}

function lineupOf(club, nameOf) {
  const map = (p) => ({
    id: String(p.id),
    name: nameOf(p.id) ?? '?',
    shirt: p.shirtNumber ?? null,
    captain: !!p.isCaptain,
    position: p.position?.shortName ?? null,
  });
  return {
    formation: club?.tactic?.tactic ?? null,
    players: (club?.lineup?.players ?? []).map(map),
    substitutes: (club?.lineup?.substitutes ?? []).map(map),
  };
}

/** Gol, kart ve degisiklikler (dakika sirasiyla). */
function eventsOf(game, nameOf) {
  const homeId = String(game.homeClub?.clubId);
  return (game.actions ?? [])
    .filter((a) => ['GOAL', 'CARD', 'SUBSTITUTE'].includes(a.type))
    .map((a) => {
      const base = {
        minute: a.minute ?? null,
        addedTime: a.addedTime || 0,
        side: String(a.clubId) === homeId ? 'home' : 'away',
      };
      if (a.type === 'GOAL') {
        return { ...base, type: 'goal', player: nameOf(a.activePlayerId), assist: nameOf(a.passivePlayerId) };
      }
      if (a.type === 'CARD') {
        return { ...base, type: 'card', card: CARD_KIND[a.actionReasonId] ?? 'yellow', player: nameOf(a.activePlayerId) };
      }
      // Degisiklikte aktif oyuncu cikan, pasif oyuncu giren (bkz. 20 Ekim Trabzonspor-Besiktas).
      return { ...base, type: 'sub', out: nameOf(a.activePlayerId), in: nameOf(a.passivePlayerId) };
    })
    .sort((x, y) => x.minute - y.minute || x.addedTime - y.addedTime);
}

async function build(match) {
  const [game] = await fetchGames([String(match._id)]);
  if (!game) return null;
  const status = gameStatus(game);
  const ids = [
    ...(game.actions ?? []).flatMap((a) => [a.activePlayerId, a.passivePlayerId]),
    ...[game.homeClub, game.awayClub].flatMap((c) => [...(c?.lineup?.players ?? []), ...(c?.lineup?.substitutes ?? [])].map((p) => p.id)),
  ].filter(Boolean);
  const nameOf = await resolveNames(ids);
  const ticker = (game.liveDetails?.ticker ?? []).slice(0, 120).map((t) => ({
    minute: t.minuteDisplay || '',
    type: t.type || 'other',
    text: t.content || '',
  }));

  return {
    id: match._id,
    kickoff: match.kickoff,
    timeDefined: match.timeDefined,
    competition: match.competition,
    status: status.status,
    score: status.score,
    minute: status.minute,
    period: status.period,
    addition: status.addition,
    home: { ...match.home, stats: clubStats(game.homeClub), lineup: lineupOf(game.homeClub, nameOf) },
    away: { ...match.away, stats: clubStats(game.awayClub), lineup: lineupOf(game.awayClub, nameOf) },
    events: eventsOf(game, nameOf),
    ticker,
    updatedAt: new Date(),
  };
}

/** Mac detayi (onbellekli); listede olmayan mac icin null. */
export async function getMatchDetail(id) {
  const matchId = Number(id);
  if (!Number.isInteger(matchId)) return null;
  const hit = cache.get(matchId);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;

  const match = await matches().findOne({ _id: matchId });
  if (!match) return null;

  if (!inflight.has(matchId)) {
    inflight.set(
      matchId,
      build(match)
        .then((data) => {
          if (data) cache.set(matchId, { at: Date.now(), ttl: TTL[data.status] ?? TTL.live, data });
          return data;
        })
        .finally(() => inflight.delete(matchId)),
    );
  }
  try {
    return await inflight.get(matchId);
  } catch (error) {
    // Transfermarkt'a ulasilamazsa eski veri varsa onu goster.
    if (hit) return { ...hit.data, stale: true };
    throw error;
  }
}
