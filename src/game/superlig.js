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

// Diziliş: kaleci yok, 2-2-2 (forvet -> defans gösterim sırası frontend'de).
export const FORMATION = [
  { pos: 'Forvet', short: 'FOR' },
  { pos: 'Forvet', short: 'FOR' },
  { pos: 'Orta Saha', short: 'ORT' },
  { pos: 'Orta Saha', short: 'ORT' },
  { pos: 'Defans', short: 'DEF' },
  { pos: 'Defans', short: 'DEF' },
];

const NEED = { Forvet: 2, 'Orta Saha': 2, Defans: 2 };

let eligible = null; // [{ id, name, crestUrl }]
let crests = null; // Map(id -> crestUrl)

async function loadCrests() {
  if (crests) return crests;
  const docs = await teams()
    .find({ _id: { $in: [...SUPERLIG_TEAM_IDS] } }, { projection: { _id: 1, crestUrl: 1 } })
    .toArray();
  crests = new Map(docs.map((t) => [String(t._id), t.crestUrl ?? null]));
  return crests;
}

async function buildEligible() {
  const idx = await getIndex();
  const crestMap = await loadCrests();

  const byTeam = new Map(); // id -> {Forvet:n, Orta Saha:n, Defans:n}
  for (const p of idx) {
    if (!p.slClub || !p.slActive || !SUPERLIG_TEAM_IDS.has(p.slClub)) continue;
    if (!(p.slot in NEED)) continue;
    let counts = byTeam.get(p.slClub);
    if (!counts) byTeam.set(p.slClub, (counts = { Forvet: 0, 'Orta Saha': 0, Defans: 0 }));
    counts[p.slot] += 1;
  }

  const list = [];
  for (const t of SUPERLIG_TEAMS) {
    const counts = byTeam.get(t.id);
    if (!counts) continue;
    if (!Object.entries(NEED).every(([cat, n]) => counts[cat] >= n)) continue;
    list.push({ id: t.id, name: t.name, crestUrl: crestMap.get(t.id) ?? null });
  }
  return list;
}

let buildingEligible = null;
async function ensureEligible() {
  if (eligible) return eligible;
  if (!buildingEligible) buildingEligible = buildEligible();
  eligible = await buildingEligible;
  return eligible;
}

/** Rastgele uygun Süper Lig takımı (logosuyla). */
export async function randomSuperligTeam() {
  const list = await ensureEligible();
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** Uygun tüm Süper Lig takımları (logo "çark" animasyonu için). */
export async function listSuperligTeams() {
  return ensureEligible();
}

/** Bir oyuncunun kulüp kariyerindeki toplam gol sayısı. */
export function superligGoals(playerDoc) {
  return playerDoc?.careerTotals?.goals ?? 0;
}
