/**
 * FotMob'dan ayrintili mac istatistikleri (yalnizca mac detayi ekrani icin).
 *
 * Transfermarkt temel istatistikleri veriyor; xG, rakip ceza sahasinda topla
 * bulusma, buyuk firsat, ikili mucadele, sut haritasi, momentum ve oyuncu
 * puanlari icin FotMob'un kendi uygulamasinin kullandigi (resmi olmayan,
 * anahtarsiz) uclar kullanilir. Tahminler ve para sistemi bundan etkilenmez:
 * FotMob'a ulasilamazsa detay ekrani Transfermarkt verisiyle devam eder.
 *
 * Yuk: gun listesi 10 dk, canli mac detayi 25 sn onbelleklenir; ayni maci
 * kac kisi acarsa acsin FotMob'a giden istek sayisi artmaz.
 */

const BASE = 'https://www.fotmob.com/api/data';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT_MS = 12_000;

const DAY_TTL = 10 * 60 * 1000;
const DETAIL_TTL = { live: 25 * 1000, scheduled: 5 * 60 * 1000, finished: 6 * 60 * 60 * 1000 };
const MISS_TTL = 30 * 60 * 1000; // eslesmeyen maci bu sure tekrar arama

const dayCache = new Map(); // yyyymmdd -> { at, list }
const detailCache = new Map(); // fotmobId -> { at, ttl, data }
const idCache = new Map(); // bizim mac id -> { at, fotmobId|null }
const inflight = new Map(); // anahtar -> Promise

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`FotMob HTTP ${res.status}`);
  return res.json();
}

/** Ayni anahtar icin eszamanli istekleri birlestirir. */
function once(key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)));
  return inflight.get(key);
}

const ymdUTC = (date) => new Date(date).toISOString().slice(0, 10).replace(/-/g, '');

async function dayMatches(ymd) {
  const hit = dayCache.get(ymd);
  if (hit && Date.now() - hit.at < DAY_TTL) return hit.list;
  const list = await once(`day:${ymd}`, async () => {
    const data = await getJson(`${BASE}/matches?date=${ymd}`);
    return (data.leagues ?? []).flatMap((league) =>
      (league.matches ?? []).map((m) => ({
        id: m.id,
        utcTime: Date.parse(m.status?.utcTime ?? ''),
        home: m.home?.longName || m.home?.name || '',
        away: m.away?.longName || m.away?.name || '',
      })),
    );
  });
  dayCache.set(ymd, { at: Date.now(), list });
  return list;
}

// ---------------- takim adi eslestirme ----------------
const FOLD = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ç: 'c', Ç: 'c', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u', ø: 'o', æ: 'ae', ß: 'ss' };
/** Kulup adlarinda ayirt edici olmayan ekler. */
const NOISE = new Set([
  'fc', 'sk', 'cf', 'ac', 'as', 'ssc', 'sc', 'afc', 'cd', 'ud', 'rc', 'rcd', 'sv', 'vfb', 'vfl', 'tsg', 'fk', 'bk', 'jk',
  'if', 'aik', 'sad', 'calcio', 'club', 'de', 'cp', 'sl', 'ca', 'us', 'ogc', 'losc', 'kv', 'krc', 'nk', 'hnk', 'gnk',
  'ks', 'pfc', 'fsv', 'spor', 'kulubu', 'and', 'the', 'football', 'futbol',
]);
/** Turkce sitede farkli yazilan sehir/kulup adlari. */
const ALIAS = { munih: 'munchen', munich: 'munchen', prag: 'prague', praha: 'prague', milano: 'milan', roma: 'rome', lizbon: 'lisbon', kopenhag: 'copenhagen', brugge: 'bruges', psg: 'paris' };

function tokens(name) {
  return String(name ?? '')
    .replace(/[ıİşŞğĞçÇöÖüÜøæß]/g, (ch) => FOLD[ch] ?? ch)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t))
    .map((t) => ALIAS[t] ?? t);
}

/** 0..1 arasi benzerlik: ortak (ya da ayni 4 harfle baslayan) kelime orani. */
export function nameSimilarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const same = (x, y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4))));
  const hits = ta.filter((x) => tb.some((y) => same(x, y))).length;
  return hits / Math.min(ta.length, tb.length);
}

