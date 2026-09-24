/**
 * "Süper Lig Gol" modu - aktif Süper Lig takımı seçimi ve kariyer gol sayısı.
 *
 * Milli Kadro modunun Süper Lig uyarlamasıdır. Dizilişte kaleci yoktur; onun
 * yerine 2 Forvet, 2 Orta Saha, 2 Defans vardır (toplam 6). Bir takım ancak her
 * mevkide yeterli aktif Süper Lig oyuncusuna sahipse seçilebilir.
 */
import { getIndex } from './searchIndex.js';
import { teams } from '../db.js';
import { SUPERLIG_TEAMS, SUPERLIG_TEAM_IDS } from './superligTeams.js';
import { LONG_FORMATION, LONG_NEED } from './positions.js';

// Diziliş: kaleci yok, 2-2-2 (forvet -> defans gösterim sırası frontend'de).
export const FORMATION = [
  { pos: 'Forvet', key: 'Forvet', short: 'FOR' },
  { pos: 'Forvet', key: 'Forvet', short: 'FOR' },
  { pos: 'Orta Saha', key: 'Orta Saha', short: 'ORT' },
  { pos: 'Orta Saha', key: 'Orta Saha', short: 'ORT' },
  { pos: 'Defans', key: 'Defans', short: 'DEF' },
  { pos: 'Defans', key: 'Defans', short: 'DEF' },
];

const NEED = { Forvet: 2, 'Orta Saha': 2, Defans: 2 };

/** Oyun uzunluğuna göre dizilişi döndürür (kısa: 2-2-2, uzun: 1-4-4-2). */
export function getFormation(length = 'short') {
  return length === 'long' ? LONG_FORMATION : FORMATION;
}

const eligible = new Map(); // length -> [{ id, name, crestUrl }]
const buildingEligible = new Map();
let crests = null; // Map(id -> crestUrl)

function needFor(length) {
  return length === 'long'
    ? { need: LONG_NEED, pick: (p) => p.longSlot }
    : { need: NEED, pick: (p) => p.slot };
}

async function loadCrests() {
  if (crests) return crests;
  const docs = await teams()
    .find({ _id: { $in: [...SUPERLIG_TEAM_IDS] } }, { projection: { _id: 1, crestUrl: 1 } })
    .toArray();
  crests = new Map(docs.map((t) => [String(t._id), t.crestUrl ?? null]));
  return crests;
}

async function buildEligible(length) {
  const idx = await getIndex();
  const crestMap = await loadCrests();
  const { need, pick } = needFor(length);

  const byTeam = new Map(); // id -> mevki sayıları
  for (const p of idx) {
    if (!p.slClub || !p.slActive || !SUPERLIG_TEAM_IDS.has(p.slClub)) continue;
    const key = pick(p);
    if (!key || !(key in need)) continue;
    let counts = byTeam.get(p.slClub);
    if (!counts) {
      counts = {};
      for (const k of Object.keys(need)) counts[k] = 0;
      byTeam.set(p.slClub, counts);
    }
    counts[key] += 1;
  }

  const list = [];
  for (const t of SUPERLIG_TEAMS) {
    const counts = byTeam.get(t.id);
    if (!counts) continue;
    if (!Object.entries(need).every(([cat, n]) => counts[cat] >= n)) continue;
    list.push({ id: t.id, name: t.name, crestUrl: crestMap.get(t.id) ?? null });
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

/** Rastgele uygun Süper Lig takımı (logosuyla). */
export async function randomSuperligTeam(length = 'short') {
  const list = await ensureEligible(length);
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** Uygun tüm Süper Lig takımları (logo "çark" animasyonu için). */
export async function listSuperligTeams(length = 'short') {
  return ensureEligible(length);
}

/** Bir oyuncunun kulüp kariyerindeki toplam gol sayısı. */
export function superligGoals(playerDoc) {
  return playerDoc?.careerTotals?.goals ?? 0;
}
