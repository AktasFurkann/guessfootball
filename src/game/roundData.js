import { players } from '../db.js';

/**
 * Oyun icin rastgele bir oyuncu secer ve satirlarin dogru degerlerini hazirlar.
 * Hem REST ucu (/api/game/random) hem online oda motoru bunu kullanir.
 *
 * @returns {Promise<null | {id:number, name:string, portraitUrl:string, answers:object}>}
 */
export async function pickRandomGamePlayer() {
  const [player] = await players()
    .aggregate([{ $sample: { size: 1 } }])
    .toArray();

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
