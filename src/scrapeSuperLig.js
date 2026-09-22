/**
 * Tum zamanlar Super Lig oyuncularini ceker (gece boyu calisir).
 *
 * Her sezon icin lig tablosundan kulupleri, her kulubun o sezonki kadrosundan
 * oyuncularis toplar; DB'de olmayanlari verimli sekilde (profil toplu + maç maç
 * performans) cekip dogrudan Atlas'a yazar. Resumable: DB'de olanlar atlanir.
 *
 * Kullanim:
 *   node src/scrapeSuperLig.js                 1959..2025
 *   node src/scrapeSuperLig.js --from=1990     baslangic yili
 *   node src/scrapeSuperLig.js --collect-only  sadece ID topla (data/superlig_ids.json)
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { connect, players, teams, close } from './db.js';
import { request, requestText, fetchEntities } from './transfermarkt/client.js';
import { attributesUrl, performanceGameUrl } from './transfermarkt/endpoints.js';
import {
  buildLookups,
  aggregatePerformance,
  toTeamDocument,
  toPlayerDocument,
} from './transfermarkt/transform.js';

const SITE = 'https://www.transfermarkt.com.tr';
const BATCH = 100;
const IDS_FILE = 'data/superlig_ids.json';

const tableUrl = (year) => `${SITE}/super-lig/tabelle/wettbewerb/TR1/saison_id/${year}`;
const kaderUrl = (clubId, year) => `${SITE}/x/kader/verein/${clubId}/saison_id/${year}/plus/1`;

function parseArgs(argv) {
  const o = { from: 1959, to: new Date().getFullYear(), collectOnly: false };
  for (const a of argv) {
    if (a === '--collect-only') o.collectOnly = true;
    else if (a.startsWith('--from=')) o.from = Number(a.split('=')[1]);
    else if (a.startsWith('--to=')) o.to = Number(a.split('=')[1]);
  }
  return o;
}

const uniqNums = (html, re) => [...new Set([...html.matchAll(re)].map((m) => Number(m[1])))];

/** Bir sezonun kuluplerini (lig tablosundan) dondurur. */
async function seasonClubs(year) {
  const html = await requestText(tableUrl(year), { label: `tablo ${year}` });
  // Tablo sayfasindaki kulup linkleri: /verein/{id}  (baslik + satirlar)
  return uniqNums(html, /\/verein\/(\d+)/g);
}

/** Bir kulubun o sezonki kadro oyuncu ID'leri. */
async function clubSquad(clubId, year) {
  const html = await requestText(kaderUrl(clubId, year), { label: `kadro ${clubId}/${year}` });
  return uniqNums(html, /profil\/spieler\/(\d+)/g);
}

async function collectIds(from, to) {
  const ids = new Set();
  for (let year = to; year >= from; year -= 1) {
    let clubs;
    try {
      clubs = await seasonClubs(year);
    } catch (e) {
      console.warn(`! ${year} tablo atlandı: ${e.message}`);
      continue;
    }
    if (!clubs.length) continue;
    let before = ids.size;
    for (const clubId of clubs) {
      try {
        (await clubSquad(clubId, year)).forEach((pid) => ids.add(pid));
      } catch (e) {
        console.warn(`  ! kadro ${clubId}/${year}: ${e.message}`);
      }
    }
    console.log(`[topla] ${year}: ${clubs.length} kulüp, +${ids.size - before} (toplam ${ids.size})`);
    // Ara kayit (resume icin).
    await mkdir('data', { recursive: true });
    await writeFile(IDS_FILE, JSON.stringify([...ids]), 'utf8');
  }
  return [...ids];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`[superlig] Sezonlar ${opts.from}..${opts.to} taranıyor...`);

  // Onceki toplama varsa ustune ekle (resume).
  let collected = [];
  try {
    collected = JSON.parse(await readFile(IDS_FILE, 'utf8'));
  } catch {
    /* yok */
  }
  const fresh = await collectIds(opts.from, opts.to);
  collected = [...new Set([...collected, ...fresh])];
  await writeFile(IDS_FILE, JSON.stringify(collected), 'utf8');
  console.log(`[superlig] Toplam benzersiz oyuncu ID: ${collected.length}`);

  if (opts.collectOnly) return;

  await connect();

  // DB'de olanlari atla.
  const existing = new Set(
    (await players().find({}, { projection: { _id: 1 } }).toArray()).map((p) => p._id),
  );
  const targets = collected.filter((id) => !existing.has(id));
  console.log(`[superlig] DB'de var: ${existing.size} · Çekilecek yeni: ${targets.length}`);

  const attributes = await request(attributesUrl(), { label: 'attributes' });
  const lookups = buildLookups(attributes?.data);

  let done = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH);
    const profiles = await fetchEntities('players', chunk);
    const profileById = new Map(profiles.map((p) => [Number(p.id), p]));

    const items = [];
    const clubIds = new Set();
    for (const id of chunk) {
      const profile = profileById.get(id);
      if (!profile) {
        failed += 1;
        continue;
      }
      try {
        const perf = await request(performanceGameUrl(id), { label: `perf/${id}` });
        const aggregates = aggregatePerformance(perf?.data?.performance ?? []);
        if (!aggregates.careerByClub.length) {
          failed += 1;
          continue;
        }
        aggregates.careerByClub.forEach((c) => c.clubId && clubIds.add(String(c.clubId)));
        (profile.clubAssignments || []).forEach((a) => clubIds.add(String(a.clubId)));
        items.push({ profile, aggregates });
      } catch (e) {
        failed += 1;
      }
    }

    // Bu partinin kuluplerini coz.
    const clubs = await fetchEntities('clubs', [...clubIds]);
    const teamDocs = clubs.map((c) => toTeamDocument(c, lookups));
    const clubsById = new Map(teamDocs.map((t) => [t._id, t]));

    const docs = items
      .map((it) =>
        toPlayerDocument({
          profile: it.profile,
          aggregates: it.aggregates,
          transfers: [],
          marketValueHistory: [],
          clubsById,
          competitionsById: new Map(),
          lookups,
        }),
      )
      .filter((d) => d.careerByClub?.length);

    if (docs.length) {
      await players().bulkWrite(
        docs.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $set: d }, upsert: true } })),
        { ordered: false },
      );
    }
    if (teamDocs.length) {
      await teams().bulkWrite(
        teamDocs.map((t) => ({ updateOne: { filter: { _id: t._id }, update: { $set: t }, upsert: true } })),
        { ordered: false },
      );
    }
    done += docs.length;
    console.log(`[superlig] ${Math.min(i + BATCH, targets.length)}/${targets.length} · eklendi ${done} · atlanan ${failed}`);
  }

  console.log(`\n=== SUPER LIG ÖZET ===`);
  console.log(`Eklenen: ${done} · Başarısız/veri yok: ${failed}`);
  console.log(`Toplam oyuncu (Atlas): ${await players().countDocuments()}`);
  await close();
}

main().catch(async (e) => {
  console.error('[superlig] Ölümcül:', e);
  await close().catch(() => {});
  process.exitCode = 1;
});
