import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { connect, close, getDb } from './db.js';
import { playersRouter } from './routes/players.js';
import { teamsRouter } from './routes/teams.js';
import { gameRouter } from './routes/game.js';
import { attachRealtime } from './realtime.js';
import { ensureIndex } from './game/searchIndex.js';
import { listCountries } from './game/squad.js';
import { listSuperligTeams } from './game/superlig.js';
import { listMarketTeams } from './game/market.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Oyun arayuzu ayni origin'den sunulur (localhost API'sine sorunsuz erisir).
  app.use(express.static(publicDir));

  // Sade istek logu.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`);
    });
    next();
  });

  app.get('/health', async (_req, res) => {
    try {
      await getDb().command({ ping: 1 });
      res.json({ status: 'ok', db: 'up' });
    } catch (error) {
      res.status(503).json({ status: 'degraded', db: 'down', error: error.message });
    }
  });

  app.use('/api/players', playersRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/game', gameRouter);

  // API disindaki bilinmeyen yollarda tek sayfalik arayuzu dondur.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Bulunamadi: ${req.method} ${req.originalUrl}` });
  });
  app.use((_req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });

  // Merkezi hata yakalayici: ic detaylari istemciye sizdirmadan logla.
  app.use((error, _req, res, _next) => {
    console.error('[server] Beklenmeyen hata:', error);
    res.status(500).json({ error: 'Sunucu hatasi' });
  });

  return app;
}

// Tek bir oda/istekteki beklenmeyen hata tüm sunucuyu çökertmesin.
process.on('unhandledRejection', (err) => console.error('[server] unhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('[server] uncaughtException:', err));

async function start() {
  await connect();

  const app = createApp();
  const server = createServer(app);
  attachRealtime(server); // Socket.IO'yu ayni HTTP sunucusuna bagla

  // 0.0.0.0: bulut barindirmada disaridan erisim icin gerekli.
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[server] http://localhost:${config.port} uzerinde dinleniyor`);
  });

  // Arama indeksini ve ulke listesini ARKA PLANDA isit: ilk oyun (ozellikle
  // Milli Kadro) 16k+ oyuncunun indeksini beklemesin, hizli baslasin.
  const t0 = Date.now();
  ensureIndex()
    .then(() => listCountries())
    .then(() => listSuperligTeams())
    .then(() => listMarketTeams())
    .then(() => console.log(`[warm] Arama indeksi hazır (${Date.now() - t0}ms)`))
    .catch((err) => console.error('[warm] Isıtma hatası:', err.message));

  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} alindi, kapatiliyor...`);
    server.close(async () => {
      await close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Yalnizca dogrudan calistirildiginda dinlemeye basla; testler createApp'i
// kendi baglantisiyla import edebilsin.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  start().catch((error) => {
    console.error('[server] Baslatilamadi:', error.message);
    process.exit(1);
  });
}
