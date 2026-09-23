import { Router } from 'express';
import { players } from '../db.js';
import { checkGuess, candidateNames, primaryNames, normalize } from '../game/matcher.js';
import { poolFilter } from '../game/roundData.js';
import { search as searchPlayers } from '../game/searchIndex.js';
import { liveSearch } from '../game/liveSearch.js';

export const playersRouter = Router();

/** Tahmin ekraninda gosterilmemesi gereken alanlar. */
const SECRET_FIELDS = ['name', 'shortName', 'fullName', 'portraitUrl', 'relativeUrl'];

/**
 * Tum oyuncularin isim varyantlari. Bulanik eslestirmenin baska bir
 * futbolcunun ismini yazim hatasi sanmasini engellemek icin kullanilir.
 * Veri seti kucuk ve nadiren degistigi icin bellekte tutulur.
 */
let reservedNamesCache = null;

async function getReservedNames() {
  if (reservedNamesCache) return reservedNamesCache;

  const all = await players()
    .find({}, { projection: { name: 1, shortName: 1, fullName: 1 } })
    .toArray();

  reservedNamesCache = new Map(
    all.map((player) => [
      player._id,
      { all: candidateNames(player), primary: primaryNames(player) },
    ]),
  );
  return reservedNamesCache;
}

/** Hedef oyuncu disindaki herkesin isim varyantlari ve asil isimleri. */
async function reservedNamesExcept(playerId) {
  const byPlayer = await getReservedNames();
  const reserved = new Set();
  const reservedPrimary = new Set();

  for (const [id, names] of byPlayer) {
    if (id === playerId) continue;
    for (const name of names.all) reserved.add(name);
    for (const name of names.primary) reservedPrimary.add(name);
  }

  return { reserved, reservedPrimary };
}

/** Oyuncunun kimligini ele vermeden kariyer verisini hazirlar. */
function maskPlayer(player, { difficulty }) {
  const masked = { ...player };
  for (const field of SECRET_FIELDS) delete masked[field];

  // Zor modda mevcut kulup ve forma numarasi da gizlenir; bunlar cok guclu ipucu.
  if (difficulty === 'hard') {
    delete masked.currentClub;
    delete masked.shirtNumber;
    delete masked.marketValue;
    delete masked.careerBySeason;
  }

  masked.id = player._id;
  delete masked._id;

  masked.hints = buildHints(player, difficulty);
  return masked;
}

/** Kademeli ipuclari: oyuncu sirayla acabilir. */
function buildHints(player, difficulty) {
  const hints = [
    player.nationalities?.length ? `Uyruk: ${player.nationalities.join(', ')}` : null,
    player.position?.name ? `Mevki: ${player.position.name}` : null,
    player.dateOfBirth ? `Dogum yili: ${player.dateOfBirth.slice(0, 4)}` : null,
    player.foot ? `Ayak: ${player.foot}` : null,
  ];

  if (difficulty !== 'hard' && player.currentClub?.name) {
    hints.push(`Son kulup: ${player.currentClub.name}`);
  }

  return hints.filter(Boolean);
}

/**
 * GET /api/players/random
 * Oyun icin rastgele bir oyuncunun gizlenmis kariyer verisi.
 * ?difficulty=easy|normal|hard
 */
