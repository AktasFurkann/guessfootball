/**
 * "Sunucular" listesi ve bitis puani icin online uctan uca test.
 * Calistirma: node test/realtime-lobby.test.js  (sunucu ayakta olmali)
 */
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';

const URL = process.env.TEST_URL || 'http://localhost:3000';
const results = [];
const ok = (n) => { results.push({ n, ok: true }); console.log('  PASS ', n); };
const fail = (n, e) => { results.push({ n, ok: false }); console.error('  FAIL ', n, '::', e.message); };

const once = (sock, ev) => new Promise((res) => sock.once(ev, res));
const emitAck = (sock, ev, data) => new Promise((res) => sock.emit(ev, data, res));
/** Kosulu saglayan ilk `rooms:list` olayini bekler. */
const nextList = (sock, pred) =>
  new Promise((res) => {
    const handler = ({ rooms }) => {
      if (!pred(rooms)) return;
      sock.off('rooms:list', handler);
      res(rooms);
    };
    sock.on('rooms:list', handler);
  });

async function run() {
  const host = Client(URL, { transports: ['websocket'] });
  const guest = Client(URL, { transports: ['websocket'] });
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);

  let code;
  let hostId;
  let guestId;

  // 1) Misafir listeyi izler; host oda kurunca listede gorunur.
  try {
    await emitAck(guest, 'rooms:watch', null);
    const listed = nextList(guest, (rooms) => rooms.some((r) => r.host === 'HOSTUM'));
    const created = await emitAck(host, 'room:create', { name: 'HOSTUM', mode: 'closest', pool: 'legends', target: 1 });
    assert.equal(created.ok, true);
    assert.equal(created.target, 1, 'bitis puani odaya islendi');
    code = created.code;
    hostId = created.youId;
    const rooms = await listed;
    const room = rooms.find((r) => r.code === code);
    assert.ok(room, 'oda listede');
    assert.equal(room.mode, 'closest');
    assert.equal(room.pool, 'legends');
    assert.equal(room.target, 1);
    assert.equal(room.players, 1);
    ok('kurulan oda Sunucular listesinde gorunur');
  } catch (e) { fail('oda listede', e); }

  // 2) Gecersiz bitis puani varsayilana (20) duser.
  try {
    const other = Client(URL, { transports: ['websocket'] });
    await once(other, 'connect');
    const res = await emitAck(other, 'room:create', { name: 'X', target: 'abc' });
    assert.equal(res.target, 20);
    other.close();
    ok('gecersiz bitis puani 20 olur');
  } catch (e) { fail('varsayilan bitis puani', e); }

  // 3) Misafir listeden dogrudan katilir; dolan oda listeden duser.
  try {
    const gone = nextList(guest, (rooms) => !rooms.some((r) => r.code === code));
    const joined = await emitAck(guest, 'room:join', { code, name: 'MISAFIR' });
    assert.equal(joined.ok, true);
    assert.equal(joined.mode, 'closest', 'oda modu benimsenir');
    assert.equal(joined.target, 1, 'bitis puani misafire gelir');
    guestId = joined.youId;
    await gone;
    guest.emit('rooms:unwatch');
    ok('listeden katilim + dolu oda listeden duser');
  } catch (e) { fail('listeden katilim', e); }

  // 4) Bitis puanina (1) ulasilinca oyun biter.
  try {
    const round = once(host, 'game:round');
    host.emit('game:start');
    await round;
    // Ilk satir "veri yok" olabilir; puan cikana kadar ayni tahmini gir.
    let over = null;
    const overP = once(host, 'game:over').then((data) => (over = data));
    for (let i = 0; i < 5 && !over; i += 1) {
      const resultP = once(host, 'row:result');
      host.emit('row:guess', { value: 1 });
      guest.emit('row:guess', { value: 100000 });
      const result = await resultP;
      if (result.winners.length) {
        assert.ok(result.points[hostId] >= 1, 'kazanana puan yazildi');
        await overP;
      }
    }
    assert.ok(over, 'game:over geldi');
    assert.ok(over.scores[hostId] >= 1, 'host bitis puanina ulasti');
    assert.deepEqual(over.winners, [hostId]);
    assert.equal(over.target, 1);
    ok(`bitis puaninda oyun biter (skor ${over.scores[hostId]}-${over.scores[guestId]})`);
  } catch (e) { fail('bitis puani', e); }

  // 5) Oyun bitince "sonraki oyuncu" calismaz; yeni oyun oylamasi calisir.
  try {
    let gotRound = false;
    const onRound = () => { gotRound = true; };
    host.on('game:round', onRound);
    host.emit('game:next');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(gotRound, false, 'bitmis oyunda sonraki oyuncu gelmemeli');
    host.off('game:round', onRound);

    const fresh = once(host, 'game:round');
    host.emit('game:new');
    guest.emit('game:new');
    const round = await fresh;
    assert.equal(round.scores[hostId], 0, 'skorlar sifirlandi');
    ok('bitmis oyunda yalnizca yeni oyun baslar, skorlar sifirlanir');
  } catch (e) { fail('yeni oyun', e); }

  host.close();
  guest.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} test gecti`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('Olumcul:', e); process.exit(1); });