/** Bizim mac kaydina karsilik gelen FotMob mac kimligi (bulunamazsa null). */
export async function findFotmobId(match) {
  const cached = idCache.get(match._id);
  if (cached && (cached.fotmobId || Date.now() - cached.at < MISS_TTL)) return cached.fotmobId;

  const kickoff = new Date(match.kickoff).getTime();
  const days = [...new Set([ymdUTC(kickoff), ymdUTC(kickoff - 3 * 3600e3), ymdUTC(kickoff + 3 * 3600e3)])];
  const candidates = (await Promise.all(days.map(dayMatches))).flat();
  let best = null;
  for (const c of candidates) {
    if (!Number.isFinite(c.utcTime) || Math.abs(c.utcTime - kickoff) > 3 * 3600e3) continue;
    const h = nameSimilarity(match.home?.name, c.home);
    const a = nameSimilarity(match.away?.name, c.away);
    // Iki takim da biraz, en az biri guclu benzemeli; saat de yakin olmali.
    if (Math.min(h, a) === 0 || Math.max(h, a) < 0.99) continue;
    const score = h + a - Math.abs(c.utcTime - kickoff) / (24 * 3600e3);
    if (!best || score > best.score) best = { id: c.id, score };
  }
  const fotmobId = best?.id ?? null;
  idCache.set(match._id, { at: Date.now(), fotmobId });
  return fotmobId;
}

// ---------------- detay ----------------
/** Istatistik etiketleri (FotMob anahtari -> Turkce). Bilinmeyen anahtar Ingilizce kalir. */
const STAT_TR = {
  BallPossesion: 'Topla oynama',
  expected_goals: 'Gol beklentisi (xG)',
  total_shots: 'Toplam şut',
  ShotsOnTarget: 'İsabetli şut',
  ShotsOffTarget: 'İsabetsiz şut',
  touches_opp_box: 'Rakip ceza sahasında topla buluşma',
  big_chance: 'Büyük fırsat',
  big_chance_missed_title: 'Kaçırılan büyük fırsat',
  accurate_passes: 'Başarılı pas',
  yellow_cards: 'Sarı kart',
  red_cards: 'Kırmızı kart',
  corners: 'Korner',
  blocked_shots: 'Bloklanan şut',
  shots_woodwork: 'Direkten dönen şut',
  shots_inside_box: 'Ceza sahası içi şut',
  shots_outside_box: 'Ceza sahası dışı şut',
  expected_goals_open_play: 'xG (akan oyun)',
  expected_goals_set_play: 'xG (duran top)',
  expected_goals_non_penalty: 'xG (penaltısız)',
  expected_goals_on_target: 'İsabetli şut xG (xGOT)',
  passes: 'Pas',
  own_half_passes: 'Kendi yarı sahasında pas',
  opposition_half_passes: 'Rakip yarı sahada pas',
  long_balls_accurate: 'Başarılı uzun top',
  accurate_crosses: 'Başarılı orta',
  player_throws: 'Taç',
  Offsides: 'Ofsayt',
  'matchstats.headers.tackles': 'Top kapma',
  interceptions: 'Pas arası',
  shot_blocks: 'Şut bloğu',
  clearances: 'Uzaklaştırma',
  keeper_saves: 'Kurtarış',
  duel_won: 'Kazanılan ikili mücadele',
  ground_duels_won: 'Kazanılan yer mücadelesi',
  aerials_won: 'Kazanılan hava topu',
  dribbles_succeeded: 'Başarılı dribbling',
  fouls: 'Faul',
};
const GROUP_TR = {
  top_stats: 'Genel İstatistikler',
  shots: 'Şut İstatistikleri',
  expected_goals: 'Gol Beklentisi (xG)',
  passes: 'Pas İstatistikleri',
  defence: 'Defans İstatistikleri',
  duels: 'İkili Mücadele İstatistikleri',
  discipline: 'Disiplin',
};
const PERIOD_TR = { All: 'Tümü', FirstHalf: '1. Yarı', SecondHalf: '2. Yarı' };

const rawNumber = (raw, shown) => {
  const v = raw?.value ?? (typeof shown === 'number' ? shown : Number.parseFloat(shown));
  return Number.isFinite(v) ? v : null;
};

