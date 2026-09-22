/**
 * Bir oyuncuyu (DB'de yoksa) anında Transfermarkt'tan çekip veritabanına ekler.
 * Kariyer Kıyası / arama, DB'de olmayan (emekli vb.) oyuncular seçildiğinde
 * kullanır. Sonuç DB'ye ve bellek içi arama indeksine yazılır; bir daha çekilmez.
 */
import { players, teams } from '../db.js';
import { request, fetchEntities } from '../transfermarkt/client.js';
import { attributesUrl, performanceGameUrl } from '../transfermarkt/endpoints.js';
import {
  buildLookups,
  aggregatePerformance,
  toTeamDocument,
  toPlayerDocument,
} from '../transfermarkt/transform.js';
import { addDoc } from './searchIndex.js';

let lookupsCache = null;
const inFlight = new Map(); // id -> Promise (ayni anda cift cekimi engelle)

async function getLookups() {
  if (lookupsCache) return lookupsCache;
  const attributes = await request(attributesUrl(), { label: 'attributes' });
  lookupsCache = buildLookups(attributes?.data);
  return lookupsCache;
}

async function scrapeOne(id) {
  const lookups = await getLookups();

  const [profile] = await fetchEntities('players', [id]);
  if (!profile) return null;

  const perf = await request(performanceGameUrl(id), { label: `perf/${id}` });
  const aggregates = aggregatePerformance(perf?.data?.performance ?? []);

  const clubIds = new Set();
  aggregates.careerByClub.forEach((c) => c.clubId && clubIds.add(String(c.clubId)));
  (profile.clubAssignments || []).forEach((a) => clubIds.add(String(a.clubId)));

  const clubs = await fetchEntities('clubs', [...clubIds]);
  const teamDocs = clubs.map((c) => toTeamDocument(c, lookups));
  const clubsById = new Map(teamDocs.map((t) => [t._id, t]));

  const doc = toPlayerDocument({
    profile,
    aggregates,
    transfers: [],
    marketValueHistory: [],
    clubsById,
    competitionsById: new Map(),
    lookups,
  });

  // Kariyer verisi yoksa oyuna uygun degil.
  if (!doc.careerByClub?.length) return null;

  await players().updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
  if (teamDocs.length) {
    await teams().bulkWrite(
      teamDocs.map((t) => ({ updateOne: { filter: { _id: t._id }, update: { $set: t }, upsert: true } })),
      { ordered: false },
    );
  }
  addDoc(doc);
  return doc;
}

/**
 * Oyuncuyu dondurur; DB'de yoksa cekip ekler. Ayni anda gelen istekleri
 * tek cekimde birlestirir.
 */
export async function ensurePlayer(id) {
  const existing = await players().findOne({ _id: id });
  if (existing) return existing;

  if (inFlight.has(id)) return inFlight.get(id);
  const p = scrapeOne(id).finally(() => inFlight.delete(id));
  inFlight.set(id, p);
  return p;
}
