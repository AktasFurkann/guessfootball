/**
 * API'nin uctan uca testi.
 *
 * Bellek ici bir MongoDB baslatir, `data/*.json` iceriginden veritabanini
 * doldurur ve gercek Express uygulamasini gercek HTTP uzerinden dener.
 * Atlas baglantisi gerektirmez.
 *
 * Calistirma: npm test
 */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo;
let server;
let baseUrl;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.error(`  FAIL  ${name}\n        ${error.message}`);
  }
}

const get = async (path) => {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.json() };
};

async function setup() {
  mongo = await MongoMemoryServer.create();

  // config.js ortam degiskenlerini import aninda okur; once ayarla.
  process.env.MONGODB_URI = mongo.getUri();
  process.env.DB_NAME = 'football_test';
  process.env.PORT = '0';

  const { connect, players, teams, close } = await import('../src/db.js');
  const { createApp } = await import('../src/server.js');

  await connect();

  // Sabit kucuk fixture (80 kurasyonlu yildiz) - canli data/ ciktisindan bagimsiz.
  const playerDocs = JSON.parse(await readFile('test/fixtures/players.json', 'utf8'));
  const teamDocs = JSON.parse(await readFile('test/fixtures/teams.json', 'utf8'));

  await players().insertMany(playerDocs);
  await teams().insertMany(teamDocs);
  console.log(`[test] ${playerDocs.length} oyuncu, ${teamDocs.length} takim yuklendi\n`);

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  return { close, playerDocs };
}

