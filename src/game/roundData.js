import { players } from '../db.js';
import { poolIds, isLegacyPool, thresholdFilter, randomPoolId } from './pool.js';
import { rowsFor, toRowsMeta, seniorNationalStats } from './rows.js';

/**
 * Esik bazli ("taninir oyuncu") havuz suzgeci. Veritabaninda 7000+ oyuncu var
 * ama cogu taninmiyor; oyunun keyifli olmasi icin varsayilan olarak zirve
 * piyasa degeri veya cok mac oynamis olma esigi uygulanir. Esik degerleri
 * pool.js'teki POOL_THRESHOLDS'te tek yerde tutulur.
 *
 * @param {'famous'|'stars'} pool
 */
export function poolFilter(pool = 'famous') {
  return thresholdFilter(pool === 'stars' ? 'stars' : 'famous');
}

/**
 * Eski (famous/stars) veya yeni (legends/superlig/big5/all) havuzlar için
 * MongoDB $match filtresi üretir. Havuz boş/bilinmezse null döner.
 */
export async function gamePoolFilter(pool = 'famous') {
  if (isLegacyPool(pool)) return poolFilter(pool);
  const ids = await poolIds(pool);
  return ids && ids.length ? { _id: { $in: ids } } : null;
}

/**
 * Havuzdan rastgele bir oyuncu dokumani. Anlamsal havuzlarda ID bellekte
 * secilir (bkz. randomPoolId); eski esik havuzlarinda $sample kullanilir.
 */
export async function pickPoolDoc(pool = 'famous') {
  if (isLegacyPool(pool)) {
    const [doc] = await players().aggregate([{ $match: poolFilter(pool) }, { $sample: { size: 1 } }]).toArray();
    return doc ?? null;
  }
  const id = await randomPoolId(pool);
  if (id == null) return null;
  return players().findOne({ _id: id });
}

/**
 * Oyun icin rastgele bir oyuncu secer ve satirlarin dogru degerlerini hazirlar.
 * Hem REST ucu (/api/game/random) hem online oda motoru bunu kullanir.
 *
 * @param {{pool?: 'famous'|'stars'|'legends'|'superlig'|'big5'|'trlegends'|'all'}} [options]
 * @returns {Promise<null | {id:number, name:string, portraitUrl:string, answers:object, rows:object[]}>}
 */
export async function pickRandomGamePlayer({ pool = 'famous' } = {}) {
  const player = await pickPoolDoc(pool);
  if (!player) return null;

  const birthYear = player.dateOfBirth ? Number(player.dateOfBirth.slice(0, 4)) : null;
  const national = seniorNationalStats(player);

  // Bos alanlar null; verisi olmayan ana satir yedek bir satirla degisir (rowsFor).
  const answers = {
    careerGoals: player.careerTotals?.goals ?? null,
    // Emeklilerde guncel deger 0 oldugu icin ulastigi ZIRVE deger kullanilir.
    marketValue: player.marketValue?.highest ?? null,
    clubCount: player.careerTotals?.clubs ?? null,
    heightCm: player.heightCm || null,
    birthYear,
    dateOfBirth: player.dateOfBirth ?? null,
    // yedek satirlar
    careerGames: player.careerTotals?.games ?? null,
    careerAssists: player.careerTotals?.assists ?? null,
    seasons: player.careerTotals?.seasons ?? null,
    ntCaps: national.caps,
    ntGoals: national.goals,
  };
  const rows = rowsFor(answers);

  return {
    id: player._id,
    name: player.name,
    portraitUrl: player.portraitUrl,
    answers,
    /** Bu oyuncuda oynanacak satirlarin ust bilgisi (sirasiyla). */
    rows: toRowsMeta(rows),
  };
}
