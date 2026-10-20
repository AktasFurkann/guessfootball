/**
 * Hesap, mac tahmini, sonuclandirma, profil ve rekabet testleri.
 *
 * Bellek ici MongoDB kullanir; MATCH_SYNC=off ile Transfermarkt'a gidilmez,
 * maclar teste elle yazilir. Calistirma: npm run test:account
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as Client } from 'socket.io-client';

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.error(`  FAIL  ${name}\n        ${error.message}`);
  }
}

let baseUrl;
const call = async (method, path, { body, token } = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

async function run() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.DB_NAME = 'football_account_test';
  process.env.MATCH_SYNC = 'off';

  const db = await import('../src/db.js');
  const { createApp } = await import('../src/server.js');
  const { attachRealtime } = await import('../src/realtime.js');
  const service = await import('../src/matches/service.js');
  const { recordOnlineGame } = await import('../src/stats/profile.js');
  await db.connect();

  const server = createServer(createApp());
  attachRealtime(server);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const today = service.dateTR(0);
  const HOUR = 60 * 60 * 1000;
  const match = (id, kickoffOffset, extra = {}) => ({
    _id: id,
    date: today,
    kickoff: new Date(Date.now() + kickoffOffset),
    timeDefined: true,
    competition: { id: 'CL', name: 'UEFA Şampiyonlar Ligi', logoUrl: null },
    home: { id: '583', name: 'Paris Saint-Germain', crestUrl: null },
    away: { id: '131', name: 'FC Barcelona', crestUrl: null },
    status: 'scheduled',
    score: null,
    regularScoreKnown: true,
    minute: null,
    ...extra,
  });
  await db.matches().insertMany([match(1, 3 * HOUR), match(2, 4 * HOUR), match(3, -HOUR, { status: 'live' })]);

  let furkan;
  let caner;

  console.log('--- hesap ---');
  await test('kayit 1000 para ile hesap ve oturum anahtari verir', async () => {
    const { status, body } = await call('POST', '/api/auth/register', { body: { username: 'Furkan', password: 'gizli123' } });
    assert.equal(status, 201);
    assert.ok(body.token?.length >= 32, 'oturum anahtari');
    assert.equal(body.user.coins, 1000);
    assert.ok(!('password' in body.user), 'sifre bilgisi donmemeli');
    furkan = body;
  });

  await test('ayni ad (buyuk/kucuk harf farkiyla) tekrar alinamaz', async () => {
    const { status } = await call('POST', '/api/auth/register', { body: { username: 'FURKAN', password: 'baska123' } });
    assert.equal(status, 409);
  });

  await test('gecersiz ad ve kisa sifre reddedilir', async () => {
    assert.equal((await call('POST', '/api/auth/register', { body: { username: 'a', password: 'gizli123' } })).status, 400);
    assert.equal((await call('POST', '/api/auth/register', { body: { username: 'Caner', password: '123' } })).status, 400);
  });

  await test('sifre veritabaninda duz metin tutulmaz', async () => {
    const doc = await db.users().findOne({ usernameKey: 'furkan' });
    assert.ok(doc.password.hash && doc.password.salt);
    assert.ok(!JSON.stringify(doc).includes('gizli123'));
  });

  await test('yanlis sifre 401, dogru sifre giris yapar', async () => {
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'furkan', password: 'yanlis' } })).status, 401);
    const { status, body } = await call('POST', '/api/auth/login', { body: { username: 'furkan', password: 'gizli123' } });
    assert.equal(status, 200);
    assert.equal(body.user.username, 'Furkan');
  });

  await test('kayitli oturumla /me calisir (beni hatirla), anahtarsiz 401', async () => {
    const me = await call('GET', '/api/auth/me', { token: furkan.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, 'Furkan');
    assert.equal((await call('GET', '/api/auth/me')).status, 401);
  });

  await test('cikis yapilan oturum gecersizlesir', async () => {
    const { body } = await call('POST', '/api/auth/login', { body: { username: 'furkan', password: 'gizli123' } });
    await call('POST', '/api/auth/logout', { token: body.token });
    assert.equal((await call('GET', '/api/auth/me', { token: body.token })).status, 401);
  });

  caner = (await call('POST', '/api/auth/register', { body: { username: 'Caner', password: 'sifre456' } })).body;

  console.log('--- tahmin ---');
  await test('gunun maclari listelenir, baslamamis mac acik', async () => {
    const { status, body } = await call('GET', '/api/matches', { token: furkan.token });
    assert.equal(status, 200);
    assert.equal(body.date, today);
    assert.equal(body.matches.length, 3);
    assert.equal(body.matches.find((m) => m.id === 1).open, true);
    assert.equal(body.matches.find((m) => m.id === 3).open, false, 'baslamis mac kapali');
  });

  await test('girissiz tahmin yapilamaz', async () => {
    assert.equal((await call('PUT', '/api/matches/1/prediction', { body: { pick: '1' } })).status, 401);
  });

  await test('skor girilirse 1-X-2 skordan turetilir', async () => {
    const { status, body } = await call('PUT', '/api/matches/1/prediction', { token: furkan.token, body: { pick: 'X', score: { home: 2, away: 1 } } });
    assert.equal(status, 200);
    assert.equal(body.pick, '1');
    assert.deepEqual(body.score, { home: 2, away: 1 });
  });

  await test('gecersiz secim reddedilir, tahmin guncellenebilir', async () => {
    assert.equal((await call('PUT', '/api/matches/2/prediction', { token: caner.token, body: { pick: '5' } })).status, 400);
    await call('PUT', '/api/matches/1/prediction', { token: caner.token, body: { pick: '2' } });
    const { body } = await call('PUT', '/api/matches/1/prediction', { token: caner.token, body: { pick: 'X' } });
    assert.equal(body.pick, 'X');
  });

  await test('baslamis maca tahmin yapilamaz', async () => {
    assert.equal((await call('PUT', '/api/matches/3/prediction', { token: furkan.token, body: { pick: '1' } })).status, 409);
  });

  await test('listede kullanicinin kendi tahmini gorunur', async () => {
    const { body } = await call('GET', '/api/matches', { token: furkan.token });
    assert.equal(body.matches.find((m) => m.id === 1).prediction.pick, '1');
  });

  console.log('--- sonuclandirma ---');
  await test('kesin skor 50 + 1000, yanlis tahmin 0 para; tekrar calismak cift odemez', async () => {
    await db.matches().updateOne({ _id: 1 }, { $set: { status: 'finished', score: { home: 2, away: 1 } } });
    await service.settleFinished([1]);
    await service.settleFinished([1]);
    const f = await db.users().findOne({ usernameKey: 'furkan' });
    const c = await db.users().findOne({ usernameKey: 'caner' });
    assert.equal(f.coins, 1000 + 50 + 1000);
    assert.equal(c.coins, 1000);
  });

  await test('penaltiya giden mac 90 dakikada beraberlik sayilir, kesin skor degerlendirilmez', () => {
    const m = { status: 'finished', score: { home: 5, away: 6 }, regularScoreKnown: false };
    assert.deepEqual(
      [service.evaluatePrediction({ pick: 'X', score: { home: 5, away: 6 } }, m).coins, service.evaluatePrediction({ pick: '2' }, m).coins],
      [50, 0],
    );
  });

  await test('iptal mac para vermez', () => {
    const r = service.evaluatePrediction({ pick: '1' }, { status: 'void', score: null });
    assert.equal(r.void, true);
    assert.equal(r.coins, 0);
  });

  console.log('--- profil + rekabet ---');
  const fUser = await db.users().findOne({ usernameKey: 'furkan' });
  const cUser = await db.users().findOne({ usernameKey: 'caner' });
  await recordOnlineGame({ mode: 'closest', players: [{ userId: fUser._id, username: 'Furkan', score: 20 }, { userId: cUser._id, username: 'Caner', score: 14 }] });
  await recordOnlineGame({ mode: 'squad', players: [{ userId: cUser._id, username: 'Caner', score: 300 }, { userId: fUser._id, username: 'Furkan', score: 250 }] });
  await recordOnlineGame({ mode: 'closest', players: [{ userId: fUser._id, username: 'Furkan', score: 20 }, { userId: null, username: 'Misafir', score: 3 }] });

  await test('kendi profili: tahmin ve oyun istatistikleri, rekabet yok', async () => {
    const { status, body } = await call('GET', '/api/users/furkan', { token: furkan.token });
    assert.equal(status, 200);
    assert.equal(body.isSelf, true);
    assert.equal(body.headToHead, null);
    assert.equal(body.predictions.summary.correct, 1);
    assert.equal(body.predictions.summary.exact, 1);
    assert.equal(body.predictions.history[0].home, 'Paris Saint-Germain');
    assert.equal(body.games.online.total.played, 3);
    assert.equal(body.games.online.total.won, 2);
    assert.equal(body.games.online.total.lost, 1);
    assert.equal(body.games.online.byMode.closest.won, 2);
    assert.equal(body.user.coins, 1000 + 1050 + 20 + 20, 'tahmin + iki online galibiyet');
  });

  await test('baskasinin profili: ikili rekabet bakanin acisindan', async () => {
    const { body } = await call('GET', '/api/users/caner', { token: furkan.token });
    assert.equal(body.isSelf, false);
    assert.equal(body.headToHead.played, 2, 'misafirle oyun rekabete girmez');
    assert.equal(body.headToHead.won, 1);
    assert.equal(body.headToHead.lost, 1);
    assert.equal(body.predictions.summary.wrong, 1, 'Caner X dedi, mac 2-1 bitti');
  });

  await test('girissiz profil gorulur ama rekabet yok; bilinmeyen kullanici 404', async () => {
    const { body } = await call('GET', '/api/users/caner');
    assert.equal(body.headToHead, null);
    assert.equal((await call('GET', '/api/users/yokboyle')).status, 404);
  });

  await test('tek kisilik kadro sonucu profile yazilir', async () => {
    assert.equal((await call('POST', '/api/games/solo', { token: caner.token, body: { mode: 'squad', total: 412 } })).status, 201);
    assert.equal((await call('POST', '/api/games/solo', { token: caner.token, body: { mode: 'closest', total: 1 } })).status, 400);
    const { body } = await call('GET', '/api/users/caner');
    assert.deepEqual(body.games.solo.squad, { played: 1, best: 412 });
  });

  await test('kullanici aramasi', async () => {
    const { body } = await call('GET', '/api/users/search?q=ca');
    assert.deepEqual(body.results.map((u) => u.username), ['Caner']);
  });

  console.log('--- online + hesap ---');
  await test('giris yapan oyuncunun odadaki adi hesap adidir', async () => {
    const socket = Client(baseUrl, { transports: ['websocket'], auth: { token: furkan.token } });
    await new Promise((r) => socket.once('connect', r));
    const update = new Promise((r) => socket.once('room:update', r));
    await new Promise((r) => socket.emit('room:create', { name: 'BASKAAD' }, r));
    const room = await update;
    assert.equal(room.players[0].name, 'Furkan');
    assert.equal(room.players[0].registered, true);
    socket.close();
  });

  await test('gecersiz anahtarla baglanan misafir olarak oynar', async () => {
    const socket = Client(baseUrl, { transports: ['websocket'], auth: { token: 'x'.repeat(64) } });
    await new Promise((r) => socket.once('connect', r));
    const update = new Promise((r) => socket.once('room:update', r));
    await new Promise((r) => socket.emit('room:create', { name: 'MISAFIR' }, r));
    const room = await update;
    assert.equal(room.players[0].name, 'MISAFIR');
    assert.equal(room.players[0].registered, false);
    socket.close();
  });

  server.close();
  await db.close();
  await mongo.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} test gecti`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error('Olumcul:', e);
  process.exit(1);
});
