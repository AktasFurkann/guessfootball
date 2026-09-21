import { Server } from 'socket.io';
import { GAME_ROWS, rowsMeta } from './game/rows.js';
import { pickRandomGamePlayer } from './game/roundData.js';

/**
 * Online "En Yakin Tahmin": oda tabanli, iki oyunculu, sunucu-otoriter motor.
 *
 * Sunucu dogru cevaplari tutar; iki oyuncu da satiri tahmin edince kazanani
 * hesaplayip iki ekrani senkronlar. Odalar bellekte tutulur (tek surumlu
 * ucretsiz barindirma icin yeterli).
 */

const MAX_PLAYERS = 2;

/** code -> room */
const rooms = new Map();

function generateCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

/** Istemciye gonderilecek guvenli oda ozeti (cevap icermez). */
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: [...room.players.entries()].map(([id, p]) => ({
      id,
      name: p.name,
      score: p.score,
    })),
  };
}

function scoreMap(room) {
  return Object.fromEntries([...room.players.entries()].map(([id, p]) => [id, p.score]));
}

function sanitizeName(name, fallback) {
  const clean = String(name ?? '').trim().slice(0, 12);
  return clean || fallback;
}

export function attachRealtime(httpServer) {
  const io = new Server(httpServer);

  io.on('connection', (socket) => {
    // --- ODA KUR ---
    socket.on('room:create', ({ name } = {}, ack) => {
      leaveCurrentRoom(socket);
      const code = generateCode();
      const room = {
        code,
        hostId: socket.id,
        players: new Map(),
        phase: 'lobby',
        current: null,
        activeRow: 0,
        guesses: new Map(),
      };
      room.players.set(socket.id, { name: sanitizeName(name, 'Oyuncu 1'), score: 0 });
      rooms.set(code, room);
      socket.data.roomCode = code;
      socket.join(code);

      ack?.({ ok: true, code, youId: socket.id });
      io.to(code).emit('room:update', publicRoom(room));
    });

    // --- ODAYA KATIL ---
    socket.on('room:join', ({ code, name } = {}, ack) => {
      const room = rooms.get(String(code || '').trim());
      if (!room) return ack?.({ ok: false, error: 'Böyle bir oda yok.' });
      if (room.phase !== 'lobby') return ack?.({ ok: false, error: 'Oyun çoktan başlamış.' });
      if (room.players.size >= MAX_PLAYERS) return ack?.({ ok: false, error: 'Oda dolu.' });

      leaveCurrentRoom(socket);
      room.players.set(socket.id, { name: sanitizeName(name, 'Oyuncu 2'), score: 0 });
      socket.data.roomCode = room.code;
      socket.join(room.code);

      ack?.({ ok: true, code: room.code, youId: socket.id });
      io.to(room.code).emit('room:update', publicRoom(room));
    });

    // --- OYUNU BASLAT (sadece host) ---
    socket.on('game:start', async () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostId !== socket.id) return;
      if (room.players.size < MAX_PLAYERS) {
        return socket.emit('game:error', { message: 'Rakip bekleniyor.' });
      }
      await startRound(io, room);
    });

    // --- TAHMIN GONDER ---
    socket.on('row:guess', ({ value } = {}) => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.phase !== 'playing') return;
      if (!room.players.has(socket.id)) return;
      if (room.guesses.has(socket.id)) return; // bu satirda zaten gonderdi

      const parsed = Number(String(value).replace(',', '.'));
      room.guesses.set(socket.id, Number.isFinite(parsed) ? parsed : null);

      io.to(room.code).emit('row:progress', { submitted: [...room.guesses.keys()] });

      if (room.guesses.size >= room.players.size) revealRow(io, room);
    });

    // --- SONRAKI OYUNCU (sadece host) ---
    socket.on('game:next', async () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || room.hostId !== socket.id) return;
      await startRound(io, room);
    });

    // --- ODADAN AYRIL / BAGLANTI KOPMASI ---
    socket.on('room:leave', () => leaveCurrentRoom(socket));
    socket.on('disconnect', () => leaveCurrentRoom(socket));
  });

  /** Soketi bulundugu odadan cikarir ve rakibi bilgilendirir. */
  function leaveCurrentRoom(socket) {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    socket.data.roomCode = null;
    socket.leave(code);
    if (!room) return;

    room.players.delete(socket.id);

    if (room.players.size === 0) {
      rooms.delete(code);
      return;
    }

    // Host ayrildiysa kalan oyuncu host olur.
    if (room.hostId === socket.id) {
      room.hostId = [...room.players.keys()][0];
    }
    // Oyun ortasinda biri cikarsa lobiye don.
    room.phase = 'lobby';
    room.current = null;
    room.guesses.clear();
    io.to(code).emit('opponent:left', publicRoom(room));
  }

  return io;
}

/** Yeni oyuncu (futbolcu) sec ve iki istemciye de dagit. */
async function startRound(io, room) {
  let picked;
  try {
    picked = await pickRandomGamePlayer();
  } catch {
    picked = null;
  }
  if (!picked) {
    return io.to(room.code).emit('game:error', { message: 'Oyuncu getirilemedi.' });
  }

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

/** Aktif satiri acar, kazanani hesaplar, skoru gunceller, senkronlar. */
function revealRow(io, room) {
  const row = GAME_ROWS[room.activeRow];
  const truth = row.value(room.current.answers);
  const guesses = Object.fromEntries(room.guesses);

  let winners = [];
  let truthText = 'veri yok';

  if (truth != null) {
    truthText = row.format(truth, room.current.answers);
    const diffs = [...room.players.keys()].map((id) => ({
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
    // Fark hesabi icin sayisal dogru deger (tahminlerle ayni birimde).
    truthValue: truth,
    guesses,
    winners,
    scores: scoreMap(room),
  });

  room.activeRow += 1;
  room.guesses.clear();

  if (room.activeRow < GAME_ROWS.length) {
    io.to(room.code).emit('row:active', { activeRow: room.activeRow });
  } else {
    room.phase = 'ended';
    io.to(room.code).emit('round:end', { scores: scoreMap(room) });
  }
}
