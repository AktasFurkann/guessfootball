import { Server } from 'socket.io';
import { GAME_ROWS, rowsMeta } from './game/rows.js';
import { pickRandomGamePlayer, poolFilter } from './game/roundData.js';
import { COMPARE_ROWS, compareValues } from './game/compare.js';
import { FORMATION, randomCountry, listCountries, nationalCaps } from './game/squad.js';
import { slotOf } from './game/positions.js';
import { ensurePlayer } from './game/ensurePlayer.js';
import { players } from './db.js';

/**
 * Online oyun motoru - oda tabanli, iki oyunculu, sunucu-otoriter.
 *
 * Uc mod:
 *  - closest: "En Yakin Tahmin" (es zamanli tahmin, en yakin kazanir)
 *  - compare: "Kariyer Kiyasi" (zar + sirali, ortadakine en yakin isim)
 *  - squad:   "Milli Kadro" (zar + sirali, ulkeden kadro kur)
 * compare/squad turn-based: once zar (herkes kendi zarini atar), sonra sirayla;
 * bir oyuncu ismi bir oyunda tekrar kullanilamaz.
 */

const MAX_PLAYERS = 2;
const MODES = new Set(['closest', 'compare', 'squad']);
const rooms = new Map();

function generateCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    mode: room.mode,
    players: [...room.players.entries()].map(([id, p]) => ({ id, name: p.name, score: p.score })),
  };
}

const scoreMap = (room) =>
  Object.fromEntries([...room.players.entries()].map(([id, p]) => [id, p.score]));

const sanitizeName = (name, fallback) => String(name ?? '').trim().slice(0, 12) || fallback;

const ids = (room) => [...room.players.keys()];
const otherId = (room, id) => ids(room).find((x) => x !== id);

export function attachRealtime(httpServer) {
  const io = new Server(httpServer);

  io.on('connection', (socket) => {
    socket.on('room:create', ({ name, mode } = {}, ack) => {
      leaveCurrentRoom(socket);
      const code = generateCode();
      const room = {
        code,
        hostId: socket.id,
        players: new Map(),
        mode: MODES.has(mode) ? mode : 'closest',
        phase: 'lobby',
        // ortak
        usedIds: new Set(),
        dice: new Map(),
        starter: 0,
        turn: null,
        round: 0,
        // closest
        current: null,
        activeRow: 0,
        guesses: new Map(),
        // compare
        rowGuesses: new Map(),
        // squad
        slots: new Map(),
        country: null,
        usedCountries: new Set(),
        placed: new Map(),
      };
      room.players.set(socket.id, { name: sanitizeName(name, 'Oyuncu 1'), score: 0 });
      rooms.set(code, room);
      socket.data.roomCode = code;
      socket.join(code);
      ack?.({ ok: true, code, youId: socket.id, mode: room.mode });
      io.to(code).emit('room:update', publicRoom(room));
    });

    socket.on('room:join', ({ code, name } = {}, ack) => {
      const room = rooms.get(String(code || '').trim());
      if (!room) return ack?.({ ok: false, error: 'Böyle bir oda yok.' });
      if (room.phase !== 'lobby') return ack?.({ ok: false, error: 'Oyun çoktan başlamış.' });
      if (room.players.size >= MAX_PLAYERS) return ack?.({ ok: false, error: 'Oda dolu.' });

      leaveCurrentRoom(socket);
      room.players.set(socket.id, { name: sanitizeName(name, 'Oyuncu 2'), score: 0 });
      socket.data.roomCode = room.code;
      socket.join(room.code);
      ack?.({ ok: true, code: room.code, youId: socket.id, mode: room.mode });
      io.to(room.code).emit('room:update', publicRoom(room));
    });

    socket.on('game:start', async () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostId !== socket.id) return;
      if (room.players.size < MAX_PLAYERS) return socket.emit('game:error', { message: 'Rakip bekleniyor.' });

      if (room.mode === 'closest') {
        await startClosestRound(io, room);
      } else {
        beginDice(io, room);
      }
    });

    // ---- closest ----
    socket.on('row:guess', ({ value } = {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.mode !== 'closest' || room.phase !== 'playing') return;
      if (!room.players.has(socket.id) || room.guesses.has(socket.id)) return;
      const parsed = Number(String(value).replace(',', '.'));
      room.guesses.set(socket.id, Number.isFinite(parsed) ? parsed : null);
      io.to(room.code).emit('row:progress', { submitted: [...room.guesses.keys()] });
      if (room.guesses.size >= room.players.size) revealClosestRow(io, room);
    });
    socket.on('game:next', async () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostId !== socket.id) return;
      if (room.mode === 'closest') await startClosestRound(io, room);
    });

    // ---- zar (compare + squad) ----
    socket.on('dice:roll', () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.phase !== 'dice' || !room.players.has(socket.id)) return;
      if (room.dice.has(socket.id)) return;
      room.dice.set(socket.id, 1 + Math.floor(Math.random() * 6));
      io.to(room.code).emit('dice:update', { rolls: Object.fromEntries(room.dice) });
      if (room.dice.size >= room.players.size) resolveDice(io, room);
    });

    // ---- compare ----
    socket.on('compare:guess', async ({ playerId } = {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.mode !== 'compare' || room.phase !== 'playing') return;
      if (currentTurnId(room) !== socket.id) return;
      await compareGuess(io, room, socket.id, playerId);
    });

    // ---- squad ----
    socket.on('squad:place', async ({ playerId, slotIdx } = {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.mode !== 'squad' || room.phase !== 'playing') return;
      if (currentTurnId(room) !== socket.id) return;
      await squadPlace(io, room, socket.id, playerId, slotIdx);
    });

    socket.on('game:next-round', async () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostId !== socket.id) return;
      if (room.mode === 'compare') await startCompareRound(io, room);
      else if (room.mode === 'squad') await startSquadRound(io, room);
    });

    socket.on('room:leave', () => leaveCurrentRoom(socket));
    socket.on('disconnect', () => leaveCurrentRoom(socket));
  });

  function leaveCurrentRoom(socket) {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    socket.data.roomCode = null;
    socket.leave(code);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) return void rooms.delete(code);
    if (room.hostId === socket.id) room.hostId = ids(room)[0];
    // Oyun ortasinda biri cikarsa lobiye don.
    resetRoomState(room);
    room.phase = 'lobby';
    io.to(code).emit('opponent:left', publicRoom(room));
  }

  return io;
}

