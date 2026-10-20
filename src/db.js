import { MongoClient } from 'mongodb';
import { config, COLLECTIONS } from './config.js';

let client;
let db;

/**
 * Surec omru boyunca tek bir MongoClient paylasir. Tekrarli cagrilarda
 * ayni baglantiyi dondurur, yeni baglanti acmaz.
 */
export async function connect() {
  if (db) return db;

  client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 15_000,
    retryWrites: true,
  });

  await client.connect();
  db = client.db(config.dbName);
  console.log(`[db] Baglandi -> ${config.dbName}`);

  // Indeksleri ARKA PLANDA olustur (baslangici bloklamaz). Buyuk veri setinde
  // (16k+ oyuncu) foreground indeks kurulumu M0'da dakikalar surup sunucunun
  // dinlemeye baslamasini geciktiriyordu. Indeks kurulana kadar sorgular
  // yavas calisir ama takilmaz.
  ensureIndexes(db).catch((err) => console.error('[db] Indeks kurulum hatasi:', err.message));

  return db;
}

/** Sorgu desenlerimize karsilik gelen indeksleri (idempotent) olusturur. */
async function ensureIndexes(database) {
  await Promise.all([
    database.collection(COLLECTIONS.players).createIndexes([
      { key: { name: 1 } },
      { key: { 'careerByClub.clubId': 1 } },
    ]),
    database.collection(COLLECTIONS.teams).createIndexes([
      { key: { name: 1 } },
      { key: { isNationalTeam: 1 } },
    ]),
    database.collection(COLLECTIONS.users).createIndexes([{ key: { usernameKey: 1 }, unique: true }]),
    database.collection(COLLECTIONS.sessions).createIndexes([
      { key: { userId: 1 } },
      // Suresi dolan oturumlari MongoDB kendisi siler.
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]),
    database.collection(COLLECTIONS.matches).createIndexes([{ key: { date: 1 } }, { key: { status: 1, kickoff: 1 } }]),
    database.collection(COLLECTIONS.predictions).createIndexes([
      { key: { userId: 1, matchId: 1 }, unique: true },
      { key: { matchId: 1, settled: 1 } },
      { key: { userId: 1, date: -1 } },
    ]),
    database.collection(COLLECTIONS.gameResults).createIndexes([{ key: { 'players.userId': 1, at: -1 } }]),
  ]);
  console.log('[db] Indeksler hazır.');
}

export function getDb() {
  if (!db) throw new Error('Veritabanina baglanilmadi. Once connect() cagir.');
  return db;
}

export const players = () => getDb().collection(COLLECTIONS.players);
export const teams = () => getDb().collection(COLLECTIONS.teams);
export const users = () => getDb().collection(COLLECTIONS.users);
export const sessions = () => getDb().collection(COLLECTIONS.sessions);
export const matches = () => getDb().collection(COLLECTIONS.matches);
export const predictions = () => getDb().collection(COLLECTIONS.predictions);
export const gameResults = () => getDb().collection(COLLECTIONS.gameResults);

export async function close() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}
