/**
 * Oyuncu ismi otomatik tamamlama + milli takim indeksi (bellek ici).
 *
 * 7000+ oyuncuyu bir kez belleğe alir. Aksan/Türkçe harf farkını yok sayarak
 * hızlı eşleştirir; ayrıca "Milli Kadro" modu için her oyuncunun senior milli
 * takımını ve kaç maça çıktığını (caps) tutar.
 */
import { players, teams } from '../db.js';
import { normalize } from './matcher.js';

let index = null; // [{ id, name, norm, words, games, position, cat, club, country, nt }]
let flags = null; // Map(country -> flagUrl)
let building = null;

/** careerByClub'dan senior milli takimi (U/olimpiyat haric) ve caps'i cikarir. */
function seniorNationalTeam(doc) {
  const cands = (doc.careerByClub || []).filter(
    (c) => c.isNationalTeam && !/\d/.test(c.name || '') && !/olim|olym/i.test(c.name || ''),
  );
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => ((b.games || 0) > (a.games || 0) ? b : a));
  return { country: best.name, caps: best.games || 0 };
}

async function build() {
  const [docs, teamDocs] = await Promise.all([
    players()
      .find(
        {},
        {
          projection: {
            name: 1,
            'position.name': 1,
            'position.category': 1,
            'currentClub.name': 1,
            nationalities: 1,
            'careerTotals.games': 1,
            'careerByClub.name': 1,
            'careerByClub.games': 1,
            'careerByClub.isNationalTeam': 1,
          },
        },
      )
      .toArray(),
    teams().find({ isNationalTeam: true }, { projection: { name: 1, crestUrl: 1 } }).toArray(),
  ]);

  flags = new Map();
  for (const t of teamDocs) if (t.name && t.crestUrl) flags.set(t.name, t.crestUrl);

  index = docs.map((d) => {
    const norm = normalize(d.name);
    return {
      id: d._id,
      name: d.name,
      position: d.position?.name ?? null,
      cat: d.position?.category ?? null,
      club: d.currentClub?.name ?? null,
      country: d.nationalities?.[0] ?? null,
      games: d.careerTotals?.games ?? 0,
      nt: seniorNationalTeam(d),
      norm,
      words: norm.split(' ').filter(Boolean),
    };
  });
  return index;
}

export async function ensureIndex() {
  if (index) return index;
  if (!building) building = build();
  await building;
  return index;
}

/** Ham indeks (squad modulu icin). */
export async function getIndex() {
  await ensureIndex();
  return index;
}

export async function getFlag(country) {
  await ensureIndex();
  return flags.get(country) ?? null;
}

/**
 * Sorguya uyan oyuncular.
 * @param {string} query
 * @param {{limit?:number, country?:string, positions?:string[]}} [opts]
 *   country: sadece o milli takimda senior oynamislar; positions: mevki kategorileri.
 */
export async function search(query, opts = {}) {
  const idx = await ensureIndex();
  const { limit = 8, country = null, positions = null } = opts;
  const q = normalize(query);
  if (!q && !country) return [];

  const scored = [];
  for (const p of idx) {
    if (country && p.nt?.country !== country) continue;
    if (positions && !positions.includes(p.cat)) continue;

    let rank = 0;
    if (q) {
      if (p.norm.startsWith(q) || p.words.some((w) => w.startsWith(q))) rank = 0;
      else if (p.norm.includes(q)) rank = 1;
      else continue;
    }
    scored.push({ rank, p });
  }

  // Ulke modunda caps'e gore (en cok maca cikan once), yoksa bilinirlik (mac).
  const weight = (p) => (country ? p.nt?.caps ?? 0 : p.games);
  scored.sort((a, b) => a.rank - b.rank || weight(b.p) - weight(a.p));

  return scored.slice(0, limit).map(({ p }) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    club: p.club,
    country: p.country,
    caps: p.nt?.caps ?? 0,
  }));
}

export function resetIndex() {
  index = null;
  flags = null;
  building = null;
}
