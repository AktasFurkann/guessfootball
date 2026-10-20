import { request, requestText, fetchEntities } from '../transfermarkt/client.js';
import { TMAPI_BASE } from '../transfermarkt/endpoints.js';

/**
 * Transfermarkt'tan gunun maclari.
 *
 * tmapi'de "tarihe gore mac listesi" ucu yok; gunun mac kimlikleri sitenin
 * canli sayfasindan (`/live/index?datum=YYYY-MM-DD`, Turkiye saatiyle gun) okunur,
 * ayrintilar (saat, takimlar, skor, canli dakika) tmapi `/games` ucundan gelir.
 * Biten maclarin sonucu da ayni uctan, yalnizca kimlikle sorulur; bu yuzden site
 * sayfasi gecici olarak erisilemese bile kayitli maclarin sonuclari islenir.
 */

/** Listelenen buyuk turnuvalar (Transfermarkt musabaka kodlari). */
export const FEATURED_COMPETITIONS = new Map([
  ['CL', 'UEFA Şampiyonlar Ligi'],
  ['EL', 'UEFA Avrupa Ligi'],
  ['UCOL', 'UEFA Konferans Ligi'],
  ['TR1', 'Süper Lig'],
  ['TRP', 'Türkiye Kupası'],
  ['GB1', 'Premier League'],
  ['ES1', 'LaLiga'],
  ['IT1', 'Serie A'],
  ['L1', 'Bundesliga'],
  ['FR1', 'Ligue 1'],
]);

/** Ekranda turnuva sirasi (milli maclar en sonda). */
export const COMPETITION_ORDER = [...FEATURED_COMPETITIONS.keys()];

/** Gencler / kadinlar milli takimlari ("Türkiye U21", "Türkiye (K)") listeye girmez. */
const isSeniorNationalName = (name) => !/\bU\s?\d{2}\b|\(K\)|\(W\)|Women|Kadın|Olimp/i.test(name || '');

const SITES = ['https://www.transfermarkt.com.tr', 'https://www.transfermarkt.com'];

