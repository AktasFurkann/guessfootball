import { config } from '../config.js';

/**
 * Transfermarkt'in resmi olmayan JSON uclari.
 *
 * `tmapi` ucu, transfermarkt.com'un performans sayfasindaki
 * `player-performance-proxy` Svelte bileseninin konustugu katmandir; eski
 * `ceapi/player/{id}/performance` ucu kaldirildigi icin guncel kaynak budur.
 * `ceapi` ucu ise transfer gecmisi ve piyasa degeri icin hala calisiyor.
 */
export const TMAPI_BASE = 'https://tmapi.transfermarkt.technology';

/** Site alan adi, veri dilini belirler (tr -> Turkce isimler). */
export const SITE_BASE =
  config.locale === 'en'
    ? 'https://www.transfermarkt.com'
    : 'https://www.transfermarkt.com.tr';

/** Bir oyuncunun tum kariyerinin mac mac performansi. */
export const performanceGameUrl = (playerId) =>
  `${TMAPI_BASE}/player/${playerId}/performance-game`;

/** Ulke / pozisyon / musabaka tipi sozlugu (surec basina bir kez cekilir). */
export const attributesUrl = () => `${TMAPI_BASE}/attributes`;

/**
 * Varlik (oyuncu / kulup / musabaka) toplu sorgusu.
 * `ids[]=` dizi formati zorunludur; virgullu duz liste 400 dondurur.
 */
export function entitiesUrl(kind, ids) {
  const query = ids.map((id) => `ids%5B%5D=${encodeURIComponent(id)}`).join('&');
  return `${TMAPI_BASE}/${kind}?${query}`;
}

/** Transfer gecmisi (bonservis bedelleri dahil). */
export const transferHistoryUrl = (playerId) =>
  `${SITE_BASE}/ceapi/transferHistory/list/${playerId}`;

/** Piyasa degeri gelisim grafigi. */
export const marketValueUrl = (playerId) =>
  `${SITE_BASE}/ceapi/marketValueDevelopment/graph/${playerId}`;
