import { players } from '../db.js';
import { SUPERLIG_TEAM_IDS } from './superligTeams.js';
import { LEGENDS } from '../data/sources.js';
import { MORE_LEGENDS } from '../data/moreLegends.js';
import { TURKISH_LEGEND_IDS } from '../data/turkishLegends.js';
import { normalize } from './matcher.js';

/**
 * "En Yakın Tahmin" ve "Kariyer Kıyası" için oyuncu havuzları.
 *
 * Kullanıcı oyuna başlarken beş havuz seçebilir:
 *  - legends  : efsaneler (Türkiye dahil)
 *  - superlig : aktif Süper Lig kulüplerinde oynamış oyuncular
 *  - big5     : İngiltere, İtalya, Fransa, İspanya, Almanya'da oynamışlar
 *  - trlegends: Türk futbolunun yerli/yabancı efsaneleri (elle seçilmiş ID listesi)
 *  - all      : yukarıdaki havuzların birleşimi
 *
 * Görseli olmayan oyuncular hiçbir havuza girmez: tahtanın ortasındaki fotoğraf
 * oyunun ana ipucu, boş kutuyla gelen tur "bozuk" görünüyor.
 *
 * Her havuz "tanınırlık" eşiğinden geçer (bkz. POOL_THRESHOLDS): veritabanındaki
 * 16.000+ oyuncunun büyük kısmı 5 büyük ligde birkaç maç görmüş gençler ve
 * yedeklerdir; bunlar tahmin edilebilir değildir. Elle seçilmiş efsane isimleri eşiğin
 * altında kalsalar da (Metin Oktay, Pelé…) havuza girer.
 */

const BIG5_COUNTRIES = new Set(['İngiltere', 'İtalya', 'Fransa', 'İspanya', 'Almanya']);

/** Son resmi maçtan bu kadar yıl geçtiyse kariyer bitmiş sayılır. */
const RETIRED_AFTER_YEARS = 2;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/**
 * İsim listesinde olmayan bir oyuncunun efsane sayılması için aranan kariyer
 * ağırlığı. Eşiği düşürmek havuzu 300 maçlık sıradan emeklilerle doldurur,
 * yükseltmek Maradona (357 maç / 163 gol / piyasa değeri kaydı yok) gibi
 * isimleri dışarıda bırakır. Havuzu daraltmak/genişletmek için tek yer burası.
 */
const LEGEND_MIN_GAMES = 400;
const LEGEND_MIN_GOALS = 160;
const LEGEND_MIN_PEAK_VALUE = 40_000_000;

/**
 * İsim listesinde OLMAYAN emekliler için daha sıkı eşik. Yukarıdaki eşikler
 * (400 maç / 160 gol) tek başına Holosko, Mierzejewski gibi uzun kariyerli ama
 * efsane olmayan oyuncuları da havuza alıyordu; listede olmayan biri ancak
 * zirve değeri ya da gol sayısı gerçekten büyükse efsane sayılır.
 */
const UNLISTED_LEGEND_MIN_GOALS = 250;

/**
 * İsim listesindeki efsanelerde aranan asgari kariyer verisi. Eski oyuncuların
 * kaydı eksik olabiliyor; 8 maçlık bir "Ronaldo" ya da 1 maçlık bir "Suat Kaya"
 * hem yanlış oyuncu hem de tahmin edilecek sayısı olmayan kötü bir tur olur.
 */
const LEGEND_DATA_MIN_GAMES = 100;
const LEGEND_DATA_MIN_GOALS = 30;

/**
 * "Tanınırlık" eşikleri. Zirve piyasa değeri VEYA çok maç oynamış olma;
 * ikincisi piyasa değeri kavramı yokken oynamış eski/Türk efsanelerini yakalar.
 */
export const POOL_THRESHOLDS = {
  famous: { minValue: 20_000_000, minGames: 350 },
  stars: { minValue: 40_000_000, minGames: 450 },
};

export const GAME_POOLS = new Set(['famous', 'stars', 'legends', 'superlig', 'big5', 'trlegends', 'all']);

const LEGEND_NAMES = new Set([...LEGENDS, ...MORE_LEGENDS].map((name) => normalize(name)));

/** Eşiği MongoDB $match suzgeci olarak verir. */
export function thresholdFilter(name = 'famous') {
  const { minValue, minGames } = POOL_THRESHOLDS[name] ?? POOL_THRESHOLDS.famous;
  return {
    $or: [{ 'marketValue.highest': { $gte: minValue } }, { 'careerTotals.games': { $gte: minGames } }],
  };
}

/** Aynı eşiği bellekteki dokuman uzerinde uygular. */
export function meetsThreshold(doc, name = 'famous') {
  const { minValue, minGames } = POOL_THRESHOLDS[name] ?? POOL_THRESHOLDS.famous;
  return (doc.marketValue?.highest ?? 0) >= minValue || (doc.careerTotals?.games ?? 0) >= minGames;
}

/**
 * Oyuncunun son resmi maç tarihi (ms) veya veri yoksa null.
 *
 * Toplu çekimde `currentClub` alanı oyuncuların ~%99'unda bos kaldigi icin
 * (bkz. superligTeams.js) emeklilik "su anki kulup" uzerinden anlasilamaz;
 * kariyer satirlarindaki en son mac tarihi guvenilir tek isarettir.
 */
function lastAppearanceAt(doc) {
  let latest = 0;
  for (const row of doc.careerByClub || []) {
    const time = Date.parse(row.lastDate || '');
    if (Number.isFinite(time) && time > latest) latest = time;
  }
  return latest || null;
}

