import { Router } from 'express';
import { pickRandomGamePlayer } from '../game/roundData.js';

export const gameRouter = Router();

/**
 * "En Yakin Tahmin" - yerel (ayni ekran) mod icin rastgele oyuncu.
 *
 * Isim tahmini modunun tersine oyuncunun kimligi aciktir; iki oyuncu
 * satirlardaki degerleri tahmin eder. Bu yuzden yanit gizlenmez; dogru
 * degerler `answers` altinda gonderilir. (Online mod cevaplari istemciye
 * gondermez; onlari sunucu tutar - bkz. src/realtime.js.)
 */
gameRouter.get('/random', async (_req, res, next) => {
  try {
    const player = await pickRandomGamePlayer();
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
