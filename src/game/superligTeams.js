/**
 * Süper Lig Gol modu için "aktif Süper Lig takımı + oyuncusu" tespiti.
 *
 * Veri seti 2026-27 sezonunun açılış kadrolarını içerir. Bu listedeki 18 kulüp
 * o sezonun Süper Lig takımlarıdır. Oyuncuların verisinde "şu anki kulüp" alanı
 * toplu çekimde korunmadığı için, aktif kulüp şu şekilde çıkarılır:
 *  - Kariyer kulüp satırlarını sondan başa tara,
 *  - Bu listedeki ilk kulüp oyuncunun ana (Süper Lig) kulübü sayılır.
 * Bu sayede alt lige kiralanmış oyuncular da ana kulüplerinde kalır.
 *
 * "Aktif"lik: oyuncunun güncel piyasa değeri tarihi veya Süper Lig kulübündeki
 * son maç tarihi ACTIVE_AFTER'dan sonraysa oyuncu o sezon aktiftir. Veri seti
 * güncellendiğinde ACTIVE_AFTER yeni sezon başına çekilmelidir.
 */

export const SUPERLIG_TEAMS = [
  { id: '10484', name: 'Kasımpaşa' },
  { id: '449', name: 'Trabzonspor' },
  { id: '6890', name: 'İstanbul Başakşehir FK' },
  { id: '820', name: 'Gençlerbirliği SK' },
  { id: '37951', name: 'Çorum FK' },
  { id: '114', name: 'Beşiktaş JK' },
  { id: '2832', name: 'Gaziantep FK' },
  { id: '120', name: 'Kocaelispor' },
  { id: '126', name: 'Çaykur Rizespor' },
  { id: '2293', name: 'Konyaspor' },
  { id: '7160', name: 'Eyüpspor' },
  { id: '141', name: 'Galatasaray SK' },
  { id: '12382', name: 'Amed SK' },
  { id: '36', name: 'Fenerbahçe SK' },
  { id: '1467', name: 'Göztepe' },
  { id: '39722', name: 'Erzurumspor FK' },
  { id: '152', name: 'Samsunspor' },
  { id: '11282', name: 'Alanyaspor' },
];

export const SUPERLIG_TEAM_IDS = new Set(SUPERLIG_TEAMS.map((t) => t.id));

// 2026-27 sezonu verisinin başlangıcına göre aktiflik sınırı.
export const ACTIVE_AFTER = '2026-01-01';

/** Bir oyuncunun listedeki en güncel Süper Lig kulübünü (satırıyla) döndürür. */
export function latestSuperligClub(doc) {
  const rows = doc?.careerByClub || [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.isNationalTeam) continue;
    if (SUPERLIG_TEAM_IDS.has(String(row.clubId))) return row;
  }
  return null;
}

/** Oyuncunun bu kulüpte sezon içinde aktif olup olmadığını söyler. */
export function isSuperligActive(doc, clubRow) {
  const mvDate = doc?.marketValue?.determined;
  const lastDate = clubRow?.lastDate;
  return (mvDate && mvDate >= ACTIVE_AFTER) || (lastDate && lastDate >= ACTIVE_AFTER);
}
