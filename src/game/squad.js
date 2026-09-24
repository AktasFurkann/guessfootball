/**
 * "Milli Kadro" modu - uygun ulke secimi ve bir oyuncunun milli maç sayisi.
 *
 * Dizilis: 1 Kaleci, 2 Defans, 2 Orta Saha, 1 Forvet (toplam 6). Bir ulke ancak
 * her mevkide yeterli senior milli oyuncuya sahipse secilebilir.
 */
import { getIndex, getFlag } from './searchIndex.js';
import { LONG_FORMATION, LONG_NEED } from './positions.js';

// Dizilis: her mevkiden kac slot.
export const FORMATION = [
  { pos: 'Kaleci', key: 'Kaleci', short: 'KL' },
  { pos: 'Defans', key: 'Defans', short: 'DEF' },
  { pos: 'Defans', key: 'Defans', short: 'DEF' },
  { pos: 'Orta Saha', key: 'Orta Saha', short: 'ORT' },
  { pos: 'Orta Saha', key: 'Orta Saha', short: 'ORT' },
  { pos: 'Forvet', key: 'Forvet', short: 'FOR' },
];

// Uygun ulke: her mevkide en az 1 senior milli oyuncu (her ulke bir tur
// kullanildigi icin mevki basina 1 yeterli).
const NEED = { Kaleci: 1, Defans: 1, 'Orta Saha': 1, Forvet: 1 };

/** Oyun uzunluğuna göre dizilişi döndürür (kısa: 1-2-2-1, uzun: 1-4-4-2). */
export function getFormation(length = 'short') {
  return length === 'long' ? LONG_FORMATION : FORMATION;
}

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

const eligible = new Map(); // length -> [{ country, flag }]
const buildingEligible = new Map();

function needFor(length) {
  return length === 'long'
    ? { need: LONG_NEED, pick: (p) => p.longSlot }
    : { need: NEED, pick: (p) => p.slot };
}

async function buildEligible(length) {
  const idx = await getIndex();
  const { need, pick } = needFor(length);
  const byCountry = new Map(); // country -> mevki sayıları

  for (const p of idx) {
    if (!p.nt?.country || !p.slot) continue;
    const key = pick(p);
    if (!key || !(key in need)) continue;
    let c = byCountry.get(p.nt.country);
    if (!c) {
      c = {};
      for (const k of Object.keys(need)) c[k] = 0;
      byCountry.set(p.nt.country, c);
    }
    c[key] += 1;
  }

  const list = [];
  for (const [country, counts] of byCountry) {
    if (!TOP_COUNTRIES.has(country)) continue; // yalnizca buyuk milli takimlar
    if (Object.entries(need).every(([cat, n]) => counts[cat] >= n)) {
      const flag = await getFlag(country);
      list.push({ country, flag });
    }
  }
  return list;
}

async function ensureEligible(length = 'short') {
  if (eligible.has(length)) return eligible.get(length);
  // Tek seferde kur (eszamanli cagrilarin diziyi ikiye katlamasini onle).
  if (!buildingEligible.has(length)) buildingEligible.set(length, buildEligible(length));
  const list = await buildingEligible.get(length);
  eligible.set(length, list);
  return list;
}

/** Rastgele uygun ulke (bayragiyla). */
export async function randomCountry(length = 'short') {
  const list = await ensureEligible(length);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** Uygun tum ulkeler (bayrak "cark" animasyonu icin). */
export async function listCountries(length = 'short') {
  return ensureEligible(length);
}

/** Bir oyuncunun BELIRLI ulkedeki senior milli maç sayisi. */
export async function nationalCaps(playerDoc, country) {
  const cand = (playerDoc.careerByClub || []).find(
    (c) => c.isNationalTeam && c.name === country,
  );
  return cand?.games ?? 0;
}
