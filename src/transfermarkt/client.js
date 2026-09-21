import { config } from '../config.js';
import { entitiesUrl } from './endpoints.js';

/** Gercekci tarayici imzalari; her istekte biri rastgele secilir. */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
];

const ACCEPT_LANGUAGE =
  config.locale === 'en' ? 'en-US,en;q=0.9' : 'tr-TR,tr;q=0.9,en;q=0.8';

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
/** Tek URL'e sigacak ID sayisi; daha fazlasi URL uzunlugunu zorluyor. */
const ENTITY_CHUNK_SIZE = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Yapilandirilmis araliktan rastgele bekleme suresi (ms). */
function nextDelay() {
  const { delayMinMs, delayMaxMs } = config;
  const min = Math.min(delayMinMs, delayMaxMs);
  const max = Math.max(delayMinMs, delayMaxMs);
  return min + Math.random() * (max - min);
}

/** Ardisik iki istek arasinda daima bekle; Transfermarkt'a yuk bindirme. */
let lastRequestAt = 0;
async function throttle() {
  const wait = nextDelay() - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * Tek JSON istegi: gecikmeli, rastgele User-Agent'li, 429/5xx'te ustel geri
 * cekilmeli. 404 kalici kabul edilir ve tekrar denenmez.
 */
export async function request(url, { label = url } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await throttle();

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': pick(USER_AGENTS),
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': ACCEPT_LANGUAGE,
          Referer: 'https://www.transfermarkt.com.tr/',
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 404) {
        throw Object.assign(new Error(`404 bulunamadi: ${label}`), {
          permanent: true,
        });
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} - ${label}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (error.permanent || attempt === MAX_ATTEMPTS) break;

      const backoff = 2 ** attempt * 1000;
      console.warn(
        `  ! ${label} basarisiz (deneme ${attempt}/${MAX_ATTEMPTS}): ${error.message}. ` +
          `${backoff} ms sonra yeniden denenecek.`,
      );
      await sleep(backoff);
    }
  }

  throw lastError;
}

/**
 * Varlik uclarini chunk'layarak cagirir ve sonuclari tek dizide birlestirir.
 * @param {'players'|'clubs'|'competitions'} kind
 * @param {Array<string|number>} ids
 */
export async function fetchEntities(kind, ids) {
  const unique = [...new Set(ids.map(String))].filter(Boolean);
  const results = [];

  for (let i = 0; i < unique.length; i += ENTITY_CHUNK_SIZE) {
    const chunk = unique.slice(i, i + ENTITY_CHUNK_SIZE);
    const payload = await request(entitiesUrl(kind, chunk), {
      label: `${kind} (${chunk.length} kayit)`,
    });
    results.push(...(payload?.data ?? []));
  }

  return results;
}
