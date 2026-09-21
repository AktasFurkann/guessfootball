/**
 * Oyuncu ismi tahminlerini karsilastirir.
 *
 * Amac: oyuncu dogru futbolcuyu bildigi halde yaziminda ufak bir sapma oldugunda
 * ("mesi", "Ibrahimovic", "ozil") tahmini yanlis saymamak; ama farkli bir
 * futbolcuyu da dogru saymamak.
 */

/** Aksanli ve Turkce harfleri ASCII karsiliklarina indirger. */
const CHAR_MAP = {
  ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g',
  ç: 'c', Ç: 'c', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u',
};

/**
 * Karsilastirma icin metni sadelestirir: kucuk harf, aksansiz, noktalamasiz,
 * tek boslukla ayrilmis.
 */
export function normalize(value) {
  if (!value) return '';

  return String(value)
    .replace(/[ıİşŞğĞçÇöÖüÜ]/g, (char) => CHAR_MAP[char] ?? char)
    .toLowerCase()
    // Unicode ayristirmasi ile kalan aksanlari (é, ć, ñ...) temizle.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Iki metin arasindaki Levenshtein duzenleme mesafesi. */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1, // ekleme
        previous[j] + 1, // silme
        previous[j - 1] + cost, // degistirme
      );
    }
    previous = current;
  }

  return previous[b.length];
}

/** Uzunluga gore izin verilen yazim hatasi payi. */
function allowedDistance(length) {
  if (length <= 3) return 0;
  if (length <= 8) return 1;
  return 2;
}

/**
 * Oyuncunun kayitli isimleri: tam isim, kisa isim ve pasaport ismi.
 * Bunlara birebir uyan bir tahmin her zaman dogrudur.
 */
export function primaryNames(player) {
  return [player.name, player.shortName, player.fullName]
    .map(normalize)
    .filter(Boolean);
}

/**
 * Isimden turetilen kisaltmalar (soyad gibi). Kabul edilir, ancak bunlar
 * uzerinden kurulan eslesme baska bir futbolcunun asil ismine yenilir.
 */
export function derivedNames(player) {
  const derived = new Set();
  const parts = normalize(player.name).split(' ');

  if (parts.length > 1) {
    // "van dijk", "van der sar" gibi onekli soyadlari da kabul et.
    const prefixIndex = parts.findIndex((part) =>
      ['van', 'de', 'del', 'der', 'dos', 'da'].includes(part),
    );
    if (prefixIndex > 0) derived.add(parts.slice(prefixIndex).join(' '));

    const surname = parts[parts.length - 1];
    if (surname.length >= 4) derived.add(surname);
  }

  return [...derived];
}

/** Bir oyuncunun kabul edilebilir tum isim varyantlari. */
export function candidateNames(player) {
  return [...new Set([...primaryNames(player), ...derivedNames(player)])];
}

/**
 * Tahmini oyuncuyla karsilastirir.
 *
 * Yazim hatasi toleransi tek basina yetmez: "mesi" -> "messi" kabul edilmeli
 * ama "kante" -> "kane" edilmemeli; ikisi de 1 harf uzaklikta. Ayirt edici sey
 * tahminin baska bir futbolcunun ismi olmasidir. Iki kademeli koruma:
 *
 *  1. Tahmin baskasinin herhangi bir isim varyantiysa bulanik eslesme kapanir
 *     ("kante" -> Harry Kane reddedilir).
 *  2. Turetilmis soyada birebir uyan tahmin, baskasinin asil ismiyse reddedilir
 *     ("Ronaldo" -> Cristiano Ronaldo reddedilir, cunku Ronaldo bir futbolcunun
 *     kendi ismi; ama R9 icin ayni tahmin dogru kalir).
 *
 * @param {object} player Tahmin edilmeye calisilan oyuncu
 * @param {string} guess Kullanicinin tahmini
 * @param {{reserved?: Set<string>, reservedPrimary?: Set<string>}} [others]
 *   Diger oyuncularin isim varyantlari ve asil isimleri
 */
export function checkGuess(player, guess, others = {}) {
  const { reserved = new Set(), reservedPrimary = new Set() } = others;
  const normalizedGuess = normalize(guess);

  if (!normalizedGuess) {
    return { correct: false, normalizedGuess, distance: Infinity, matched: null };
  }

  const closest = (names) =>
    names.reduce(
      (best, candidate) => {
        const distance = levenshtein(normalizedGuess, candidate);
        return distance < best.distance ? { distance, matched: candidate } : best;
      },
      { distance: Infinity, matched: null },
    );

  const primary = closest(primaryNames(player));
  const derived = closest(derivedNames(player));
  const best = derived.distance < primary.distance ? derived : primary;

  const result = { normalizedGuess, distance: best.distance, matched: best.matched };

  // Asil isme birebir uyum: her zaman dogru.
  if (primary.distance === 0) return { ...result, correct: true, distance: 0 };

  // Soyada birebir uyum: baskasinin asil ismi degilse kabul.
  if (derived.distance === 0) {
    return { ...result, correct: !reservedPrimary.has(normalizedGuess), distance: 0 };
  }

  // Bulanik eslesme: tahmin baskasinin ismiyse yazim hatasi sayma.
  if (reserved.has(normalizedGuess)) return { ...result, correct: false };

  const tolerance = allowedDistance(
    Math.min(normalizedGuess.length, best.matched?.length ?? 0),
  );

  return { ...result, correct: best.distance <= tolerance };
}
