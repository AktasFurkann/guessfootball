/**
 * "Kariyer Kıyası" modu - satir tanimlari ve bir oyuncunun kiyas degerleri.
 *
 * Ortadaki oyuncunun her satirdaki degeri hedeftir; iki taraf BASKA oyuncular
 * yazar ve o oyuncunun ayni satirdaki degeri hedefe en yakin olan kazanir.
 */
import { seniorNationalStats } from './rows.js';

export const COMPARE_ROWS = [
  { key: 'clubGoals', label: 'KARİYER GOLÜ' },
  { key: 'ntGoals', label: 'MİLLİ GOL' },
  { key: 'marketValue', label: 'PİYASA DEĞERİ' },
  { key: 'heightCm', label: 'BOY' },
  { key: 'birthYear', label: 'DOĞUM YILI' },
];

/**
 * Ortadaki oyuncuda verisi olmayan satirin yerine gecen yedek satirlar
 * (2004 oncesi emeklilerde piyasa degeri, bazi oyuncularda boy/dogum yok).
 */
export const COMPARE_EXTRA_ROWS = [
  { key: 'careerGames', label: 'KARİYER MAÇI' },
  { key: 'ntCaps', label: 'MİLLİ MAÇ' },
  { key: 'careerAssists', label: 'KARİYER ASİSTİ' },
  { key: 'clubCount', label: 'KARİYER TAKIMI' },
];

/** Bir oyuncu dokumaninin kiyas degerlerini cikarir (null: o satir puanlanmaz). */
export function compareValues(doc) {
  const ntGoals = (doc.careerByClub || [])
    .filter((c) => c.isNationalTeam)
    .reduce((sum, c) => sum + (c.goals || 0), 0);

  return {
    clubGoals: doc.careerTotals?.goals ?? null,
    ntGoals,
    marketValue: doc.marketValue?.highest ?? null,
    heightCm: doc.heightCm || null,
    birthYear: doc.dateOfBirth ? Number(doc.dateOfBirth.slice(0, 4)) : null,
    // yedek satirlar
    careerGames: doc.careerTotals?.games ?? null,
    ntCaps: seniorNationalStats(doc).caps,
    careerAssists: doc.careerTotals?.assists ?? null,
    clubCount: doc.careerTotals?.clubs ?? null,
  };
}

/**
 * Ortadaki oyuncuya ozel satir listesi: hedef degeri olmayan satir, verisi
 * olan (pozitif) ilk kullanilmamis yedek satirla degistirilir.
 */
export function compareRowsFor(values) {
  const extras = COMPARE_EXTRA_ROWS.filter((row) => values[row.key] != null && values[row.key] > 0);
  return COMPARE_ROWS.map((row) => (values[row.key] != null ? row : extras.shift() ?? row));
}