// ================= ORTAK =================
function resetRoomState(room) {
  room.usedIds = new Set();
  room.dice = new Map();
  room.turn = null;
  room.round = 0;
  room.current = null;
  room.activeRow = 0;
  room.guesses = new Map();
  room.rowGuesses = new Map();
  room.slots = new Map();
  room.country = null;
  room.usedCountries = new Set();
  room.placed = new Map();
}

/** Sirasi gelen oyuncunun id'si (turn: 0/1 -> players sirasi). */
const currentTurnId = (room) => ids(room)[room.turn];

// ================= ZAR =================
function beginDice(io, room) {
  room.phase = 'dice';
  room.dice = new Map();
  io.to(room.code).emit('dice:begin', { room: publicRoom(room) });
}

function resolveDice(io, room) {
  const list = ids(room);
  const [a, b] = list.map((id) => room.dice.get(id));
  if (a === b) {
    room.dice = new Map();
    return io.to(room.code).emit('dice:tie', { rolls: {} });
  }
  const winnerId = room.dice.get(list[0]) > room.dice.get(list[1]) ? list[0] : list[1];
  room.starter = list.indexOf(winnerId);
  io.to(room.code).emit('dice:winner', { starterId: winnerId, rolls: Object.fromEntries(room.dice) });
  // Kisa gecikme istemci animasyonu icin; ama sunucu turu hemen hazirlar.
  setTimeout(() => {
    if (room.mode === 'compare') startCompareRound(io, room, true);
    else if (room.mode === 'squad') startSquadRound(io, room, true);
  }, 1400);
}

// ================= CLOSEST (mevcut) =================
async function startClosestRound(io, room) {
  let picked;
  try {
    picked = await pickRandomGamePlayer();
  } catch {
    picked = null;
  }
  if (!picked) return io.to(room.code).emit('game:error', { message: 'Oyuncu getirilemedi.' });
  room.current = picked;
  room.activeRow = 0;
  room.guesses.clear();
  room.phase = 'playing';
  io.to(room.code).emit('game:round', {
    player: { name: picked.name, portraitUrl: picked.portraitUrl },
    rows: rowsMeta,
    activeRow: 0,
    room: publicRoom(room),
    scores: scoreMap(room),
  });
}

