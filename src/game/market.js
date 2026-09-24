/**
 * "Bonservis Avı" modu - seçkin büyük takım seçimi ve en yüksek bonservis.
 *
 * Diziliş: 1 Kaleci, 2 Defans, 2 Orta Saha, 1 Forvet (toplam 6). Takım havuzu 4 büyükler
 * ve büyük liglerin seçkin kulüplerinden oluşur; yalnızca yeterli güncel
 * oyuncuya sahip takımlar seçilebilir.
 */
import { getIndex } from './searchIndex.js';
import { MARKET_TEAMS } from '../data/marketTeams.js';
import { LONG_FORMATION, LONG_NEED } from './positions.js';

export const FORMATION = [
  { pos: 'Kaleci', key: 'Kaleci', short: 'KL' },
  { pos: 'Defans', key: 'Defans', short: 'DEF' },
  { pos: 'Defans', key: 'Defans', short: 'DEF' },
  { pos: 'Orta Saha', key: 'Orta Saha', short: 'ORT' },
  { pos: 'Orta Saha', key: 'Orta Saha', short: 'ORT' },
  { pos: 'Forvet', key: 'Forvet', short: 'FOR' },
];

const NEED = { Kaleci: 1, Defans: 2, 'Orta Saha': 2, Forvet: 1 };

/** Oyun uzunluğuna göre dizilişi döndürür (kısa: 1-2-2-1, uzun: 1-4-4-2). */
export function getFormation(length = 'short') {
  return length === 'long' ? LONG_FORMATION : FORMATION;
}

const eligible = new Map(); // length -> [{ id, name, crestUrl }]
const buildingEligible = new Map();

function needFor(length) {
  return length === 'long'
    ? { need: LONG_NEED, pick: (p) => p.longSlot }
    : { need: NEED, pick: (p) => p.slot };
}

async function buildEligible(length) {
  const idx = await getIndex();
  const { need, pick } = needFor(length);
  const byTeam = new Map(); // id -> mevki sayıları

  for (const p of idx) {
    if (!p.marketClub || !p.marketActive) continue;
    const key = pick(p);
    if (!key || !(key in need)) continue;
    let counts = byTeam.get(p.marketClub);
    if (!counts) {
      counts = {};
      for (const k of Object.keys(need)) counts[k] = 0;
      byTeam.set(p.marketClub, counts);
    }
    counts[key] += 1;
  }

  const teamById = new Map(MARKET_TEAMS.map((t) => [t.id, t]));
  const list = [];
  for (const [id, counts] of byTeam) {
    if (!Object.entries(need).every(([cat, n]) => counts[cat] >= n)) continue;
    const t = teamById.get(id);
    if (t) list.push({ id: t.id, name: t.name, crestUrl: t.crestUrl });
  }
  return list;
}

async function ensureEligible(length = 'short') {
  if (eligible.has(length)) return eligible.get(length);
  if (!buildingEligible.has(length)) buildingEligible.set(length, buildEligible(length));
  const list = await buildingEligible.get(length);
  eligible.set(length, list);
  return list;
}

/** Rastgele uygun takım (logosuyla). */
export async function randomMarketTeam(length = 'short') {
  const list = await ensureEligible(length);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** Uygun tüm takımlar (logo "çark" animasyonu için). */
export async function listMarketTeams(length = 'short') {
  return ensureEligible(length);
}
