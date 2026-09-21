import 'dotenv/config';

/** Zorunlu bir ortam degiskenini okur, yoksa acik bir hata firlatir. */
function required(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Eksik ortam degiskeni: ${key}. Proje kokundeki .env dosyasini kontrol et ` +
        '(ornek icin .env.example).',
    );
  }
  return value;
}

function int(key, fallback) {
  const parsed = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  mongoUri: required('MONGODB_URI'),
  dbName: process.env.DB_NAME || 'football_db',
  port: int('PORT', 3000),
  locale: process.env.TM_LOCALE === 'en' ? 'en' : 'tr',
  delayMinMs: int('TM_DELAY_MIN_MS', 1500),
  delayMaxMs: int('TM_DELAY_MAX_MS', 2000),
};

export const COLLECTIONS = {
  players: 'players',
  teams: 'teams',
};
