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
  await ensureIndexes(db);

  console.log(`[db] Baglandi -> ${config.dbName}`);
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
  ]);
}

export function getDb() {
  if (!db) throw new Error('Veritabanina baglanilmadi. Once connect() cagir.');
  return db;
}

export const players = () => getDb().collection(COLLECTIONS.players);
export const teams = () => getDb().collection(COLLECTIONS.teams);

export async function close() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}
