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
