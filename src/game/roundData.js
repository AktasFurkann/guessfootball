import { players } from '../db.js';
import { poolIds, isLegacyPool } from './pool.js';

/**
 * Oyuncu havuzu suzgeci. Veritabaninda 7000+ oyuncu var ama cogu taninmiyor;
 * oyunun keyifli olmasi icin varsayilan olarak "taninir" oyuncular secilir.
 * (Zirve piyasa degeri esigi veya cok mac oynamis olma; ikincisi eski/Turk
 * efsanelerini de yakalar.)
 *
 * @param {'famous'|'stars'|'all'} pool
 */
export function poolFilter(pool = 'famous') {
  if (pool === 'all') return {};
  if (pool === 'stars') {
    return { $or: [{ 'marketValue.highest': { $gte: 40_000_000 } }, { 'careerTotals.games': { $gte: 450 } }] };
  }
  return { $or: [{ 'marketValue.highest': { $gte: 20_000_000 } }, { 'careerTotals.games': { $gte: 350 } }] };
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
 * Oyun icin rastgele bir oyuncu secer ve satirlarin dogru degerlerini hazirlar.
 * Hem REST ucu (/api/game/random) hem online oda motoru bunu kullanir.
 *
 * @param {{pool?: 'famous'|'stars'|'all'}} [options]
 * @returns {Promise<null | {id:number, name:string, portraitUrl:string, answers:object}>}
 */
export async function pickRandomGamePlayer({ pool = 'famous' } = {}) {
  const filter = await gamePoolFilter(pool);
  if (!filter) return null;

  const [player] = await players().aggregate([{ $match: filter }, { $sample: { size: 1 } }]).toArray();

  if (!player) return null;

  const birthYear = player.dateOfBirth ? Number(player.dateOfBirth.slice(0, 4)) : null;

  return {
    id: player._id,
    name: player.name,
    portraitUrl: player.portraitUrl,
    // Bos alanlar null; ilgili satir puanlanmaz.
    answers: {
      careerGoals: player.careerTotals?.goals ?? null,
      // Emeklilerde guncel deger 0 oldugu icin ulastigi ZIRVE deger kullanilir.
      marketValue: player.marketValue?.highest ?? null,
      clubCount: player.careerTotals?.clubs ?? null,
      heightCm: player.heightCm || null,
      birthYear,
      dateOfBirth: player.dateOfBirth ?? null,
    },
  };
}
