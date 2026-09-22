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

let eligible = null; // [{ country, flag }]

async function buildEligible() {
  const idx = await getIndex();
  const byCountry = new Map(); // country -> {Kaleci:n, Defans:n, ...}

  for (const p of idx) {
    if (!p.nt?.country || !p.cat) continue;
    if (!(p.cat in NEED)) continue;
    let c = byCountry.get(p.nt.country);
    if (!c) byCountry.set(p.nt.country, (c = { Kaleci: 0, Defans: 0, 'Orta Saha': 0, Forvet: 0 }));
    c[p.cat] += 1;
  }

  eligible = [];
  for (const [country, counts] of byCountry) {
    if (Object.entries(NEED).every(([cat, n]) => counts[cat] >= n)) {
      const flag = await getFlag(country);
      eligible.push({ country, flag });
    }
  }
  return eligible;
}

async function ensureEligible() {
  if (!eligible) eligible = await buildEligible();
  return eligible;
}

/** Rastgele uygun ulke (bayragiyla). */
export async function randomCountry() {
  const list = await ensureEligible();
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** Bir oyuncunun BELIRLI ulkedeki senior milli maç sayisi. */
export async function nationalCaps(playerDoc, country) {
  const cand = (playerDoc.careerByClub || []).find(
    (c) => c.isNationalTeam && c.name === country,
  );
  return cand?.games ?? 0;
}
