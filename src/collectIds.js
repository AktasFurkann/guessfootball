/**
 * Genis oyuncu ID listesini olusturur:
 *  - Liglerin guncel kadrolari (lig -> kulup -> oyuncu)
 *  - Milli takim guncel kadrolari (isim -> milli takim -> oyuncu)
 *  - Efsaneler (isim -> oyuncu)
 *
 * Sonucu data/ids.json'a yazar. Ana veri cekimi (scraper) bu listeyi kullanir.
 *
 * Kullanim:
 *   node src/collectIds.js               tum kaynaklar
 *   node src/collectIds.js --leagues=TR1 sadece belirli lig(ler)
 *   node src/collectIds.js --sample      kucuk dogrulama ornegi
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { request, requestText, fetchEntities } from './transfermarkt/client.js';
import { LEAGUES, NATIONAL_TEAMS, LEGENDS } from './data/sources.js';

const SITE = 'https://www.transfermarkt.com.tr';

const leagueClubsUrl = (id) => `${SITE}/quickselect/teams/${encodeURIComponent(id)}`;
const clubSquadUrl = (id) => `${SITE}/quickselect/players/${encodeURIComponent(id)}`;
const searchUrl = (q) => `${SITE}/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(q)}`;

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[çÇ]/g, 'c')
    .replace(/[öÖ]/g, 'o')
    .replace(/[üÜ]/g, 'u')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

function firstPlayerId(html) {
  const m = html.match(/profil\/spieler\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function allVereinIds(html) {
  return [...new Set([...html.matchAll(/verein\/(\d+)/g)].map((m) => m[1]))];
}

/** Bir ligin guncel kulup ID'leri. */
async function leagueClubs(leagueId) {
  const data = await request(leagueClubsUrl(leagueId), { label: `lig ${leagueId}` });
  return (Array.isArray(data) ? data : []).map((c) => String(c.id)).filter(Boolean);
}

/** Bir kulubun guncel kadro oyuncu ID'leri. */
async function clubSquad(clubId) {
  const data = await request(clubSquadUrl(clubId), { label: `kadro ${clubId}` });
  return (Array.isArray(data) ? data : []).map((p) => Number(p.id)).filter(Boolean);
}

/** Ulke ismini milli takim kulup ID'sine cozer (tmapi ile dogrular). */
async function resolveNationalTeamId(countryName) {
  const html = await requestText(searchUrl(countryName), { label: `ara ${countryName}` });
  const vereinIds = allVereinIds(html).slice(0, 20);
  if (!vereinIds.length) return null;

  const clubs = await fetchEntities('clubs', vereinIds);
  const target = norm(countryName);
  // Senior milli takim: isim ULKE ADIYLA BIREBIR ayni (U17/U21 vs. haric).
  const match = clubs.find((c) => c.baseDetails?.isNationalTeam && norm(c.name) === target);
  return match ? String(match.id) : null;
}

/** Efsane ismini oyuncu ID'sine cozer. */
async function resolveLegendId(name) {
  const html = await requestText(searchUrl(name), { label: `ara ${name}` });
  return firstPlayerId(html);
}

function parseArgs(argv) {
  const opts = { leagues: null, sample: false };
  for (const a of argv) {
    if (a === '--sample') opts.sample = true;
    else if (a.startsWith('--leagues=')) opts.leagues = a.split('=')[1].split(',');
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let leagues = LEAGUES;
  let nationals = NATIONAL_TEAMS;
  let legends = LEGENDS;
  if (opts.leagues) leagues = LEAGUES.filter((l) => opts.leagues.includes(l.id));
  if (opts.sample) {
    leagues = LEAGUES.filter((l) => l.id === 'TR1');
    nationals = NATIONAL_TEAMS.slice(0, 2);
    legends = LEGENDS.slice(0, 3);
  }

  /** id -> kaynak etiketi (ilk gorulen kaynak korunur) */
  const ids = new Map();
  const add = (id, source) => {
    const n = Number(id);
    if (n && !ids.has(n)) ids.set(n, source);
  };

  // --- Ligler ---
  for (const league of leagues) {
    try {
      const clubs = await leagueClubs(league.id);
      console.log(`[lig] ${league.name} (${league.id}): ${clubs.length} kulüp`);
      for (const clubId of clubs) {
        try {
          const squad = await clubSquad(clubId);
          squad.forEach((pid) => add(pid, `lig:${league.id}`));
          console.log(`  kulüp ${clubId}: ${squad.length} oyuncu (toplam ${ids.size})`);
        } catch (e) {
          console.warn(`  ! kadro ${clubId} atlandı: ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`! lig ${league.id} atlandı: ${e.message}`);
    }
  }

  // --- Milli takimlar ---
  for (const country of nationals) {
    try {
      const ntId = await resolveNationalTeamId(country);
      if (!ntId) {
        console.warn(`[milli] ${country}: bulunamadı`);
        continue;
      }
      const squad = await clubSquad(ntId);
      squad.forEach((pid) => add(pid, `milli:${country}`));
      console.log(`[milli] ${country} (${ntId}): ${squad.length} oyuncu (toplam ${ids.size})`);
    } catch (e) {
      console.warn(`! milli ${country} atlandı: ${e.message}`);
    }
  }

  // --- Efsaneler ---
  let legendOk = 0;
  for (const name of legends) {
    try {
      const pid = await resolveLegendId(name);
      if (pid) {
        add(pid, 'efsane');
        legendOk += 1;
      } else {
        console.warn(`[efsane] ${name}: bulunamadı`);
      }
    } catch (e) {
      console.warn(`! efsane ${name} atlandı: ${e.message}`);
    }
  }
  console.log(`[efsane] ${legendOk}/${legends.length} çözüldü`);

  const list = [...ids.entries()].map(([id, source]) => ({ id, source }));
  await mkdir('data', { recursive: true });
  await writeFile('data/ids.json', JSON.stringify(list, null, 2), 'utf8');

  console.log(`\n=== TOPLAM ${list.length} benzersiz oyuncu ID -> data/ids.json ===`);
}

main().catch((e) => {
  console.error('[collectIds] Ölümcül hata:', e);
  process.exitCode = 1;
});
