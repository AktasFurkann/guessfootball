/**
 * Canlı Transfermarkt arama (DB'de olmayan oyuncular için).
 *
 * schnellsuche ile isimden aday oyuncular bulur, tmapi ile profil bilgisini
 * (mevki, doğum yılı, uyruk) zenginleştirir. Otomatik tamamlamanın hızlı olması
 * için scraper'ın 1.5-2 sn throttle'ını KULLANMAZ; sonuçlar kısa süre cache'lenir.
 */
import { normalize } from './matcher.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SITE = 'https://www.transfermarkt.com.tr';
const TMAPI = 'https://tmapi.transfermarkt.technology';

const cache = new Map(); // normalizedQuery -> {at, results}
const TTL = 5 * 60 * 1000;

const decode = (s) =>
  String(s)
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'tr-TR,tr;q=0.9', Referer: `${SITE}/` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** schnellsuche HTML'inden {id, name} adaylarini cikarir (ilk N). */
function parseCandidates(html, limit) {
  const seen = new Set();
  const out = [];
  const rx = /title="([^"]+)"\s+href="\/[^"]*?\/profil\/spieler\/(\d+)"/g;
  let m;
  while ((m = rx.exec(html)) && out.length < limit) {
    const id = Number(m[2]);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: decode(m[1]) });
  }
  return out;
}

/**
 * Canlı arama: {id, name, position, country, isNew:true}[].
 * Hata olursa bos dizi doner (otomatik tamamlama DB sonuclariyla devam eder).
 */
export async function liveSearch(query, limit = 6) {
  const q = normalize(query);
  if (q.length < 3) return [];

  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < TTL) return hit.results;

  try {
    const html = await fetchText(`${SITE}/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(query)}`);
    const cands = parseCandidates(html, limit);
    if (!cands.length) {
      cache.set(q, { at: Date.now(), results: [] });
      return [];
    }

    // Profil zenginlestirme (tek tmapi cagrisi).
    let profiles = [];
    try {
      const idsParam = cands.map((c) => `ids%5B%5D=${c.id}`).join('&');
      profiles = (await fetchJson(`${TMAPI}/players?${idsParam}`)).data || [];
    } catch {
      profiles = [];
    }
    const byId = new Map(profiles.map((p) => [Number(p.id), p]));

    const results = cands.map((c) => {
      const p = byId.get(c.id);
      return {
        id: c.id,
        name: p?.name || c.name,
        position: p?.attributes?.position?.name || null,
        country: p?.birthPlaceDetails?.countryOfBirthId ? null : null, // isim yeterli
        birthYear: p?.lifeDates?.dateOfBirth ? Number(p.lifeDates.dateOfBirth.slice(0, 4)) : null,
        caps: 0,
        isNew: true,
      };
    });

    cache.set(q, { at: Date.now(), results });
    return results;
  } catch {
    return [];
  }
}