function revealClosestRow(io, room) {
  const row = GAME_ROWS[room.activeRow];
  const truth = row.value(room.current.answers);
  const guesses = Object.fromEntries(room.guesses);
  let winners = [];
  let truthText = 'veri yok';
  if (truth != null) {
    truthText = row.format(truth, room.current.answers);
    const diffs = ids(room).map((id) => ({
      id,
      diff: room.guesses.get(id) == null ? Infinity : Math.abs(room.guesses.get(id) - truth),
    }));
    const best = Math.min(...diffs.map((d) => d.diff));
    if (best !== Infinity) {
      winners = diffs.filter((d) => d.diff === best).map((d) => d.id);
      for (const id of winners) room.players.get(id).score += 1;
    }
  }
  io.to(room.code).emit('row:result', {
    rowIndex: room.activeRow,
    truthText,
    truthValue: truth,
    guesses,
    winners,
    scores: scoreMap(room),
  });
  room.activeRow += 1;
  room.guesses.clear();
  if (room.activeRow < GAME_ROWS.length) io.to(room.code).emit('row:active', { activeRow: room.activeRow });
  else {
    room.phase = 'ended';
    io.to(room.code).emit('round:end', { scores: scoreMap(room) });
  }
}

// ================= COMPARE (Kariyer Kiyasi) =================
async function startCompareRound(io, room, firstRound = false) {
  const [player] = await players()
    .aggregate([{ $match: poolFilter('famous') }, { $sample: { size: 1 } }])
    .toArray();
  if (!player) return io.to(room.code).emit('game:error', { message: 'Oyuncu bulunamadı.' });

  if (!firstRound) room.starter ^= 1; // her yeni oyuncuda baslayan degisir
  room.current = { id: player._id, name: player.name, portraitUrl: player.portraitUrl, values: compareValues(player) };
  room.activeRow = 0;
  room.rowGuesses = new Map();
  room.turn = room.starter;
  room.phase = 'playing';

  io.to(room.code).emit('compare:round', {
    player: { name: player.name, portraitUrl: player.portraitUrl },
    rows: COMPARE_ROWS,
    activeRow: 0,
    turnId: currentTurnId(room),
    starterId: currentTurnId(room),
    room: publicRoom(room),
    scores: scoreMap(room),
  });
}

async function compareGuess(io, room, sid, playerId) {
  const id = Number(playerId);
  if (!Number.isFinite(id)) return;
  if (room.usedIds.has(id)) return io.to(sid).emit('game:error', { message: 'Bu oyuncu kullanıldı.' });
  if (room.rowGuesses.has(sid)) return;

  let doc;
  try {
    doc = await ensurePlayer(id);
  } catch {
    doc = null;
  }
  if (!doc) return io.to(sid).emit('game:error', { message: 'Oyuncu getirilemedi.' });

  room.usedIds.add(id);
  room.rowGuesses.set(sid, { id, name: doc.name, values: compareValues(doc) });
  io.to(room.code).emit('compare:guessed', { by: sid, name: doc.name });

  if (room.rowGuesses.size >= room.players.size) {
    revealCompareRow(io, room);
  } else {
    room.turn ^= 1; // sira digerine
    io.to(room.code).emit('compare:turn', { turnId: currentTurnId(room) });
  }
}

// compareValues nesnesi satir anahtariyla ayni; deger = values[key].
const compareRowValue = (values, key) => (values ? values[key] ?? null : null);
function compareRowFormat(key, v) {
  if (v == null) return 'veri yok';
  if (key === 'marketValue') {
    const m = v / 1_000_000;
    return `€${m.toFixed(m < 10 ? 1 : 0).replace('.', ',')}M`;
  }
  if (key === 'heightCm') return `${v} cm`;
  return `${v}`;
}

function revealCompareRow(io, room) {
  const row = COMPARE_ROWS[room.activeRow];
  const target = compareRowValue(room.current.values, row.key);
  const list = ids(room);

  const guessesOut = {};
  let winners = [];
  if (target != null) {
    const diffs = list.map((pid) => {
      const g = room.rowGuesses.get(pid);
      const v = g ? compareRowValue(g.values, row.key) : null;
      guessesOut[pid] = { name: g?.name ?? '-', value: v };
      return { pid, diff: v == null ? Infinity : Math.abs(v - target) };
    });
    const best = Math.min(...diffs.map((d) => d.diff));
    if (best !== Infinity) {
      winners = diffs.filter((d) => d.diff === best).map((d) => d.pid);
      for (const pid of winners) room.players.get(pid).score += 1;
    }
  } else {
    for (const pid of list) guessesOut[pid] = { name: room.rowGuesses.get(pid)?.name ?? '-', value: null };
  }

  io.to(room.code).emit('compare:result', {
    rowIndex: room.activeRow,
    key: row.key,
    truthText: compareRowFormat(row.key, target),
    truthValue: target,
    guesses: guessesOut,
    winners,
    scores: scoreMap(room),
  });

  room.activeRow += 1;
  room.rowGuesses = new Map();
  if (room.activeRow < COMPARE_ROWS.length) {
    room.turn = room.starter ^ (room.activeRow % 2); // her satirda baslayan degisir
    io.to(room.code).emit('compare:active', { activeRow: room.activeRow, turnId: currentTurnId(room) });
  } else {
    room.phase = 'ended';
    io.to(room.code).emit('compare:over', { scores: scoreMap(room) });
  }
}

