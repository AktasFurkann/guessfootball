import { Router } from 'express';

/**
 * Görsel vekili.
 *
 * Transfermarkt portre/amblem adresleri hotlink korumasi yuzunden tarayicida
 * dogrudan yuklenmiyor; burada uygun Referer/User-Agent ile cekip ayni
 * origin'den sunuyoruz.
 *
 * Vekilin rastgele icerik tasiyan bir role donusmemesi icin: yalnizca https,
 * yalnizca izin verilen konaklar, yalnizca `image/*` yanitlar ve boyut siniri.
 *
 * Hiz: her upstream istegi ~0,5 sn suruyor ve ayni bayrak/portre tekrar tekrar
 * isteniyor (bayrak carki onlarca bayragi art arda gosterir). Bu yuzden cekilen
 * gorseller bellekte LRU onbellekte tutulur ve ayni adrese eszamanli gelen
 * istekler tek bir upstream istegine baglanir.
 */
export const imgRouter = Router();

const IMAGE_HOSTS = new Set(['img.a.transfermarkt.technology', 'tmssl.akamaized.net']);
const MAX_BYTES = 5 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Onbellegin toplam bayt siniri (ucretsiz barindirmanin bellegini zorlamasin). */
const CACHE_MAX_BYTES = 48 * 1024 * 1024;

/** href -> { contentType, body }. Map ekleme sirasini korudugu icin LRU olarak kullanilir. */
const cache = new Map();
let cacheBytes = 0;
/** href -> Promise<{contentType, body} | null> (devam eden upstream istekleri). */
const inflight = new Map();

/** İstenen adres izin verilen bir görsel adresiyse URL nesnesini, degilse null. */
function parseImageUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw ?? ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !IMAGE_HOSTS.has(parsed.hostname)) return null;
  return parsed;
}

function remember(href, entry) {
  if (cache.has(href)) return;
  cache.set(href, entry);
  cacheBytes += entry.body.length;
  // En eski (en az yakin zamanda kullanilan) kayitlari at.
  for (const [key, old] of cache) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    cache.delete(key);
    cacheBytes -= old.body.length;
  }
}

async function fetchUpstream(href) {
  const upstream = await fetch(href, {
    headers: { 'User-Agent': USER_AGENT, Referer: 'https://www.transfermarkt.com.tr/' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const contentType = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !contentType.startsWith('image/')) return null;

  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.length === 0 || body.length > MAX_BYTES) return null;
  return { contentType, body };
}

/** Görseli onbellekten ya da upstream'den getirir; alinamazsa null. */
async function loadImage(href) {
  const hit = cache.get(href);
  if (hit) {
    // LRU: kullanilan kaydi sona tasi.
    cache.delete(href);
    cache.set(href, hit);
    return hit;
  }
  let pending = inflight.get(href);
  if (!pending) {
    pending = fetchUpstream(href)
      .then((entry) => {
        if (entry) remember(href, entry);
        return entry;
      })
      .finally(() => inflight.delete(href));
    inflight.set(href, pending);
  }
  return pending;
}

/**
 * Görselleri arka planda onbellege alir (bayraklar, logolar, siradaki oyuncu).
 * Hatalar yutulur; amac yalnizca ilk gosterimi hizlandirmak.
 */
export async function prefetchImages(urls, { concurrency = 4 } = {}) {
  const queue = [...new Set(urls)].map(parseImageUrl).filter(Boolean);
  const worker = async () => {
    while (queue.length) {
      const parsed = queue.shift();
      await loadImage(parsed.href).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

imgRouter.get('/', async (req, res) => {
  const parsed = parseImageUrl(req.query.url);
  if (!parsed) return res.status(400).json({ error: 'Geçersiz görsel adresi.' });

  try {
    const entry = await loadImage(parsed.href);
    if (!entry) return res.status(502).end();

    res.setHeader('Content-Type', entry.contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Content-Length', entry.body.length);
    res.end(entry.body);
  } catch (error) {
    // Zaman asimi/ag hatasi: <img> etiketi icin sade bir 502 yeterli.
    console.warn('[img] Görsel alınamadı:', parsed.href, error.message);
    res.status(502).end();
  }
});
