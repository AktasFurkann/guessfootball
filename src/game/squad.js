/**
 * "Milli Kadro" modu - uygun ulke secimi ve bir oyuncunun milli maç sayisi.
 *
 * Dizilis: 1 Kaleci, 2 Defans, 2 Orta Saha, 1 Forvet (toplam 6). Bir ulke ancak
 * her mevkide yeterli senior milli oyuncuya sahipse secilebilir.
 */
import { getIndex, getFlag } from './searchIndex.js';

// Dizilis: her mevkiden kac slot.
export const FORMATION = [
  { pos: 'Kaleci', short: 'KL' },
  { pos: 'Defans', short: 'DEF' },
  { pos: 'Defans', short: 'DEF' },
  { pos: 'Orta Saha', short: 'ORT' },
  { pos: 'Orta Saha', short: 'ORT' },
  { pos: 'Forvet', short: 'FOR' },
];

// Uygun ulke: her mevkide en az 1 senior milli oyuncu (her ulke bir tur
// kullanildigi icin mevki basina 1 yeterli).
const NEED = { Kaleci: 1, Defans: 1, 'Orta Saha': 1, Forvet: 1 };

// Rastgele ulke yalnizca bu buyuk milli takimlardan secilir (FIFA/Dunya Kupasi
// olceginde ~48 ulke). Isimler veritabanindaki milli takim adlariyla birebir.
const TOP_COUNTRIES = new Set([
  'Arjantin', 'Brezilya', 'Fransa', 'İngiltere', 'İspanya', 'Portekiz', 'Hollanda',
  'Belçika', 'İtalya', 'Almanya', 'Hırvatistan', 'Uruguay', 'Kolombiya', 'Fas',
  'Meksika', 'Amerika Birleşik Devletleri', 'Senegal', 'Japonya', 'İran', 'Güney Kore',
  'Avustralya', 'İsviçre', 'Danimarka', 'Polonya', 'Galler', 'Sırbistan', 'Ekvador',
  'Kanada', 'Katar', 'Suudi Arabistan', 'Tunus', 'Gana', 'Kamerun', 'Nijerya',
  'Cezayir', 'Mısır', 'İsveç', 'Norveç', 'Türkiye', 'Ukrayna', 'Çekya', 'Avusturya',
  'Macaristan', 'Şili', 'Peru', 'Paraguay', 'Kosta Rika', 'Yunanistan',
]);

let eligible = null; // [{ country, flag }]

async function buildEligible() {
  const idx = await getIndex();
  const byCountry = new Map(); // country -> {Kaleci:n, Defans:n, ...}

  for (const p of idx) {
    if (!p.nt?.country || !p.slot) continue;
    if (!(p.slot in NEED)) continue;
    let c = byCountry.get(p.nt.country);
    if (!c) byCountry.set(p.nt.country, (c = { Kaleci: 0, Defans: 0, 'Orta Saha': 0, Forvet: 0 }));
    c[p.slot] += 1;
  }

  const list = [];
  for (const [country, counts] of byCountry) {
    if (!TOP_COUNTRIES.has(country)) continue; // yalnizca buyuk milli takimlar
    if (Object.entries(NEED).every(([cat, n]) => counts[cat] >= n)) {
      const flag = await getFlag(country);
      list.push({ country, flag });
    }
  }
  return list;
}

let buildingEligible = null;
async function ensureEligible() {
  if (eligible) return eligible;
  // Tek seferde kur (eszamanli cagrilarin diziyi ikiye katlamasini onle).
  if (!buildingEligible) buildingEligible = buildEligible();
  eligible = await buildingEligible;
  return eligible;
}

/** Rastgele uygun ulke (bayragiyla). */
export async function randomCountry() {
  const list = await ensureEligible();
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** Uygun tum ulkeler (bayrak "cark" animasyonu icin). */
export async function listCountries() {
  return ensureEligible();
}

/** Bir oyuncunun BELIRLI ulkedeki senior milli maç sayisi. */
export async function nationalCaps(playerDoc, country) {
  const cand = (playerDoc.careerByClub || []).find(
    (c) => c.isNationalTeam && c.name === country,
  );
  return cand?.games ?? 0;
}
