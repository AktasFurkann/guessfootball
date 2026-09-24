/**
 * Detayli mevki adini "saha bolgesine" (FOR/ORT/DEF/KL) esler ve oneri sirasini
 * belirler. Milli Kadro modunda slotlar bu esleme ile doldurulur.
 *
 * - Forvet bolgesi: Santrafor, Forvet Arkası
 * - Orta saha: On Numara (ofansif), Sağ/Sol Kanat, Merkez OS, Orta Saha Sağ/Sol,
 *   Ön Libero (defansif)
 * - Defans: Sağ/Sol Bek, Stoper, Libero
 * - Kaleci: Kaleci
 * (Transfermarkt Türkçe'sinde "Sağ/Sol Açık" yoktur; kanatlar orta sahaya girer.)
 */
export const POSITION_SLOT = {
  Santrafor: 'Forvet',
  'Forvet Arkası': 'Forvet',
  'On Numara': 'Orta Saha',
  'Sağ Kanat': 'Orta Saha',
  'Sol Kanat': 'Orta Saha',
  'Merkez Orta Saha': 'Orta Saha',
  'Orta Saha Sağ': 'Orta Saha',
  'Orta Saha Sol': 'Orta Saha',
  'Ön Libero': 'Orta Saha',
  'Sağ Bek': 'Defans',
  'Sol Bek': 'Defans',
  Stoper: 'Defans',
  Libero: 'Defans',
  Kaleci: 'Kaleci',
};

// Oneri/gorunum sirasi (hucumdan defansa).
export const POSITION_ORDER = [
  'Santrafor',
  'Forvet Arkası',
  'On Numara',
  'Sağ Kanat',
  'Sol Kanat',
  'Merkez Orta Saha',
  'Orta Saha Sağ',
  'Orta Saha Sol',
  'Ön Libero',
  'Sağ Bek',
  'Sol Bek',
  'Stoper',
  'Libero',
  'Kaleci',
];

export const slotOf = (positionName) => POSITION_SLOT[positionName] ?? null;

export function orderOf(positionName) {
  const i = POSITION_ORDER.indexOf(positionName);
  return i < 0 ? 99 : i;
}

/**
 * Uzun oyun (11 kişilik, klasik 1-4-4-2) için TAM pozisyon eşlemesi.
 *
 * Kısa oyunda bölgeler (Kaleci/Defans/Orta Saha/Forvet) yeterliydi; 11 kişilik
 * dizilişte sağ bek stoper yerine, kanat orta yerine konulamamalı. Bu yüzden her
 * detaylı Transfermarkt mevkisi aşağıdaki TAM pozisyon anahtarına eşlenir.
 */
export const LONG_SLOT = {
  Santrafor: 'Santrafor',
  'Forvet Arkası': 'Santrafor',
  'Sağ Kanat': 'Sağ Kanat',
  'Sol Kanat': 'Sol Kanat',
  'Orta Saha Sağ': 'Sağ Kanat',
  'Orta Saha Sol': 'Sol Kanat',
  'On Numara': 'Ofansif Orta Saha',
  'Merkez Orta Saha': 'Ofansif Orta Saha',
  'Ön Libero': 'Defansif Orta Saha',
  'Sağ Bek': 'Sağ Bek',
  'Sol Bek': 'Sol Bek',
  Stoper: 'Stoper',
  Libero: 'Stoper',
  Kaleci: 'Kaleci',
};

/** Detaylı pozisyon anahtarı (uzun oyun slot eşlemesi için). */
export const longSlotOf = (positionName) => LONG_SLOT[positionName] ?? null;

/**
 * Klasik 1-4-4-2 (toplam 11). Diziliş üstte forvet, altta kaleci olacak şekilde
 * sıralanmıştır; `pos` satır grubunu, `key` ise tam pozisyonu belirtir.
 */
export const LONG_FORMATION = [
  { pos: 'Forvet', key: 'Santrafor', short: 'FOR' },
  { pos: 'Forvet', key: 'Santrafor', short: 'FOR' },
  { pos: 'Orta Saha', key: 'Sol Kanat', short: 'SOL' },
  { pos: 'Orta Saha', key: 'Ofansif Orta Saha', short: 'OOS' },
  { pos: 'Orta Saha', key: 'Defansif Orta Saha', short: 'DOS' },
  { pos: 'Orta Saha', key: 'Sağ Kanat', short: 'SAĞ' },
  { pos: 'Defans', key: 'Sol Bek', short: 'SLB' },
  { pos: 'Defans', key: 'Stoper', short: 'STP' },
  { pos: 'Defans', key: 'Stoper', short: 'STP' },
  { pos: 'Defans', key: 'Sağ Bek', short: 'SĞB' },
  { pos: 'Kaleci', key: 'Kaleci', short: 'KL' },
];

/** Uzun diziliş için tam pozisyon bazında minimum oyuncu sayıları. */
export const LONG_NEED = {
  Kaleci: 1,
  'Sağ Bek': 1,
  'Sol Bek': 1,
  Stoper: 2,
  'Sağ Kanat': 1,
  'Sol Kanat': 1,
  'Ofansif Orta Saha': 1,
  'Defansif Orta Saha': 1,
  Santrafor: 2,
};