function statGroups(groups) {
  return (groups ?? [])
    .map((g) => ({
      key: g.key,
      title: GROUP_TR[g.key] ?? g.title,
      stats: (g.stats ?? [])
        // Grup basligini tekrar eden "title" satirlari ve bos satirlar atlanir.
        .filter((s) => s.type !== 'title' && Array.isArray(s.stats) && s.stats.some((v) => v != null))
        .map((s) => ({
          key: s.key,
          title: STAT_TR[s.key] ?? s.title,
          home: s.stats[0] ?? 0,
          away: s.stats[1] ?? 0,
          homeValue: rawNumber(s.rawStats?.[0], s.stats[0]),
          awayValue: rawNumber(s.rawStats?.[1], s.stats[1]),
          percent: s.key === 'BallPossesion',
        })),
    }))
    .filter((g) => g.stats.length);
}

function lineupOf(team) {
  if (!team) return null;
  const map = (p) => ({
    id: p.id,
    name: p.name,
    shirt: p.shirtNumber ?? null,
    rating: p.performance?.rating ?? null,
  });
  return {
    formation: team.formation ?? null,
    rating: team.rating ?? null,
    coach: team.coach?.name ?? null,
    starters: (team.starters ?? []).map(map),
    subs: (team.subs ?? []).map(map),
  };
}

function transform(data) {
  const c = data.content ?? {};
  const [homeTeam, awayTeam] = data.header?.teams ?? [];
  const homeId = homeTeam?.id;
  const status = data.header?.status ?? {};
  const periods = Object.entries(c.stats?.Periods ?? {})
    .map(([key, p]) => ({ key, title: PERIOD_TR[key] ?? key, groups: statGroups(p.stats) }))
    .filter((p) => p.groups.length);

  const shots = (c.shotmap?.shots ?? []).map((s) => ({
    side: s.teamId === homeId ? 'home' : 'away',
    player: s.playerName ?? null,
    minute: s.min ?? null,
    addedTime: s.minAdded ?? null,
    // FotMob koordinati: x 0-105 (kendi kalesinden rakip kaleye), y 0-68.
    x: s.x,
    y: s.y,
    type: s.isOwnGoal ? 'ownGoal' : s.eventType === 'Goal' ? 'goal' : s.isBlocked ? 'blocked' : s.isOnTarget ? 'onTarget' : 'miss',
    xg: s.expectedGoals ?? null,
    insideBox: !!s.isFromInsideBox,
    situation: s.situation ?? null,
  }));

  const players = Object.values(c.playerStats ?? {})
    .map((p) => {
      const top = p.stats?.[0]?.stats ?? {};
      return {
        id: p.id,
        name: p.name,
        side: p.teamId === homeId ? 'home' : 'away',
        rating: top['FotMob rating']?.stat?.value ?? null,
        goals: top.Goals?.stat?.value ?? 0,
        assists: top.Assists?.stat?.value ?? 0,
      };
    })
    .filter((p) => p.rating != null)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 6);

  return {
    fotmobId: Number(data.general?.matchId),
    live: !!status.ongoing,
    finished: !!status.finished,
    liveTime: status.liveTime?.short ? String(status.liveTime.short).replace(/[‎‏’']/g, '') : null,
    periods,
    shots,
    momentum: (c.momentum?.main?.data ?? []).map((m) => ({ minute: m.minute, value: m.value })),
    topPlayers: players,
    lineups: { home: lineupOf(c.lineup?.homeTeam), away: lineupOf(c.lineup?.awayTeam) },
  };
}

/** FotMob mac detayi (onbellekli). Hata durumunda onceki veri ya da hata. */
export async function fotmobDetail(fotmobId) {
  const hit = detailCache.get(fotmobId);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  try {
    const data = await once(`detail:${fotmobId}`, async () => transform(await getJson(`${BASE}/matchDetails?matchId=${fotmobId}`)));
    const ttl = data.live ? DETAIL_TTL.live : data.finished ? DETAIL_TTL.finished : DETAIL_TTL.scheduled;
    detailCache.set(fotmobId, { at: Date.now(), ttl, data });
    return data;
  } catch (error) {
    if (hit) return hit.data;
    throw error;
  }
}

/** Bizim mac kaydi icin FotMob ayrintilari; eslesmezse/ulasilamazsa null. */
export async function fotmobForMatch(match) {
  try {
    const id = await findFotmobId(match);
    return id ? await fotmobDetail(id) : null;
  } catch (error) {
    console.warn('[fotmob]', match._id, error.message);
    return null;
  }
}
