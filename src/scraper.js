/**
 * Transfermarkt veri toplama betigi.
 *
 * Kullanim:
 *   npm run scrape                      tum oyuncular
 *   npm run scrape -- --limit=3         ilk 3 oyuncu (hizli duman testi)
 *   npm run scrape -- --only=28003,8198 belirli ID'ler
 *   npm run scrape -- --dry-run         veritabanina yazmaz, data/ altina JSON doker
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { PLAYER_IDS } from './data/playerIds.js';
import { request, fetchEntities } from './transfermarkt/client.js';
import {
  attributesUrl,
  performanceGameUrl,
  transferHistoryUrl,
  marketValueUrl,
} from './transfermarkt/endpoints.js';
import {
  buildLookups,
  aggregatePerformance,
  mapTransfers,
  mapMarketValueHistory,
  toTeamDocument,
  toPlayerDocument,
} from './transfermarkt/transform.js';
import { connect, players, teams, close } from './db.js';

function parseArgs(argv) {
  const options = { limit: null, only: null, dryRun: false };

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.split('=')[1]);
    else if (arg.startsWith('--only=')) {
      options.only = new Set(
        arg
          .split('=')[1]
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      );
    }
  }

  return options;
}

function selectPlayers({ limit, only }) {
  let list = PLAYER_IDS;
  if (only) list = list.filter((player) => only.has(String(player.id)));
  if (limit) list = list.slice(0, limit);
  return list;
}

/**
 * Bir oyuncu icin ucuncu uclari sirayla cagirir. Transfer ve piyasa degeri
 * verisi kritik degildir; alinamazsa bos birakilir ve toplama durmaz.
 */
async function fetchPlayerData(playerId) {
  const performance = await request(performanceGameUrl(playerId), {
    label: `performance-game/${playerId}`,
  });

  const optional = async (url, label) => {
    try {
      return await request(url, { label });
    } catch (error) {
      console.warn(`  ! ${label} atlandi: ${error.message}`);
      return null;
    }
  };

  const transfers = await optional(transferHistoryUrl(playerId), `transfers/${playerId}`);
  const marketValues = await optional(marketValueUrl(playerId), `marketValue/${playerId}`);

  return { performance: performance?.data ?? {}, transfers, marketValues };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const roster = selectPlayers(options);

  if (roster.length === 0) {
    console.error('Secilen filtreye uyan oyuncu yok.');
    process.exitCode = 1;
    return;
  }

  console.log(
    `[scraper] ${roster.length} oyuncu islenecek` +
      (options.dryRun ? ' (dry-run: veritabanina yazilmayacak)' : ''),
  );

  if (!options.dryRun) await connect();

  console.log('[scraper] Oznitelik sozlugu cekiliyor...');
  const attributes = await request(attributesUrl(), { label: 'attributes' });
  const lookups = buildLookups(attributes?.data);

  console.log('[scraper] Oyuncu profilleri cekiliyor...');
  const profiles = await fetchEntities(
    'players',
    roster.map((player) => player.id),
  );
  const profilesById = new Map(profiles.map((profile) => [String(profile.id), profile]));

  const collected = [];
  const allClubIds = new Set();
  const allCompetitionIds = new Set();
  const warnings = [];
  const failures = [];

  for (const [index, entry] of roster.entries()) {
    const position = `[${index + 1}/${roster.length}]`;
    const profile = profilesById.get(String(entry.id));

    if (!profile) {
      failures.push({ ...entry, reason: 'profil bulunamadi' });
      console.warn(`${position} ${entry.name} - profil bulunamadi, atlandi`);
      continue;
    }

    // ID kaymasi sessizce yanlis veri toplamasin diye isim dogrulamasi.
    if (profile.name && profile.name !== entry.name) {
      warnings.push(`ID ${entry.id}: beklenen "${entry.name}", gelen "${profile.name}"`);
    }

    try {
      const raw = await fetchPlayerData(entry.id);
      const aggregates = aggregatePerformance(raw.performance.performance ?? []);

      for (const row of aggregates.careerByClub) allClubIds.add(row.clubId);
      for (const row of aggregates.careerBySeason) {
        if (row.competitionId) allCompetitionIds.add(row.competitionId);
      }
      if (profile.clubAssignments) {
        for (const assignment of profile.clubAssignments) {
          allClubIds.add(String(assignment.clubId));
        }
      }

      collected.push({
        profile,
        aggregates,
        transfers: mapTransfers(raw.transfers),
        marketValueHistory: mapMarketValueHistory(raw.marketValues),
      });

      const totals = aggregates.careerByClub.reduce(
        (acc, row) => ({ games: acc.games + row.games, goals: acc.goals + row.goals }),
        { games: 0, goals: 0 },
      );
      console.log(
        `${position} ${profile.name} - ${totals.games} mac, ${totals.goals} gol, ` +
          `${aggregates.careerByClub.length} kulup`,
      );
    } catch (error) {
      failures.push({ ...entry, reason: error.message });
      console.error(`${position} ${entry.name} - HATA: ${error.message}`);
    }
  }

  console.log(`[scraper] ${allClubIds.size} kulup cozumleniyor...`);
  const clubs = await fetchEntities('clubs', [...allClubIds]);
  const teamDocs = clubs.map((club) => toTeamDocument(club, lookups));
  const clubsById = new Map(teamDocs.map((team) => [team._id, team]));

  console.log(`[scraper] ${allCompetitionIds.size} musabaka cozumleniyor...`);
  const competitions = await fetchEntities('competitions', [...allCompetitionIds]);
  const competitionsById = new Map(
    competitions.map((competition) => [String(competition.id), competition]),
  );

  const playerDocs = collected.map((item) =>
    toPlayerDocument({ ...item, clubsById, competitionsById, lookups }),
  );

  if (options.dryRun) {
    await mkdir('data', { recursive: true });
    await writeFile('data/players.json', JSON.stringify(playerDocs, null, 2), 'utf8');
    await writeFile('data/teams.json', JSON.stringify(teamDocs, null, 2), 'utf8');
    console.log('[scraper] dry-run: data/players.json ve data/teams.json yazildi');
  } else {
    await upsert(players(), playerDocs, 'players');
    await upsert(teams(), teamDocs, 'teams');
  }

  console.log('\n=== OZET ===');
  console.log(`Basarili oyuncu : ${playerDocs.length}`);
  console.log(`Takim           : ${teamDocs.length}`);
  console.log(`Basarisiz       : ${failures.length}`);
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.reason}`);
  console.log(`Uyari           : ${warnings.length}`);
  for (const warning of warnings) console.log(`  - ${warning}`);

  if (!options.dryRun) await close();
}

/** Dokumanlari _id uzerinden upsert eder (tekrar calistirma guvenli). */
async function upsert(collection, documents, label) {
  if (documents.length === 0) return;

  const result = await collection.bulkWrite(
    documents.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: doc },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  console.log(
    `[scraper] ${label}: ${result.upsertedCount} eklendi, ${result.modifiedCount} guncellendi`,
  );
}

main().catch(async (error) => {
  console.error('[scraper] Olumcul hata:', error);
  await close().catch(() => {});
  process.exitCode = 1;
});
