/**
 * `--dry-run` ile uretilmis JSON dosyalarini MongoDB'ye yukler.
 *
 * Transfermarkt'a yeniden yuk bindirmeden veritabanini doldurmak icin kullanilir
 * (ornegin baglanti dizesi degistiginde veya veritabani sifirlandiginda).
 *
 * Kullanim: npm run seed
 */
import { readFile } from 'node:fs/promises';
import { connect, players, teams, close } from './db.js';

async function loadJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `${path} bulunamadi. Once "npm run scrape -- --dry-run" calistir.`,
      );
    }
    throw error;
  }
}

async function upsert(collection, documents, label) {
  if (!documents.length) {
    console.log(`[seed] ${label}: yuklenecek kayit yok`);
    return;
  }

  const result = await collection.bulkWrite(
    documents.map((doc) => ({
      updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true },
    })),
    { ordered: false },
  );

  console.log(
    `[seed] ${label}: ${result.upsertedCount} eklendi, ${result.modifiedCount} guncellendi`,
  );
}

async function main() {
  const [playerDocs, teamDocs] = await Promise.all([
    loadJson('data/players.json'),
    loadJson('data/teams.json'),
  ]);

  await connect();

  // JSON'dan okunan tarihler metin olur; Date'e geri cevir.
  for (const player of playerDocs) {
    if (player.scrapedAt) player.scrapedAt = new Date(player.scrapedAt);
  }

  await upsert(players(), playerDocs, 'players');
  await upsert(teams(), teamDocs, 'teams');

  console.log('[seed] Tamamlandi.');
  await close();
}

main().catch(async (error) => {
  console.error('[seed] Hata:', error.message);
  await close().catch(() => {});
  process.exitCode = 1;
});
