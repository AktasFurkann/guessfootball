/**
 * "Bonservis Avı" modu için oyuncu -> takım eşleme ve bonservis değeri.
 *
 * - 4 büyükler (Beşiktaş, Galatasaray, Fenerbahçe, Trabzonspor): güncel Süper
 *   Lig kadro kimlikleriyle (SUPERLIG_ACTIVE_IDS) filtrelenir; böylece geçmişte
 *   oynamış oyuncular girmez.
 * - Diğer büyük lig takımları: oyuncunun son kulüp satırı seçkin takım
 *   listesindeyse ve güncelse kullanılır.
 *
 * Bonservis değeri olarak veride dolu olan en yüksek piyasa değeri kullanılır
 * (transfer ücreti geçmişi toplu çekimde çoğu oyuncu için yoktur).
 */
import { MARKET_TEAM_IDS, BIG_FOUR_IDS } from '../data/marketTeams.js';
import { latestSuperligClub, isSuperligActive } from './superligTeams.js';

const ACTIVE_AFTER = '2026-01-01';

function latestClubRow(doc) {
  const rows = doc?.careerByClub || [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (!rows[i].isNationalTeam) return rows[i];
  }
  return null;
}

function isRecent(doc, row) {
  const mvDate = doc?.marketValue?.determined;
  const lastDate = row?.lastDate;
  return (mvDate && mvDate >= ACTIVE_AFTER) || (lastDate && lastDate >= ACTIVE_AFTER);
}

/** Oyuncunun bu moddaki takımını (id) döndürür; uygun değilse null. */
export function marketClubOf(doc) {
  // 4 büyükler: güncel Süper Lig kadrosunda olmalı ve son Süper Lig kulübü 4 büyükten biri olmalı.
  const superClub = latestSuperligClub(doc);
  if (superClub && BIG_FOUR_IDS.has(String(superClub.clubId)) && isSuperligActive(doc)) {
    return String(superClub.clubId);
  }

  // Diğer büyük lig takımları: son kulüp satırı seçkin listede ve güncel olmalı.
  const last = latestClubRow(doc);
  if (last && MARKET_TEAM_IDS.has(String(last.clubId)) && !BIG_FOUR_IDS.has(String(last.clubId)) && isRecent(doc, last)) {
    return String(last.clubId);
  }

  return null;
}

/** En yüksek piyasa değerini milyon € cinsinden, tek ondalığa kesilmiş döndürür. */
export function marketFee(doc) {
  const highest = doc?.marketValue?.highest;
  if (!Number.isFinite(highest) || highest <= 0) return null;
  const millions = highest / 1_000_000;
  return Math.floor(millions * 10) / 10;
}