playersRouter.get('/random', async (req, res, next) => {
  try {
    const difficulty = ['easy', 'normal', 'hard'].includes(req.query.difficulty)
      ? req.query.difficulty
      : 'normal';

    // Veritabaninda binlerce oyuncu var; oyunun keyifli olmasi icin taninir
    // havuzdan secilir. Kolay modda daha da bilindik (yildiz) oyuncular gelir.
    const filter = poolFilter(difficulty === 'easy' ? 'stars' : 'famous');

    const [player] = await players()
      .aggregate([{ $match: filter }, { $sample: { size: 1 } }])
      .toArray();

    if (!player) {
      return res.status(404).json({
        error: 'Veritabaninda oyuncu yok. Once "npm run scrape" calistir.',
      });
    }

    res.json({ difficulty, player: maskPlayer(player, { difficulty }) });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/players/check?id=...&guess=...
 * Tahmini dogrular; dogruysa oyuncunun tam verisini acar.
 */
playersRouter.get('/check', async (req, res, next) => {
  try {
    const id = Number(req.query.id);
    const guess = req.query.guess;

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Gecerli bir "id" parametresi gerekli.' });
    }
    if (typeof guess !== 'string' || !guess.trim()) {
      return res.status(400).json({ error: 'Bos olmayan bir "guess" parametresi gerekli.' });
    }

    const player = await players().findOne({ _id: id });
    if (!player) {
      return res.status(404).json({ error: `${id} ID'li oyuncu bulunamadi.` });
    }

    const others = await reservedNamesExcept(id);
    const result = checkGuess(player, guess, others);

    res.json({
      correct: result.correct,
      guess,
      normalizedGuess: result.normalizedGuess,
      distance: Number.isFinite(result.distance) ? result.distance : null,
      // Dogru bilindiginde kimlik acilir; yanlissa sizdirilmaz.
      player: result.correct
        ? { id: player._id, name: player.name, portraitUrl: player.portraitUrl }
        : undefined,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/players
 * Otomatik tamamlama icin hafif isim listesi. ?q= ile filtrelenir.
 */
playersRouter.get('/', async (req, res, next) => {
  try {
    const query = typeof req.query.q === 'string' ? normalize(req.query.q) : '';

    const all = await players()
      .find({}, { projection: { name: 1, position: 1, nationalities: 1 } })
      .sort({ name: 1 })
      .toArray();

    const filtered = query
      ? all.filter((player) => normalize(player.name).includes(query))
      : all;

    res.json({
      count: filtered.length,
      players: filtered.map((player) => ({
        id: player._id,
        name: player.name,
        position: player.position?.name ?? null,
        nationalities: player.nationalities ?? [],
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/players/search?q=...&limit=8
 * Isim otomatik tamamlama (kiyas modu icin). Bellek ici indeks; hizli.
 * ":id" rotasindan ONCE tanimli olmali (aksi halde "search" bir id sanilir).
 */
playersRouter.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    // Milli kadro modunda tum ulke oyuncularini gostermek icin daha yuksek tavan.
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 60);
    // Milli Kadro modu: ulke + mevki(ler) filtresi.
    const country = typeof req.query.country === 'string' && req.query.country ? req.query.country : null;
    const positions =
      typeof req.query.positions === 'string' && req.query.positions
        ? req.query.positions.split(',').map((s) => s.trim()).filter(Boolean)
        : null;
    // Süper Lig Gol modu: aktif kulüp filtresi.
    const team = typeof req.query.team === 'string' && req.query.team ? req.query.team : null;
    const results = await searchPlayers(q, { limit, country, positions, team });

    // Canlı fallback (yalnızca ülke filtresi yokken): DB sonucu az ise
    // Transfermarkt'tan da arayıp DB'de olmayan (emekli vb.) oyuncuları ekle.
    if (req.query.live === '1' && !country && !team && q.length >= 3 && results.length < limit) {
      const have = new Set(results.map((r) => r.id));
      const live = await liveSearch(q, limit);
      for (const r of live) {
        if (results.length >= limit) break;
        if (!have.has(r.id)) {
          results.push(r);
          have.add(r.id);
        }
      }
    }

    res.json({ query: q, results });
  } catch (error) {
    next(error);
  }
});

/** GET /api/players/:id - tam oyuncu dokumani (cozum/istatistik ekrani icin). */
playersRouter.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Gecersiz oyuncu ID.' });
    }

    const player = await players().findOne({ _id: id });
    if (!player) {
      return res.status(404).json({ error: `${id} ID'li oyuncu bulunamadi.` });
    }

    res.json(player);
  } catch (error) {
    next(error);
  }
});
