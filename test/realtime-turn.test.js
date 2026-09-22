/**
 * Online turn-based modlarin (compare + squad) socket testi.
 * Gercek sunucu ayakta olmali (npm start). Zar + sirali akisi dogrular.
 */
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';

const URL = process.env.TEST_URL || 'http://localhost:3000';
const results = [];
const ok = (n) => { results.push({ n, ok: true }); console.log('  PASS ', n); };
const fail = (n, e) => { results.push({ n, ok: false }); console.error('  FAIL ', n, '::', e.message); };
const once = (s, ev) => new Promise((r) => s.once(ev, r));
const ack = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));

async function pair(mode) {
  const host = Client(URL, { transports: ['websocket'] });
  const guest = Client(URL, { transports: ['websocket'] });
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);
  const c = await ack(host, 'room:create', { name: 'A', mode });
  assert.equal(c.mode, mode, 'mod dogru');
  const upd = once(host, 'room:update');
  const j = await ack(guest, 'room:join', { code: c.code, name: 'B' });
  assert.equal(j.mode, mode, 'katilan mod ogrendi');
  await upd;
  return { host, guest, hostId: c.youId, guestId: j.youId };
}

/** Zar at, esitse tekrar; kazanani dondur. */
async function rollUntilWinner(host, guest) {
  host.emit('game:start');
  await Promise.all([once(host, 'dice:begin'), once(guest, 'dice:begin')]);
  for (let attempt = 0; attempt < 10; attempt++) {
    const win = new Promise((res) => {
      const onWin = (d) => { host.off('dice:tie', onTie); res(d); };
      const onTie = () => { host.off('dice:winner', onWin); res(null); };
      host.once('dice:winner', onWin);
      host.once('dice:tie', onTie);
    });
    host.emit('dice:roll');
    guest.emit('dice:roll');
    const r = await win;
    if (r) return r.starterId;
  }
  throw new Error('zar sonuclanmadi');
}

async function pick(country, positions) {
  const p = new URLSearchParams({ country, limit: '20' });
  if (positions) p.set('positions', positions);
  const r = await fetch(`${URL}/api/players/search?${p}`).then((x) => x.json());
  return r.results?.[0];
}

async function testSquad() {
  const { host, guest, hostId, guestId } = await pair('squad');
  const byId = { [hostId]: host, [guestId]: guest };
  const names = { [hostId]: 'A', [guestId]: 'B' };

  const roundP = once(host, 'squad:round');
  const starterId = await rollUntilWinner(host, guest);
  ok('squad: zar ile başlayan belirlendi');
  const round = await roundP;
  assert.ok(round.country?.country, 'ülke geldi');
  assert.equal(round.turnId, starterId, 'sıra zar kazananında');
  ok('squad: ülke + ilk sıra doğru');

  // Sirasi gelen bir oyuncu yerlestirir.
  const country = round.country.country;
  let turnId = round.turnId;
  const p1 = await pick(country);
  assert.ok(p1, 'ülke oyuncusu bulundu');
  const placedP = once(host, 'squad:placed');
  byId[turnId].emit('squad:place', { playerId: p1.id, slotIdx: 5 });
  const placed = await placedP;
  assert.equal(placed.by, turnId, 'yerleştiren doğru');
  assert.ok(placed.player.caps >= 1, 'maç sayısı geldi');
  ok(`squad: ${names[turnId]} ${placed.player.name} yerleştirdi (${placed.player.caps} maç)`);

  // Sira digerine gecti mi
  const turnP = once(host, 'squad:turn');
  const turn = await turnP;
  assert.notEqual(turn.turnId, turnId, 'sıra diğerine geçti');
  ok('squad: sıra diğer oyuncuya geçti');

  // Ayni oyuncu tekrar denenirse hata
  const errP = once(byId[turn.turnId], 'game:error');
  byId[turn.turnId].emit('squad:place', { playerId: p1.id, slotIdx: 5 });
  const err = await errP;
  assert.match(err.message, /kullan/i, 'tekrar kullanım engellendi');
  ok('squad: aynı oyuncu tekrar kullanılamıyor');

  host.close();
  guest.close();
}

async function testCompare() {
  const { host, guest, hostId, guestId } = await pair('compare');
  const byId = { [hostId]: host, [guestId]: guest };

  const roundP = once(host, 'compare:round');
  const starterId = await rollUntilWinner(host, guest);
  ok('compare: zar ile başlayan belirlendi');
  const round = await roundP;
  assert.ok(round.player?.name, 'orta oyuncu geldi');
  assert.equal(round.rows.length, 5, '5 satır');
  assert.equal(round.turnId, starterId, 'sıra zar kazananında');
  ok('compare: orta oyuncu + ilk sıra doğru');

  // Satir 1: starter bir oyuncu yazar (herhangi biri), sonra digeri.
  const anyP = await pick('Arjantin');
  const guessedP = once(host, 'compare:guessed');
  byId[starterId].emit('compare:guess', { playerId: anyP.id });
  await guessedP;
  const turnP = once(host, 'compare:turn');
  const t = await turnP;
  assert.notEqual(t.turnId, starterId, 'sıra diğerine geçti');
  ok('compare: ilk tahminden sonra sıra geçti');

  const other = t.turnId;
  const anyP2 = await pick('Brezilya');
  const resultP = once(host, 'compare:result');
  byId[other].emit('compare:guess', { playerId: anyP2.id });
  const res = await resultP;
  assert.equal(res.rowIndex, 0, 'satır 0 sonucu');
  assert.ok('scores' in res, 'skor var');
  ok('compare: iki tahmin sonrası satır açıldı');

  host.close();
  guest.close();
}

async function run() {
  try { await testSquad(); } catch (e) { fail('squad akışı', e); }
  try { await testCompare(); } catch (e) { fail('compare akışı', e); }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} test geçti`);
  process.exit(failed ? 1 : 0);
}
run().catch((e) => { console.error('Ölümcül:', e); process.exit(1); });
