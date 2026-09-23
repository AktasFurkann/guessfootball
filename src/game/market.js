/**
 * "Bonservis Avı" modu - seçkin büyük takım seçimi ve en yüksek bonservis.
 *
 * Diziliş: 2 Forvet, 2 Orta Saha, 2 Defans (toplam 6). Takım havuzu 4 büyükler
 * ve büyük liglerin seçkin kulüplerinden oluşur; yalnızca yeterli güncel
 * oyuncuya sahip takımlar seçilebilir.
 */
import { getIndex } from './searchIndex.js';
import { MARKET_TEAMS } from '../data/marketTeams.js';

export const FORMATION = [
  { pos: 'Forvet', short: 'FOR' },
  { pos: 'Forvet', short: 'FOR' },
  { pos: 'Orta Saha', short: 'ORT' },
  { pos: 'Orta Saha', short: 'ORT' },
  { pos: 'Defans', short: 'DEF' },
  { pos: 'Defans', short: 'DEF' },
];

const NEED = { Forvet: 2, 'Orta Saha': 2, Defans: 2 };

let eligible = null;
let buildingEligible = null;

async function buildEligible() {
  const idx = await getIndex();
  const byTeam = new Map(); // id -> {Forvet:n, Orta Saha:n, Defans:n}

  for (const p of idx) {
    if (!p.marketClub || !p.marketActive) continue;
    if (!(p.slot in NEED)) continue;
    let counts = byTeam.get(p.marketClub);
    if (!counts) byTeam.set(p.marketClub, (counts = { Forvet: 0, 'Orta Saha': 0, Defans: 0 }));
    counts[p.slot] += 1;
  }

  const teamById = new Map(MARKET_TEAMS.map((t) => [t.id, t]));
  const list = [];
  for (const [id, counts] of byTeam) {
    if (!Object.entries(NEED).every(([cat, n]) => counts[cat] >= n)) continue;
    const t = teamById.get(id);
    if (t) list.push({ id: t.id, name: t.name, crestUrl: t.crestUrl });
  }
  return list;
}

async function ensureEligible() {
  if (eligible) return eligible;
  if (!buildingEligible) buildingEligible = buildEligible();
  eligible = await buildingEligible;
  return eligible;
}

/** Rastgele uygun takım (logosuyla). */
export async function randomMarketTeam() {
  const list = await ensureEligible();
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** Uygun tüm takımlar (logo "çark" animasyonu için). */
export async function listMarketTeams() {
  return ensureEligible();
}
