/**
 * Online oda motorunun uctan uca testi.
 * Gercek sunucuyu ve iki socket.io-client baglantisini kullanir; bir turu
 * satir satir oynayip kazanan/skor mantigini dogrular.
 * Calistirma: node test/realtime.test.js  (sunucu ayakta olmali)
 */
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';

const URL = process.env.TEST_URL || 'http://localhost:3000';
const results = [];
const ok = (n) => { results.push({ n, ok: true }); console.log('  PASS ', n); };
const fail = (n, e) => { results.push({ n, ok: false }); console.error('  FAIL ', n, '::', e.message); };

const once = (sock, ev) => new Promise((res) => sock.once(ev, res));
const emitAck = (sock, ev, data) => new Promise((res) => sock.emit(ev, data, res));

async function run() {
  const host = Client(URL, { transports: ['websocket'] });
  const guest = Client(URL, { transports: ['websocket'] });
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);

  // 1) Oda kur
  let code, hostId, guestId;
  try {
    const created = await emitAck(host, 'room:create', { name: 'FURKAN' });
    assert.equal(created.ok, true);
    assert.match(String(created.code), /^\d{4}$/, '4 haneli kod');
    code = created.code; hostId = created.youId;
    ok('oda kuruldu, 4 haneli kod');
  } catch (e) { fail('oda kuruldu', e); }

  // 2) Yanlis kodla katilma reddedilir
  try {
    const bad = await emitAck(guest, 'room:join', { code: '0000', name: 'X' });
    assert.equal(bad.ok, false);
    ok('yanlis kod reddedilir');
  } catch (e) { fail('yanlis kod reddedilir', e); }

  // 3) Odaya katil
  try {
    const updateP = once(host, 'room:update');
    const joined = await emitAck(guest, 'room:join', { code, name: 'CANER' });
    assert.equal(joined.ok, true);
    guestId = joined.youId;
    const upd = await updateP;
    assert.equal(upd.players.length, 2, 'iki oyuncu');
    ok('odaya katilim + host bilgilendirildi');
  } catch (e) { fail('odaya katilim', e); }

  // 4) Rakip yokken/dolu odaya 3. katilim reddedilir
  try {
    const third = Client(URL, { transports: ['websocket'] });
    await once(third, 'connect');
    const r = await emitAck(third, 'room:join', { code, name: 'Z' });
    assert.equal(r.ok, false, 'dolu oda reddi');
    third.close();
    ok('dolu oda 3. oyuncuyu reddeder');
  } catch (e) { fail('dolu oda reddi', e); }

  // 5) Host baslatir, iki istemci de ayni oyuncuyu alir
  let rows;
  try {
    const hostRound = once(host, 'game:round');
    const guestRound = once(guest, 'game:round');
    host.emit('game:start');
    const [hr, gr] = await Promise.all([hostRound, guestRound]);
    assert.ok(hr.player.name, 'oyuncu ismi var');
    assert.equal(hr.player.name, gr.player.name, 'iki taraf ayni oyuncu');
    assert.equal(hr.rows.length, 5, '5 satir');
    assert.ok(!('answers' in hr), 'cevaplar sizdirilmamali');
    rows = hr.rows;
    ok('host baslatti, iki taraf ayni oyuncu, cevap sizmiyor');
  } catch (e) { fail('oyun baslatma', e); }

  // 6) Tur boyunca her satirda tahmin: host hep dogruya cok yakin (1),
  //    guest hep uzak (1000) -> host tum satirlari kazanmali.
  let roundEnd = null;
  try {
    for (let i = 0; i < 5; i++) {
      // Dinleyicileri emit'ten ONCE kur: sunucu row:result + (row:active|round:end)
      // olaylarini pes pese yolluyor; sonra kurarsak ikincisini kacirabiliriz.
      const resultP = once(host, 'row:result');
      const nextP = i < 4 ? once(host, 'row:active') : once(host, 'round:end');
      host.emit('row:guess', { value: 1 });       // dogruya daha yakin
      guest.emit('row:guess', { value: 100000 }); // cok uzak
      const result = await resultP;
      assert.equal(result.rowIndex, i, `satir ${i} sonucu`);
      // truthText 'veri yok' degilse host kazanmali (guest 100000 kesinlikle uzak).
      if (result.truthText !== 'veri yok') {
        assert.ok(result.winners.includes(hostId), `satir ${i}: host kazanmali`);
        assert.ok(!result.winners.includes(guestId), `satir ${i}: guest kaybetmeli`);
      }
      const next = await nextP;
      if (i === 4) roundEnd = next;
    }
    ok('5 satir oynandi, her satirda yakin olan kazandi');
  } catch (e) { fail('satir oynanisi', e); }

  // 7) Skor: host >= guest ve host puani > 0
  try {
    assert.ok(roundEnd, 'round:end geldi');
    const hs = roundEnd.scores[hostId];
    const gs = roundEnd.scores[guestId];
    assert.ok(hs > gs, `host skoru (${hs}) > guest (${gs})`);
    ok(`tur bitti, skor host ${roundEnd.scores[hostId]} - ${roundEnd.scores[guestId]} guest`);
  } catch (e) { fail('skor dogrulama', e); }

  // 8) Rakip ayrilinca digeri bilgilendirilir
  try {
    const leftP = once(host, 'opponent:left');
    guest.close();
    const info = await leftP;
    assert.equal(info.players.length, 1, 'tek oyuncu kaldi');
    ok('rakip ayrilinca bilgilendirme');
  } catch (e) { fail('rakip ayrilma', e); }

  host.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} test gecti`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('Olumcul:', e); process.exit(1); });
