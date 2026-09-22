/**
 * "Kariyer Kıyası" modu - satir tanimlari ve bir oyuncunun kiyas degerleri.
 *
 * Ortadaki oyuncunun her satirdaki degeri hedeftir; iki taraf BASKA oyuncular
 * yazar ve o oyuncunun ayni satirdaki degeri hedefe en yakin olan kazanir.
 */

export const COMPARE_ROWS = [
  { key: 'clubGoals', label: 'KARİYER GOLÜ' },
  { key: 'ntGoals', label: 'MİLLİ GOL' },
  { key: 'marketValue', label: 'PİYASA DEĞERİ' },
  { key: 'heightCm', label: 'BOY' },
  { key: 'birthYear', label: 'DOĞUM YILI' },
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
  };
}
