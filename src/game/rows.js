/**
 * "En Yakin Tahmin" satir tanimlari - SUNUCU tarafi otorite kaynagi.
 *
 * Online modda dogru degeri ve kazanani sunucu hesaplar; bu yuzden satirlarin
 * degeri ve gosterim bicimi burada tanimlidir. (Yerel/ayni-ekran modu ayni
 * tanimlari public/app.js icinde aynen tutar.)
 *
 * value(answers) -> sayisal dogru deger (null: puanlanmaz)
 * format(v)      -> ekranda gosterim metni
 */
export const GAME_ROWS = [
  {
    key: 'careerGoals',
    label: 'KARİYER GOLÜ',
    hint: 'gol sayısı',
    value: (a) => a.careerGoals,
    format: (v) => `${v}`,
  },
  {
    key: 'marketValue',
    label: 'EN YÜKSEK DEĞER',
    hint: 'milyon € (zirve)',
    value: (a) => (a.marketValue == null ? null : a.marketValue / 1_000_000),
    format: (v) => `€${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')}M`,
  },
  {
    key: 'clubCount',
    label: 'KARİYER TAKIMI',
    hint: 'kaç takım?',
    value: (a) => a.clubCount,
    format: (v) => `${v} takım`,
  },
  {
    key: 'heightCm',
    label: 'BOY',
    hint: 'cm',
    value: (a) => a.heightCm,
    format: (v) => `${v} cm`,
  },
  {
    key: 'birthYear',
    label: 'DOĞUM TARİHİ',
    hint: 'yıl',
    value: (a) => a.birthYear,
    format: (v, a) => a.dateOfBirth || `${v}`,
  },
];

/**
 * Yedek satirlar. Transfermarkt'ta bazi oyuncularin piyasa degeri (2004 oncesi
 * emekliler), boyu ya da dogum tarihi hic yok; o satir "veri yok" diye bos
 * gecmesin diye oyuncuda verisi olan ilk yedek satirla degistirilir.
 * Sira onemlidir: en taninan istatistik once denenir.
 */
export const EXTRA_ROWS = [
  {
    key: 'careerGames',
    label: 'KARİYER MAÇI',
    hint: 'maç sayısı',
    value: (a) => a.careerGames,
    format: (v) => `${v} maç`,
  },
  {
    key: 'ntCaps',
    label: 'MİLLİ MAÇ',
    hint: 'maç sayısı',
    value: (a) => a.ntCaps,
    format: (v) => `${v} maç`,
  },
  {
    key: 'careerAssists',
    label: 'KARİYER ASİSTİ',
    hint: 'asist sayısı',
    value: (a) => a.careerAssists,
    format: (v) => `${v}`,
  },
  {
    key: 'seasons',
    label: 'KARİYER SEZONU',
    hint: 'kaç sezon?',
    value: (a) => a.seasons,
    format: (v) => `${v} sezon`,
  },
  {
    key: 'ntGoals',
    label: 'MİLLİ GOL',
    hint: 'gol sayısı',
    value: (a) => a.ntGoals,
    format: (v) => `${v}`,
  },
];

export const ROWS_BY_KEY = new Map([...GAME_ROWS, ...EXTRA_ROWS].map((row) => [row.key, row]));

/** Satirlarin istemciye gidecek guvenli ust bilgisi (cevap icermez). */
export const toRowsMeta = (rows) => rows.map(({ key, label, hint }) => ({ key, label, hint }));

/** Varsayilan satirlarin ust bilgisi. */
export const rowsMeta = toRowsMeta(GAME_ROWS);

/**
 * Bir yedek satir ancak degeri pozitifse kullanilir: "0 milli maç" teknik
 * olarak veri ama tahmin edilecek bir sey sunmaz.
 */
const usableExtra = (row, answers) => {
  const v = row.value(answers);
  return v != null && v > 0;
};

/**
 * Oyuncuya ozel satir listesi: verisi olmayan her ana satir, kullanilmamis
 * ve verisi olan ilk yedek satirla degistirilir. Uygun yedek kalmazsa ana
 * satir oldugu gibi kalir (o satir puanlanmaz).
 */
export function rowsFor(answers) {
  const extras = EXTRA_ROWS.filter((row) => usableExtra(row, answers));
  return GAME_ROWS.map((row) => (row.value(answers) != null ? row : extras.shift() ?? row));
}

/**
 * Senior milli takim maci/golu (U21, olimpiyat vb. haric). Birden fazla
 * senior milli takim kaydi varsa en cok maca cikilan alinir.
 */
export function seniorNationalStats(doc) {
  const rows = (doc.careerByClub || []).filter(
    (c) => c.isNationalTeam && !/\d/.test(c.name || '') && !/olim|olym/i.test(c.name || ''),
  );
  if (!rows.length) return { caps: null, goals: null };
  const best = rows.reduce((a, b) => ((b.games || 0) > (a.games || 0) ? b : a));
  return { caps: best.games ?? null, goals: best.goals ?? null };
}
