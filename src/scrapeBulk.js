/**
 * Genis (binlerce oyuncu) veri cekimi - devam ettirilebilir (resumable).
 *
 * data/ids.json (collectIds ile uretilir) icindeki tum oyuncularin verisini
 * ceker. Var olan data/players.json'i okuyup zaten cekilmis oyuncular atlar;
 * her partiden sonra diske yazar, boylece kesinti olsa bile kaldigi yerden
 * devam edebilir. Bulk modda transfer/piyasa-degeri gecmisi cekilmez (oyunlar
 * icin gereksiz, sureyi yariya indirir).
 *
 * Kullanim:
 *   node src/scrapeBulk.js                 data/ids.json'daki herkesi cek (resume)
 *   node src/scrapeBulk.js --limit=50      ilk 50 (duman testi)
 *   node src/scrapeBulk.js --full          transfer + piyasa gecmisini de cek
 *   node src/scrapeBulk.js --to-db         diske degil dogrudan MongoDB'ye yaz
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { request, fetchEntities } from './transfermarkt/client.js';
import { attributesUrl, performanceGameUrl, transferHistoryUrl, marketValueUrl } from './transfermarkt/endpoints.js';
import {
  buildLookups,
  aggregatePerformance,
  mapTransfers,
  mapMarketValueHistory,
  toTeamDocument,
  toPlayerDocument,
} from './transfermarkt/transform.js';

const PLAYERS_FILE = 'data/players.json';
const TEAMS_FILE = 'data/teams.json';
const FLUSH_EVERY = 100;

function parseArgs(argv) {
  const o = { limit: null, full: false, toDb: false };
  for (const a of argv) {
    if (a === '--full') o.full = true;
    else if (a === '--to-db') o.toDb = true;
    else if (a.startsWith('--limit=')) o.limit = Number(a.split('=')[1]);
  }
  return o;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const idList = await readJson('data/ids.json', null);
  if (!idList) {
    console.error('data/ids.json yok. Önce: node src/collectIds.js');
    process.exitCode = 1;
    return;
  }

  // Mevcut ilerlemeyi oku (resume).
  const existing = await readJson(PLAYERS_FILE, []);
  const byId = new Map(existing.map((p) => [p._id, p]));
  console.log(`[bulk] Hedef: ${idList.length} ID · Mevcut: ${byId.size} oyuncu (atlanacak)`);

  let targets = idList.map((x) => Number(x.id)).filter((id) => !byId.has(id));
  if (opts.limit) targets = targets.slice(0, opts.limit);
  console.log(`[bulk] Çekilecek: ${targets.length} yeni oyuncu` + (opts.full ? ' (tam)' : ' (hızlı)'));

  if (targets.length === 0) {
    console.log('[bulk] Yeni oyuncu yok; sadece takımlar yenilenecek.');
  }

  // Oznitelik sozlugu (bir kez).
  const attributes = await request(attributesUrl(), { label: 'attributes' });
  const lookups = buildLookups(attributes?.data);

  // Profilleri toplu cek (50'lik chunk).
  console.log('[bulk] Profiller çekiliyor...');
  const profiles = await fetchEntities('players', targets);
  const profileById = new Map(profiles.map((p) => [Number(p.id), p]));

  let done = 0;
  let failed = 0;
  const flush = async () => {
    await mkdir('data', { recursive: true });
    await writeFile(PLAYERS_FILE, JSON.stringify([...byId.values()], null, 2), 'utf8');
  };

  for (const [index, id] of targets.entries()) {
    const profile = profileById.get(id);
    if (!profile) {
      failed += 1;
      continue;
    }

    try {
      const perf = await request(performanceGameUrl(id), { label: `perf/${id}` });
      const aggregates = aggregatePerformance(perf?.data?.performance ?? []);

      let transfers = [];
      let marketValueHistory = [];
      if (opts.full) {
        const t = await request(transferHistoryUrl(id), { label: `tr/${id}` }).catch(() => null);
        const m = await request(marketValueUrl(id), { label: `mv/${id}` }).catch(() => null);
        transfers = mapTransfers(t);
        marketValueHistory = mapMarketValueHistory(m);
      }

      // Kulup/musabaka isimleri sonda toplu cozulecek; simdilik id'lerle kur.
      const doc = toPlayerDocument({
        profile,
        aggregates,
        transfers,
        marketValueHistory,
        clubsById: new Map(),
        competitionsById: new Map(),
        lookups,
      });
      byId.set(id, doc);
      done += 1;

      if ((index + 1) % 10 === 0 || index + 1 === targets.length) {
        console.log(`  [${index + 1}/${targets.length}] ${profile.name} (toplam ${byId.size})`);
      }
      if ((index + 1) % FLUSH_EVERY === 0) await flush();
    } catch (e) {
      failed += 1;
      console.warn(`  ! ${id} atlandı: ${e.message}`);
    }
  }

  await flush();

  // --- Kulup ve musabaka isimlerini/logolari tum dokumanlar icin coz ---
  console.log('[bulk] Takım ve müsabaka isimleri çözülüyor...');
  const clubIds = new Set();
  const compIds = new Set();
  for (const p of byId.values()) {
    (p.careerByClub || []).forEach((c) => c.clubId && clubIds.add(String(c.clubId)));
    if (p.currentClub?.id) clubIds.add(String(p.currentClub.id));
    (p.careerBySeason || []).forEach((s) => s.competitionId && compIds.add(String(s.competitionId)));
  }

  const clubs = await fetchEntities('clubs', [...clubIds]);
  const teamDocs = clubs.map((c) => toTeamDocument(c, lookups));
  const clubsById = new Map(teamDocs.map((t) => [t._id, t]));

  const competitions = await fetchEntities('competitions', [...compIds]);
  const compById = new Map(competitions.map((c) => [String(c.id), c]));

  // Dokumanlardaki kulup/musabaka isimlerini zenginlestir.
  for (const p of byId.values()) {
    (p.careerByClub || []).forEach((row) => {
      const club = clubsById.get(String(row.clubId));
      if (club) {
        row.name = club.name;
        row.crestUrl = club.crestUrl;
        row.countryName = club.countryName;
        row.isNationalTeam = club.isNationalTeam;
      }
    });
    (p.careerBySeason || []).forEach((row) => {
      row.competitionName = compById.get(String(row.competitionId))?.name ?? row.competitionId;
      row.clubName = clubsById.get(String(row.clubId))?.name ?? row.clubName ?? null;
    });
    if (p.currentClub?.id) {
      const club = clubsById.get(String(p.currentClub.id));
      if (club) p.currentClub = { id: club._id, name: club.name, crestUrl: club.crestUrl };
    }
  }

  await flush();
  await mkdir('data', { recursive: true });
  await writeFile(TEAMS_FILE, JSON.stringify(teamDocs, null, 2), 'utf8');

  console.log('\n=== BULK ÖZET ===');
  console.log(`Toplam oyuncu (dosyada): ${byId.size}`);
  console.log(`Bu çalışmada eklenen   : ${done}`);
  console.log(`Başarısız              : ${failed}`);
  console.log(`Takım                  : ${teamDocs.length}`);

  if (opts.toDb) {
    console.log('[bulk] MongoDB’ye yazılıyor...');
    const { connect, players, teams, close } = await import('./db.js');
    await connect();
    await bulkUpsert(players(), [...byId.values()]);
    await bulkUpsert(teams(), teamDocs);
    await close();
    console.log('[bulk] DB güncellendi.');
  } else {
    console.log(`[bulk] Diske yazıldı: ${PLAYERS_FILE}, ${TEAMS_FILE}. DB için: npm run seed`);
  }
}

async function bulkUpsert(collection, docs) {
  const CHUNK = 500;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const slice = docs.slice(i, i + CHUNK);
    await collection.bulkWrite(
      slice.map((doc) => ({ updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true } })),
      { ordered: false },
    );
  }
}

main().catch((e) => {
  console.error('[bulk] Ölümcül hata:', e);
  process.exitCode = 1;
});
