import { players } from '../db.js';
import { SUPERLIG_TEAM_IDS } from './superligTeams.js';
import { LEGENDS } from '../data/sources.js';
import { MORE_LEGENDS } from '../data/moreLegends.js';
import { normalize } from './matcher.js';

/**
 * "En Yakın Tahmin" ve "Kariyer Kıyası" için oyuncu havuzları.
 *
 * Kullanıcı oyuna başlarken dört havuz seçebilir:
 *  - legends : efsaneler (Türkiye dahil)
 *  - superlig: aktif Süper Lig + orada oynamış eski oyuncular
 *  - big5    : İngiltere, İtalya, Fransa, İspanya, Almanya'da oynamışlar
 *  - all     : yukarıdaki üç havuzun birleşimi
 *
 * Efsane tanımı veri setinde tek bir bayrak olmadığı için şu sezgiselle yapılır:
 *  - elle toplanan efsane isim listelerinde geçiyorsa, veya
 *  - kariyeri sona ermiş ve belirgin bir kariyer eşiğini aşmışsa.
 */

const BIG5_COUNTRIES = new Set(['İngiltere', 'İtalya', 'Fransa', 'İspanya', 'Almanya']);
const CAREER_END_MARKERS = new Set(['---', 'Kariyer sonu', 'Emekli', 'End of career', 'Karriereende']);

export const GAME_POOLS = new Set(['famous', 'stars', 'legends', 'superlig', 'big5', 'all']);

const LEGEND_NAMES = new Set([...LEGENDS, ...MORE_LEGENDS].map((name) => normalize(name)));

let cache = null;
let building = null;

async function build() {
  const docs = await players()
    .find(
      {},
      {
        projection: {
          name: 1,
          currentClub: 1,
          careerTotals: 1,
          careerByClub: 1,
          marketValue: 1,
        },
      },
    )
    .toArray();

  const legends = new Set();
  const superlig = new Set();
  const big5 = new Set();

  for (const doc of docs) {
    const rows = (doc.careerByClub || []).filter((row) => !row.isNationalTeam);
    const clubName = doc.currentClub?.name;
    const retired = !clubName || CAREER_END_MARKERS.has(clubName);
    const games = doc.careerTotals?.games ?? 0;
    const goals = doc.careerTotals?.goals ?? 0;
    const peak = doc.marketValue?.highest ?? 0;

    if (
      LEGEND_NAMES.has(normalize(doc.name)) ||
      (retired && (games >= 300 || goals >= 120 || peak >= 30_000_000))
    ) {
      legends.add(doc._id);
    }

    if (rows.some((row) => SUPERLIG_TEAM_IDS.has(String(row.clubId)))) {
      superlig.add(doc._id);
    }
    if (rows.some((row) => BIG5_COUNTRIES.has(row.countryName))) {
      big5.add(doc._id);
    }
  }

  const all = new Set([...legends, ...superlig, ...big5]);
  return { legends, superlig, big5, all };
}

export async function ensurePool() {
  if (cache) return cache;
  if (!building) building = build();
  cache = await building;
  return cache;
}

/** Bir havuzun oyuncu ID listesini döndürür; bilinmeyen havuzda null. */
export async function poolIds(pool) {
  const pools = await ensurePool();
  const ids = pools[pool];
  return ids ? [...ids] : null;
}

/** Eski (eşik bazlı) havuzlar dışında kalanlar yeni anlamsal havuzlardır. */
export function isLegacyPool(pool) {
  return pool === 'famous' || pool === 'stars';
}
