/**
 * Oyuncu ismi otomatik tamamlama - bellek ici indeks.
 *
 * 7000+ oyuncu ismini bir kez belleğe alir; her tuş vuruşunda veritabanına
 * gitmeden, aksan/Türkçe harf farkını yok sayarak hızlı eşleştirir.
 */
import { players } from '../db.js';
import { normalize } from './matcher.js';

let index = null; // [{ id, name, norm, words, games }]
let building = null;

async function build() {
  const docs = await players()
    .find({}, { projection: { name: 1, position: 1, 'currentClub.name': 1, 'careerTotals.games': 1 } })
    .toArray();

  index = docs.map((d) => {
    const norm = normalize(d.name);
    return {
      id: d._id,
      name: d.name,
      position: d.position?.name ?? null,
      club: d.currentClub?.name ?? null,
      norm,
      words: norm.split(' ').filter(Boolean),
      games: d.careerTotals?.games ?? 0,
    };
  });
  return index;
}

/** Indeksi (bir kez) hazirlar. connect() sonrasi cagrilabilir. */
export async function ensureIndex() {
  if (index) return index;
  if (!building) building = build();
  return building;
}

/**
 * Sorguya uyan oyuncular. Kelime basi eslesmesi oncelikli; sonra icerik.
 * "kan" -> Kane, Kanté... gibi. Bilinirlik (mac sayisi) sirasina gore.
 */
export async function search(query, limit = 8) {
  const idx = await ensureIndex();
  const q = normalize(query);
  if (!q) return [];

  const scored = [];
  for (const p of idx) {
    let rank;
    // On-ek eslesmesi (tam isim VEYA herhangi bir kelime) tek kademe: boylece
    // "kan" -> unlu Harry Kane, obscure "Kandet"in onune (mac sayisiyla) gecer.
    if (p.norm.startsWith(q) || p.words.some((w) => w.startsWith(q))) rank = 0;
    else if (p.norm.includes(q)) rank = 1; // icerik (ortada gecen)
    else continue;
    scored.push({ rank, p });
  }

  // Once on-ek/icerik kademesi, sonra bilinirlik (mac sayisi) azalan.
  scored.sort((a, b) => a.rank - b.rank || b.p.games - a.p.games);
  return scored.slice(0, limit).map(({ p }) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    club: p.club,
  }));
}

/** Veritabani degisince indeksi tazele (ornegin yeni seed sonrasi). */
export function resetIndex() {
  index = null;
  building = null;
}
