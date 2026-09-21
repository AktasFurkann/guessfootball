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

/** Istemciye gonderilecek guvenli satir ust bilgisi (cevap icermez). */
export const rowsMeta = GAME_ROWS.map(({ key, label, hint }) => ({ key, label, hint }));