async function run() {
  const { close, playerDocs } = await setup();
  const messi = playerDocs.find((player) => player._id === 28003) ?? playerDocs[0];

  console.log('--- /health ---');
  await test('saglik kontrolu db ayakta diyor', async () => {
    const { status, body } = await get('/health');
    assert.equal(status, 200);
    assert.equal(body.db, 'up');
  });

  console.log('--- /api/players/random ---');
  await test('rastgele oyuncu doner', async () => {
    const { status, body } = await get('/api/players/random');
    assert.equal(status, 200);
    assert.ok(body.player.id, 'id olmali');
    assert.ok(Array.isArray(body.player.careerByClub), 'kariyer verisi olmali');
  });

  await test('rastgele oyuncu kimligi sizdirmaz', async () => {
    for (let i = 0; i < 15; i += 1) {
      const { body } = await get('/api/players/random');
      const serialized = JSON.stringify(body.player);
      for (const field of ['name', 'shortName', 'fullName', 'portraitUrl', 'relativeUrl']) {
        assert.ok(
          !Object.hasOwn(body.player, field),
          `"${field}" alani sizdirilmis`,
        );
      }
      assert.ok(!serialized.includes('portrait/big'), 'portre URL sizdirilmis');
    }
  });

  await test('zor modda mevcut kulup gizlenir', async () => {
    const { body } = await get('/api/players/random?difficulty=hard');
    assert.equal(body.difficulty, 'hard');
    assert.ok(!Object.hasOwn(body.player, 'currentClub'), 'currentClub gizlenmeli');
  });

  await test('kariyer yolu kulup adi ve logo icerir', async () => {
    const { body } = await get('/api/players/random');
    const row = body.player.careerByClub[0];
    assert.ok(row.name, 'kulup adi olmali');
    assert.ok(row.crestUrl, 'kulup logosu olmali');
  });

  console.log('--- /api/players/check ---');
  await test('dogru tahmin kabul edilir', async () => {
    const { body } = await get(
      `/api/players/check?id=${messi._id}&guess=${encodeURIComponent(messi.name)}`,
    );
    assert.equal(body.correct, true);
    assert.equal(body.player.name, messi.name);
  });

  await test('soyad tek basina kabul edilir', async () => {
    const surname = messi.name.split(' ').pop();
    const { body } = await get(`/api/players/check?id=${messi._id}&guess=${encodeURIComponent(surname)}`);
    assert.equal(body.correct, true);
  });

  await test('yazim hatasi tolere edilir', async () => {
    const typo = messi.name.replace(/ss/, 's');
    const { body } = await get(`/api/players/check?id=${messi._id}&guess=${encodeURIComponent(typo)}`);
    assert.equal(body.correct, true, `"${typo}" kabul edilmeliydi`);
  });

  await test('yanlis tahmin reddedilir', async () => {
    const { body } = await get(`/api/players/check?id=${messi._id}&guess=zinedine%20zidane`);
    assert.equal(body.correct, false);
    assert.equal(body.player, undefined, 'yanlis tahminde isim sizdirilmamali');
  });

  await test('baska bir futbolcunun ismi yazim hatasi sayilmaz', async () => {
    const others = playerDocs.filter((player) => player._id !== messi._id);
    for (const other of others) {
      const { body } = await get(
        `/api/players/check?id=${messi._id}&guess=${encodeURIComponent(other.name)}`,
      );
      assert.equal(body.correct, false, `"${other.name}" Messi icin dogru sayildi`);
    }
  });

  await test('her oyuncu kendi ismiyle bilinebilir', async () => {
    for (const player of playerDocs) {
      const { body } = await get(
        `/api/players/check?id=${player._id}&guess=${encodeURIComponent(player.name)}`,
      );
      assert.equal(body.correct, true, `"${player.name}" kendi ismiyle bilinemedi`);
    }
  });

  await test('hicbir oyuncu baska bir oyuncunun ismiyle bilinemez (tum ciftler)', async () => {
    // HTTP yerine eslestirici seviyesinde: 80x80 cift hizlica taranir.
    // "Xavi"/"Gavi", "Kane"/"Kanté" gibi 1 harf farkli isimleri yakalar.
    const { checkGuess, candidateNames, primaryNames } = await import('../src/game/matcher.js');
    const namesById = new Map(
      playerDocs.map((p) => [p._id, { all: candidateNames(p), primary: primaryNames(p) }]),
    );

    const collisions = [];
    for (const target of playerDocs) {
      const reserved = new Set();
      const reservedPrimary = new Set();
      for (const [id, names] of namesById) {
        if (id === target._id) continue;
        for (const name of names.all) reserved.add(name);
        for (const name of names.primary) reservedPrimary.add(name);
      }
      for (const other of playerDocs) {
        if (other._id === target._id) continue;
        if (checkGuess(target, other.name, { reserved, reservedPrimary }).correct) {
          collisions.push(`"${other.name}" -> ${target.name}`);
        }
      }
    }

    assert.deepEqual(collisions, [], `cakisma: ${collisions.join(', ')}`);
  });

  await test('eksik parametre 400 doner', async () => {
    assert.equal((await get('/api/players/check?id=28003')).status, 400);
    assert.equal((await get('/api/players/check?guess=messi')).status, 400);
  });

  await test('olmayan oyuncu 404 doner', async () => {
    assert.equal((await get('/api/players/check?id=999999999&guess=x')).status, 404);
  });

  console.log('--- /api/teams ---');
  await test('takim listesi logolarla doner', async () => {
    const { status, body } = await get('/api/teams');
    assert.equal(status, 200);
    assert.ok(body.total > 0, 'takim olmali');
    assert.ok(body.teams[0].name, 'takim adi olmali');
    assert.ok(body.teams[0].logo, 'takim logosu olmali');
  });

  await test('takim ismiyle aranabilir', async () => {
    const { body } = await get('/api/teams?q=barcelona');
    assert.ok(body.count > 0, 'Barcelona bulunmali');
    assert.ok(/barcelona/i.test(body.teams[0].name));
  });

  await test('milli takimlar filtrelenebilir', async () => {
    const { body } = await get('/api/teams?nationalTeam=true');
    assert.ok(body.teams.every((team) => team.isNationalTeam), 'hepsi milli takim olmali');
  });

  await test('sayfalama calisir', async () => {
    const { body } = await get('/api/teams?limit=3');
    assert.equal(body.teams.length, 3);
  });

  console.log('--- /api/players listesi ---');
  await test('oyuncu listesi doner', async () => {
    const { body } = await get('/api/players');
    assert.equal(body.count, playerDocs.length);
  });

  console.log('--- /api/game/random ---');
  await test('oyun oyuncusu kimlik ve cevaplarla doner', async () => {
    const { status, body } = await get('/api/game/random');
    assert.equal(status, 200);
    assert.ok(body.name, 'isim acik olmali (bu mod kimligi gizlemez)');
    assert.ok(body.answers, 'answers olmali');
    for (const key of ['careerGoals', 'clubCount', 'birthYear']) {
      assert.ok(key in body.answers, `answers.${key} olmali`);
    }
  });

  console.log('--- oyuncu havuzlari ---');
  await test('big5 havuzu yalnizca 5 buyuk ligde oynamis oyuncu verir', async () => {
    const BIG5 = new Set(['İngiltere', 'İtalya', 'Fransa', 'İspanya', 'Almanya']);
    for (let i = 0; i < 12; i += 1) {
      const { status, body } = await get('/api/game/random?pool=big5');
      assert.equal(status, 200);
      const doc = playerDocs.find((player) => player._id === body.id);
      assert.ok(doc, `secilen oyuncu fixture'da olmali: ${body.name}`);
      assert.ok(
        (doc.careerByClub || []).some((row) => !row.isNationalTeam && BIG5.has(row.countryName)),
        `${doc.name} 5 buyuk ligde oynamis olmali`,
      );
    }
  });

  await test('efsane havuzu emekli ya da efsane agirliginda oyuncu verir', async () => {
    // Emeklilik "su anki kulup" degil (toplu cekimde bos kaliyor), son mac
    // tarihi uzerinden belirlenir. Hala oynayan biri ancak kariyeri zaten
    // efsane agirligindaysa (bkz. pool.js LEGEND_MIN_*) havuza girer.
    const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 12; i += 1) {
      const { status, body } = await get('/api/game/random?pool=legends');
      assert.equal(status, 200);
      const doc = playerDocs.find((player) => player._id === body.id);
      assert.ok(doc, `secilen oyuncu fixture'da olmali: ${body.name}`);

      const last = Math.max(
        ...(doc.careerByClub || []).map((row) => Date.parse(row.lastDate || '') || 0),
      );
      const retired = Date.now() - last > TWO_YEARS_MS;
      const totals = doc.careerTotals ?? {};
      const legendGrade =
        (totals.games ?? 0) >= 400 ||
        (totals.goals ?? 0) >= 160 ||
        (doc.marketValue?.highest ?? 0) >= 40_000_000;

      assert.ok(
        retired || legendGrade,
        `${doc.name} ne emekli ne efsane agirliginda (${totals.games} mac, ${totals.goals} gol)`,
      );
    }
  });

  await test('Türk efsaneleri havuzu yalnizca listedeki oyunculari verir', async () => {
    const { TURKISH_LEGEND_IDS } = await import('../src/data/turkishLegends.js');
    for (let i = 0; i < 12; i += 1) {
      const { status, body } = await get('/api/game/random?pool=trlegends');
      assert.equal(status, 200);
      assert.ok(TURKISH_LEGEND_IDS.has(body.id), `${body.name} Türk efsaneleri listesinde olmali`);
      assert.ok(body.portraitUrl, `${body.name} gorselsiz gelmemeli`);
    }
  });

  await test('kiyas modu Türk efsaneleri havuzunu destekler', async () => {
    const { TURKISH_LEGEND_IDS } = await import('../src/data/turkishLegends.js');
    const { status, body } = await get('/api/game/compare/random?pool=trlegends');
    assert.equal(status, 200);
    assert.ok(TURKISH_LEGEND_IDS.has(body.id), `${body.name} listede olmali`);
  });

  await test('havuzlar gorselsiz oyuncu vermez', async () => {
    for (const pool of ['legends', 'superlig', 'big5', 'all']) {
      const { status, body } = await get(`/api/game/random?pool=${pool}`);
      assert.equal(status, 200);
      assert.ok(body.portraitUrl, `${pool}: ${body.name} gorselsiz`);
    }
  });

  await test('bilinmeyen havuz varsayilana duser', async () => {
    const { status, body } = await get('/api/game/random?pool=uyduruk');
    assert.equal(status, 200);
    assert.ok(body.id, 'oyuncu donmeli');
  });

  console.log('--- /api/img vekili ---');
  await test('izin verilmeyen konak reddedilir', async () => {
    const { status } = await get('/api/img?url=https%3A%2F%2Fexample.com%2Fa.png');
    assert.equal(status, 400);
  });

  await test('gecersiz adres reddedilir', async () => {
    const { status } = await get('/api/img?url=not-a-url');
    assert.equal(status, 400);
  });

  await test('http (https olmayan) adres reddedilir', async () => {
    const { status } = await get(
      '/api/img?url=http%3A%2F%2Fimg.a.transfermarkt.technology%2Fportrait%2Fbig%2F1.jpg',
    );
    assert.equal(status, 400);
  });

  console.log('--- otomatik tamamlama + kiyas ---');
  await test('isim aramasi sonuc doner (mes -> Messi)', async () => {
    const { status, body } = await get('/api/players/search?q=mes');
    assert.equal(status, 200);
    assert.ok(body.results.length > 0, 'sonuc olmali');
    assert.ok(
      body.results.some((r) => /messi/i.test(r.name)),
      'Messi bulunmali',
    );
  });

  await test('aksanli arama normalize edilir (kante -> Kanté)', async () => {
    const { body } = await get('/api/players/search?q=kante');
    assert.ok(body.results.some((r) => /kant/i.test(r.name)), 'Kanté bulunmali');
  });

  await test('kiyas/random orta oyuncu ve degerler doner', async () => {
    const { status, body } = await get('/api/game/compare/random');
    assert.equal(status, 200);
    assert.ok(body.name, 'orta oyuncu ismi');
    assert.equal(body.rows.length, 5, '5 satir');
    for (const key of ['clubGoals', 'ntGoals', 'marketValue', 'heightCm', 'birthYear']) {
      assert.ok(key in body.values, `values.${key}`);
    }
  });

  await test('kiyas/player belirli oyuncunun degerlerini doner', async () => {
    const { status, body } = await get(`/api/game/compare/player/${messi._id}`);
    assert.equal(status, 200);
    assert.equal(body.name, messi.name);
    assert.ok(body.values.clubGoals > 0, 'Messi kulup golu > 0');
  });

  console.log('--- milli kadro ---');
  await test('ulke + mevki filtreli arama caps ile doner', async () => {
    // Messi "Sağ Kanat" -> Orta Saha bolgesi (slot esleme).
    const { body } = await get('/api/players/search?country=Arjantin&positions=Orta Saha&q=messi');
    assert.ok(body.results.some((r) => /messi/i.test(r.name)), 'Messi (Arjantin/Orta Saha)');
    assert.ok(body.results.every((r) => typeof r.caps === 'number'), 'caps sayisal');
  });

  await test('squad/formation 6 slot doner', async () => {
    const { body } = await get('/api/game/squad/formation');
    assert.equal(body.formation.length, 6);
  });

  await test('squad/player belirli ulkedeki caps', async () => {
    const { status, body } = await get(`/api/game/squad/player/${messi._id}?country=Arjantin`);
    assert.equal(status, 200);
    assert.ok(body.caps > 0, 'Messi Arjantin caps > 0');
    assert.ok(body.slot, 'slot (FOR/ORT/DEF/KL)');
  });

  console.log('--- süper lig gol ---');
  await test('superlig/formation kalecisiz 6 slot doner', async () => {
    const { body } = await get('/api/game/superlig/formation');
    assert.equal(body.formation.length, 6);
    assert.ok(body.formation.every((slot) => slot.pos !== 'Kaleci'), 'kaleci olmamali');
  });

  await test('superlig/teams liste doner', async () => {
    const { status, body } = await get('/api/game/superlig/teams');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.teams), 'teams dizisi olmali');
  });

  await test('superlig/player team parametresi ister', async () => {
    const { status } = await get(`/api/game/superlig/player/${messi._id}`);
    assert.equal(status, 400);
  });

  console.log('--- bonservis avı ---');
  await test('market/formation kalecili 6 slot doner', async () => {
    const { body } = await get('/api/game/market/formation');
    assert.equal(body.formation.length, 6);
    assert.equal(body.formation.filter((slot) => slot.pos === 'Kaleci').length, 1, 'tek kaleci olmali');
  });

  await test('market/teams liste doner', async () => {
    const { status, body } = await get('/api/game/market/teams');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.teams), 'teams dizisi olmali');
  });

  await test('market/player team parametresi ister', async () => {
    const { status } = await get(`/api/game/market/player/${messi._id}`);
    assert.equal(status, 400);
  });

  await test('bilinmeyen API yolu 404 JSON doner', async () => {
    assert.equal((await get('/api/yok')).status, 404);
  });

  console.log('--- statik arayuz ---');
  await test('ana sayfa index.html sunulur', async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  });

  await test('API disi yol arayuze duser (SPA fallback)', async () => {
    const response = await fetch(`${baseUrl}/menu`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  });

  // --- ozet ---
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} test gecti`);

  server.close();
  await close();
  await mongo.stop();

  if (failed.length) process.exitCode = 1;
}

run().catch(async (error) => {
  console.error('[test] Olumcul hata:', error);
  server?.close();
  await mongo?.stop();
  process.exitCode = 1;
});
