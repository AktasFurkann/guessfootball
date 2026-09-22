import { Router } from 'express';
import { players } from '../db.js';
import { pickRandomGamePlayer, poolFilter } from '../game/roundData.js';
import { COMPARE_ROWS, compareValues } from '../game/compare.js';
import { FORMATION, randomCountry, nationalCaps } from '../game/squad.js';

export const gameRouter = Router();

/**
 * "En Yakin Tahmin" - yerel (ayni ekran) mod icin rastgele oyuncu.
 * Cevaplar `answers` altinda acik gonderilir (yerel modda gizleme yok).
 * Online mod cevaplari sunucuda tutar (bkz. src/realtime.js).
 */
gameRouter.get('/random', async (req, res, next) => {
  try {
    const pool = ['famous', 'stars', 'all'].includes(req.query.pool) ? req.query.pool : 'famous';
    const player = await pickRandomGamePlayer({ pool });
    if (!player) {
      return res.status(404).json({
        error: 'Veritabaninda oyuncu yok. Once "npm run scrape" veya "npm run seed" calistir.',
      });
    }
    res.json(player);
  } catch (error) {
    next(error);
  }
});

/**
 * "Kariyer Kıyası" - rastgele ORTA oyuncu + kiyas degerleri.
 * Iki taraf baska oyuncular yazip bu degerlere yakinlik yarisir.
 */
gameRouter.get('/compare/random', async (req, res, next) => {
  try {
    const pool = ['famous', 'stars', 'all'].includes(req.query.pool) ? req.query.pool : 'famous';
    const [player] = await players()
      .aggregate([{ $match: poolFilter(pool) }, { $sample: { size: 1 } }])
      .toArray();
    if (!player) return res.status(404).json({ error: 'Oyuncu bulunamadı.' });

    res.json({
      id: player._id,
      name: player.name,
      portraitUrl: player.portraitUrl,
      rows: COMPARE_ROWS,
      values: compareValues(player),
    });
  } catch (error) {
    next(error);
  }
});

/** "Milli Kadro" - dizilis + rastgele ulke (bayragiyla). */
gameRouter.get('/squad/formation', (_req, res) => {
  res.json({ formation: FORMATION });
});

gameRouter.get('/squad/country', async (_req, res, next) => {
  try {
    const country = await randomCountry();
    if (!country) return res.status(404).json({ error: 'Uygun ülke bulunamadı.' });
    res.json(country);
  } catch (error) {
    next(error);
  }
});

/** Tahmin edilen oyuncunun BELIRLI ulkedeki milli maç sayisi. */
gameRouter.get('/squad/player/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const country = req.query.country;
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz ID.' });
    if (!country) return res.status(400).json({ error: 'country parametresi gerekli.' });
    const player = await players().findOne(
      { _id: id },
      { projection: { name: 1, portraitUrl: 1, 'position.category': 1, careerByClub: 1 } },
    );
    if (!player) return res.status(404).json({ error: 'Oyuncu bulunamadı.' });
    res.json({
      id: player._id,
      name: player.name,
      portraitUrl: player.portraitUrl,
      category: player.position?.category ?? null,
      caps: await nationalCaps(player, country),
    });
  } catch (error) {
    next(error);
  }
});

/** Tahmin edilen bir oyuncunun kiyas degerleri (isim secildikten sonra). */
gameRouter.get('/compare/player/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz ID.' });
    const player = await players().findOne(
      { _id: id },
      { projection: { name: 1, portraitUrl: 1, careerTotals: 1, careerByClub: 1, marketValue: 1, heightCm: 1, dateOfBirth: 1 } },
    );
    if (!player) return res.status(404).json({ error: 'Oyuncu bulunamadı.' });
    res.json({ id: player._id, name: player.name, values: compareValues(player) });
  } catch (error) {
    next(error);
  }
});