/** Gunun mac kimlikleri (site sayfasindan). Erisilemezse hata firlatir. */
export async function fetchDayGameIds(date) {
  let lastError;
  for (const site of SITES) {
    try {
      const html = await requestText(`${site}/live/index?datum=${date}`, { label: `live ${date}` });
      const ids = [...new Set([...html.matchAll(/spielbericht\/index\/spielbericht\/(\d+)/g)].map((m) => m[1]))];
      if (ids.length) return ids;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

/** tmapi'den mac ayrintilari (50'lik gruplar halinde). */
export async function fetchGames(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const query = ids
      .slice(i, i + 50)
      .map((id) => `ids%5B%5D=${encodeURIComponent(id)}`)
      .join('&');
    const res = await request(`${TMAPI_BASE}/games?${query}`, { label: 'games' });
    out.push(...(res?.data ?? []));
  }
  return out;
}

const clubCache = new Map(); // clubId -> { id, name, crestUrl, isNationalTeam }

/** Kulup/milli takim adlari ve logolari (surec icinde onbellekli). */
export async function fetchClubs(clubIds) {
  const missing = [...new Set(clubIds.map(String))].filter((id) => id && !clubCache.has(id));
  for (let i = 0; i < missing.length; i += 50) {
    const list = await fetchEntities('clubs', missing.slice(i, i + 50));
    for (const club of list) {
      clubCache.set(String(club.id), {
        id: String(club.id),
        name: club.name?.trim() || null,
        crestUrl: club.crestUrl ?? null,
        isNationalTeam: !!club.baseDetails?.isNationalTeam,
      });
    }
  }
  return clubCache;
}

/**
 * Bir tmapi mac kaydinin durumunu cikarir.
 * Transfermarkt uzatma/penalti sonrasi skoru (penaltilar dahil) verir; 90
 * dakika tahmini icin bu maclar beraberlik sayilir ve kesin skor
 * degerlendirilemez (`regularScoreKnown: false`).
 */
export function gameStatus(game, now = Date.now()) {
  const kickoff = Date.parse(game.baseDetails?.date?.dateTimeUTC ?? '');
  const score = game.score ?? {};
  const live = game.liveDetails ?? null;
  const endType = score.details?.gameEndType ?? null;
  const hasScore = score.home != null && score.away != null;
  const afterExtra = ['after_extra_time', 'after_shootout'].includes(score.additionType);

  let status = 'scheduled';
  if (endType && endType !== 'RegularlyTerminated') status = 'void'; // tatil / iptal
  else if (endType === 'RegularlyTerminated' || live?.period === 'FULL_TIME') status = hasScore ? 'finished' : 'void';
  else if (Number.isFinite(kickoff) && now >= kickoff) {
    const elapsed = now - kickoff;
    if (hasScore && elapsed > 150 * 60 * 1000) status = 'finished'; // kapsami zayif maclar
    else if (!hasScore && elapsed > 6 * 60 * 60 * 1000) status = 'void'; // ertelenmis
    else status = 'live';
  }

  return {
    status,
    score: hasScore ? { home: score.home, away: score.away } : null,
    regularScoreKnown: !afterExtra,
    addition: afterExtra ? score.additionType : null,
    minute: status === 'live' && live?.gameMinute ? live.gameMinute + (live.overtimeMinute || 0) : null,
    period: live?.period ?? null,
  };
}

/** tmapi kaydini veritabani dokumanina cevirir (takim bilgisiyle). */
export function toMatchDoc(game, clubs, date) {
  const comp = game.baseDetails?.competition ?? {};
  const home = clubs.get(String(game.homeClub?.clubId)) ?? { id: String(game.homeClub?.clubId), name: null };
  const away = clubs.get(String(game.awayClub?.clubId)) ?? { id: String(game.awayClub?.clubId), name: null };
  const national = home.isNationalTeam && away.isNationalTeam;
  return {
    _id: Number(game.id),
    date,
    kickoff: new Date(game.baseDetails?.date?.dateTimeUTC),
    timeDefined: game.baseDetails?.date?.isTimeDefined !== false,
    competition: {
      id: national && !FEATURED_COMPETITIONS.has(comp.id) ? 'NATIONAL' : comp.id,
      name: national && !FEATURED_COMPETITIONS.has(comp.id) ? `Milli Maç · ${comp.name}` : FEATURED_COMPETITIONS.get(comp.id) ?? comp.name,
      logoUrl: comp.logoUrl ?? null,
    },
    home: { id: home.id, name: home.name, crestUrl: home.crestUrl ?? null },
    away: { id: away.id, name: away.name, crestUrl: away.crestUrl ?? null },
    ...gameStatus(game),
    updatedAt: new Date(),
  };
}

/** Listelenecek mac mi? Buyuk turnuvalar + A milli takim maclari. */
export function isFeatured(game, clubs) {
  if (FEATURED_COMPETITIONS.has(game.baseDetails?.competitionId)) return true;
  const home = clubs.get(String(game.homeClub?.clubId));
  const away = clubs.get(String(game.awayClub?.clubId));
  return !!(
    home?.isNationalTeam &&
    away?.isNationalTeam &&
    isSeniorNationalName(home.name) &&
    isSeniorNationalName(away.name)
  );
}

/** Gunun listelenecek maclarini veritabani dokumanlari olarak dondurur. */
export async function fetchFeaturedDay(date) {
  const ids = await fetchDayGameIds(date);
  if (!ids.length) return [];
  // Aday: buyuk turnuva ya da ulkesi olmayan (uluslararasi) turnuva maci; milli
  // maclar ikincilerin icinde. Yerel liglerin takimlarini hic sormayiz.
  const games = (await fetchGames(ids)).filter(
    (g) =>
      FEATURED_COMPETITIONS.has(g.baseDetails?.competitionId) ||
      !g.baseDetails?.competition?.originDetails?.countryId,
  );
  const clubs = await fetchClubs(games.flatMap((g) => [g.homeClub?.clubId, g.awayClub?.clubId]).filter(Boolean));
  return games.filter((g) => isFeatured(g, clubs)).map((g) => toMatchDoc(g, clubs, date));
}