function isRetired(doc) {
  const last = lastAppearanceAt(doc);
  if (last == null) return false;
  return Date.now() - last > RETIRED_AFTER_YEARS * YEAR_MS;
}

/** İsim listesindeki bir efsanenin tahmin edilebilir kariyer verisi var mı? */
function hasLegendData(doc) {
  return (
    (doc.careerTotals?.games ?? 0) >= LEGEND_DATA_MIN_GAMES ||
    (doc.careerTotals?.goals ?? 0) >= LEGEND_DATA_MIN_GOALS
  );
}

/** Adaslar arasinda kimin "asil" efsane oldugunu belirleyen kariyer agirligi. */
function legendWeight(doc) {
  const { goals = 0, games = 0 } = doc.careerTotals ?? {};
  // Gol once gelir: veri setinde Pelé 111 mac/100 gol, adasi 180 mac/18 gol.
  return goals * 1000 + games;
}

let cache = null;
let building = null;

async function build() {
  const docs = await players()
    .find(
      {},
      {
        projection: {
          name: 1,
          portraitUrl: 1,
          careerTotals: 1,
          marketValue: 1,
          'careerByClub.clubId': 1,
          'careerByClub.countryName': 1,
          'careerByClub.isNationalTeam': 1,
          'careerByClub.lastDate': 1,
        },
      },
    )
    .toArray();

  const legends = new Set();
  const superlig = new Set();
  const big5 = new Set();
  const trlegends = new Set();
  /** normalize(isim) -> o isimden secilen tek efsane. */
  const bestByName = new Map();

  for (const doc of docs) {
    if (!doc.portraitUrl) continue;

    // Türk efsaneleri ID ile seçildi; eşik/emeklilik sezgiseline takılmazlar.
    if (TURKISH_LEGEND_IDS.has(doc._id)) {
      trlegends.add(doc._id);
      legends.add(doc._id);
    }

    const key = normalize(doc.name);
    const namedLegendKey = LEGEND_NAMES.has(key) ? key : null;
    const isNamedLegend = namedLegendKey !== null && hasLegendData(doc);
    if (!isNamedLegend && !meetsThreshold(doc, 'famous')) continue;

    const games = doc.careerTotals?.games ?? 0;
    const goals = doc.careerTotals?.goals ?? 0;
    const peak = doc.marketValue?.highest ?? 0;
    const strongCareer =
      games >= LEGEND_MIN_GAMES || goals >= LEGEND_MIN_GOALS || peak >= LEGEND_MIN_PEAK_VALUE;
    const retired = isRetired(doc);
    const unlistedLegend = retired && (peak >= LEGEND_MIN_PEAK_VALUE || goals >= UNLISTED_LEGEND_MIN_GOALS);

    // Isim listesindekiler kariyeri bittiyse ya da zaten efsane agirliginda ise
    // girer; ikinci kosul, listedeki isimle ayni ada sahip genc oyuncularin
    // ("Robinho" 2002, "Bruno Alves" 2005) havuza sizmasini engeller.
    // Listede olmayanlar icin emeklilik + daha sıkı eşik birlikte aranir.
    if (isNamedLegend ? retired || strongCareer : unlistedLegend) {
      if (namedLegendKey) {
        // 16.000+ oyuncu arasinda adaslar var ("Pelé", "Ronaldo", "Robinho").
        // Ayni isimden yalnizca kariyeri en agir olan efsane kabul edilir.
        const rival = bestByName.get(namedLegendKey);
        if (!rival || legendWeight(doc) > legendWeight(rival)) bestByName.set(namedLegendKey, doc);
      } else {
        legends.add(doc._id);
      }
    }

    const clubRows = (doc.careerByClub || []).filter((row) => !row.isNationalTeam);
    if (clubRows.some((row) => SUPERLIG_TEAM_IDS.has(String(row.clubId)))) superlig.add(doc._id);
    if (clubRows.some((row) => BIG5_COUNTRIES.has(row.countryName))) big5.add(doc._id);
  }

  for (const doc of bestByName.values()) legends.add(doc._id);

  const all = new Set([...legends, ...superlig, ...big5, ...trlegends]);
  return { legends, superlig, big5, trlegends, all };
}

export async function ensurePool() {
  if (cache) return cache;
  if (!building) {
    // Basarisiz kurulum kalici olarak onbellege alinmasin, sonraki istek yine denesin.
    building = build().catch((error) => {
      building = null;
      throw error;
    });
  }
  cache = await building;
  return cache;
}

/** Bir havuzun oyuncu ID listesini döndürür; bilinmeyen havuzda null. */
export async function poolIds(pool) {
  const pools = await ensurePool();
  const ids = pools[pool];
  return ids ? [...ids] : null;
}

const idArrays = new Map(); // havuz adı -> ID dizisi (rastgele erişim için)

/**
 * Havuzdan rastgele bir oyuncu ID'si; havuz bilinmiyor/boşsa null.
 * Binlerce ID'lik `$in` + `$sample` sorgusu yerine seçim bellekte yapılır,
 * veritabanına tek bir `_id` araması kalır.
 */
export async function randomPoolId(pool) {
  const pools = await ensurePool();
  const ids = pools[pool];
  if (!ids || !ids.size) return null;
  let list = idArrays.get(pool);
  if (!list) {
    list = [...ids];
    idArrays.set(pool, list);
  }
  return list[Math.floor(Math.random() * list.length)];
}

/** Eski (eşik bazlı) havuzlar dışında kalanlar yeni anlamsal havuzlardır. */
export function isLegacyPool(pool) {
  return pool === 'famous' || pool === 'stars';
}
