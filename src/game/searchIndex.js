/**
 * Oyuncu ismi otomatik tamamlama + milli takim indeksi (bellek ici).
 *
 * 7000+ oyuncuyu bir kez belleğe alir. Aksan/Türkçe harf farkını yok sayarak
 * hızlı eşleştirir; ayrıca "Milli Kadro" modu için her oyuncunun senior milli
 * takımını ve kaç maça çıktığını (caps) tutar.
 */
import { players, teams } from '../db.js';
import { normalize } from './matcher.js';
import { slotOf, orderOf } from './positions.js';
import { latestSuperligClub, isSuperligActive } from './superligTeams.js';

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
            'careerTotals.goals': 1,
            'marketValue.determined': 1,
            'careerByClub.name': 1,
            'careerByClub.clubId': 1,
            'careerByClub.games': 1,
            'careerByClub.lastDate': 1,
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
    const slClubRow = latestSuperligClub(d);
    return {
      id: d._id,
      name: d.name,
      position: d.position?.name ?? null,
      slot: slotOf(d.position?.name), // FOR/ORT/DEF/KL bolgesi
      order: orderOf(d.position?.name), // hucumdan defansa siralama
      club: d.currentClub?.name ?? null,
      country: d.nationalities?.[0] ?? null,
      games: d.careerTotals?.games ?? 0,
      goals: d.careerTotals?.goals ?? 0,
      nt: seniorNationalTeam(d),
      slClub: slClubRow ? String(slClubRow.clubId) : null,
      slActive: slClubRow ? isSuperligActive(d, slClubRow) : false,
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
 * @param {{limit?:number, country?:string, positions?:string[], team?:string}} [opts]
 *   country: sadece o milli takimda senior oynamislar; team: sadece o aktif
 *   Süper Lig kulübünde oynayanlar; positions: mevki kategorileri.
 */
export async function search(query, opts = {}) {
  const idx = await ensureIndex();
  const { limit = 8, country = null, positions = null, team = null } = opts;
  const q = normalize(query);
  if (!q && !country && !team) return [];

  const scored = [];
  for (const p of idx) {
    if (country && p.nt?.country !== country) continue;
    // Milli kadro modu: sadece o ulkeyle en az 1 maça çıkmış oyuncular.
    if (country && (p.nt?.caps ?? 0) < 1) continue;
    // Süper Lig Gol modu: sadece ilgili aktif kulüp oyuncuları.
    if (team && p.slClub !== team) continue;
    if (team && !p.slActive) continue;
    // positions = slot bolgeleri (FOR/ORT/DEF/KL); ozel esleme (slot) ile suz.
    if (positions && !positions.includes(p.slot)) continue;

    let rank = 0;
    if (q) {
      if (p.norm.startsWith(q) || p.words.some((w) => w.startsWith(q))) rank = 0;
      else if (p.norm.includes(q)) rank = 1;
      else continue;
    }
    scored.push({ rank, p });
  }

  if (country || team) {
    // Milli kadro / Süper Lig Gol: detayli mevki sirasina gore
    // (Santrafor -> ... -> Kaleci),
    // sonra alfabetik. Caps'e gore SIRALAMA YOK (kopya olmasin).
    scored.sort(
      (a, b) => a.rank - b.rank || a.p.order - b.p.order || a.p.norm.localeCompare(b.p.norm),
    );
  } else {
    // Normal arama: bilinirlik (mac sayisi) azalan.
    scored.sort((a, b) => a.rank - b.rank || b.p.games - a.p.games);
  }

  return scored.slice(0, limit).map(({ p }) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    club: p.club,
    country: p.country,
    caps: p.nt?.caps ?? 0,
    goals: p.goals ?? 0,
  }));
}

/** Anında çekilen bir oyuncuyu bellek içi indekse ekler/günceller. */
export function addDoc(doc) {
  if (!index) return; // indeks henuz kurulmadi; sonraki build zaten alir
  const norm = normalize(doc.name);
  const slClubRow = latestSuperligClub(doc);
  const ntCands = (doc.careerByClub || []).filter(
    (c) => c.isNationalTeam && !/\d/.test(c.name || '') && !/olim|olym/i.test(c.name || ''),
  );
  const best = ntCands.length ? ntCands.reduce((a, b) => ((b.games || 0) > (a.games || 0) ? b : a)) : null;
  const entry = {
    id: doc._id,
    name: doc.name,
    position: doc.position?.name ?? null,
    slot: slotOf(doc.position?.name),
    order: orderOf(doc.position?.name),
    club: doc.currentClub?.name ?? null,
    country: doc.nationalities?.[0] ?? null,
    games: doc.careerTotals?.games ?? 0,
    goals: doc.careerTotals?.goals ?? 0,
    nt: best ? { country: best.name, caps: best.games || 0 } : null,
    slClub: slClubRow ? String(slClubRow.clubId) : null,
    slActive: slClubRow ? isSuperligActive(doc, slClubRow) : false,
    norm,
    words: norm.split(' ').filter(Boolean),
  };
  const at = index.findIndex((p) => p.id === doc._id);
  if (at >= 0) index[at] = entry;
  else index.push(entry);
}

export function resetIndex() {
  index = null;
  flags = null;
  building = null;
}