// ================= SQUAD (Milli Kadro) =================
async function startSquadRound(io, room, firstRound = false) {
  if (firstRound) {
    // ilk tur: kadrolari sifirla
    room.slots = new Map(ids(room).map((id) => [id, FORMATION.map((f) => ({ pos: f.pos, filled: false, player: null }))]));
    room.usedCountries = new Set();
    room.round = 0;
  } else {
    room.starter ^= 1;
  }

  let country;
  try {
    const eligible = (await listCountries()).filter((c) => !room.usedCountries.has(c.country));
    country = eligible.length ? eligible[Math.floor(Math.random() * eligible.length)] : await randomCountry();
  } catch {
    country = null;
  }
  if (!country) return io.to(room.code).emit('game:error', { message: 'Ülke bulunamadı.' });

  room.country = country;
  room.usedCountries.add(country.country);
  room.round += 1;
  room.placed = new Map(ids(room).map((id) => [id, false]));
  room.turn = room.starter;
  room.phase = 'playing';

  io.to(room.code).emit('squad:round', {
    country,
    formation: FORMATION,
    round: room.round,
    turnId: currentTurnId(room),
    slots: publicSlots(room),
    scores: scoreMap(room),
    room: publicRoom(room),
  });
}

const publicSlots = (room) =>
  Object.fromEntries(
    [...room.slots.entries()].map(([id, arr]) => [
      id,
      arr.map((s) => ({ pos: s.pos, filled: s.filled, player: s.player })),
    ]),
  );

async function squadPlace(io, room, sid, playerId, slotIdx) {
  const id = Number(playerId);
  if (!Number.isFinite(id)) return;
  if (room.placed.get(sid)) return;
  if (room.usedIds.has(id)) return io.to(sid).emit('game:error', { message: 'Bu oyuncu kullanıldı.' });

  let doc;
  try {
    doc = await ensurePlayer(id);
  } catch {
    doc = null;
  }
  if (!doc) return io.to(sid).emit('game:error', { message: 'Oyuncu getirilemedi.' });

  const caps = await nationalCaps(doc, room.country.country);
  if (caps < 1) return io.to(sid).emit('game:error', { message: 'Bu oyuncu bu ülke için uygun değil.' });
  const slot = slotOf(doc.position?.name);
  const myslots = room.slots.get(sid);

  // Hedef slot (tiklanan) uygun mu; degilse ayni bolgede bos slot bul.
  let idx = Number(slotIdx);
  if (!Number.isInteger(idx) || !myslots[idx] || myslots[idx].filled || myslots[idx].pos !== slot) {
    idx = myslots.findIndex((s) => !s.filled && s.pos === slot);
  }
  if (idx < 0) return io.to(sid).emit('game:error', { message: 'Bu mevki için boş yer yok.' });

  myslots[idx] = { pos: myslots[idx].pos, filled: true, player: { id, name: doc.name, caps, portraitUrl: doc.portraitUrl } };
  room.usedIds.add(id);
  room.players.get(sid).score += caps;
  room.placed.set(sid, true);

  io.to(room.code).emit('squad:placed', {
    by: sid,
    slotIdx: idx,
    player: { id, name: doc.name, caps, portraitUrl: doc.portraitUrl },
    slots: publicSlots(room),
    scores: scoreMap(room),
  });

  const other = otherId(room, sid);
  if (!room.placed.get(other)) {
    room.turn ^= 1;
    return io.to(room.code).emit('squad:turn', { turnId: currentTurnId(room) });
  }

  // Iki taraf da yerlestirdi.
  const full = [...room.slots.values()].every((arr) => arr.every((s) => s.filled));
  if (full) {
    room.phase = 'ended';
    io.to(room.code).emit('squad:over', { scores: scoreMap(room) });
  } else {
    io.to(room.code).emit('squad:round-done', { scores: scoreMap(room) });
  }
}
