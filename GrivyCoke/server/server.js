// ============================================================
// Server multiplayer — Coke Hangout (Nongkrong) Tetris
// ------------------------------------------------------------
// Model sesuai klarifikasi Grivy (Jul 2026): TIDAK real-time, dan Grivy
// TIDAK punya konsep "game session". GAME (server ini) yang mengelola sesi.
//
// Pengelompokan pemain = per KIOSK (device_id) + window bergulir:
//   - Pemain masuk kode di kiosk satu per satu (berurutan). Tiap pemain
//     yang join ke device_id yang sama dalam window 15 dtk = satu sesi game.
//   - Tiap pemain BARU join -> window dibuka lagi 15 dtk (rolling), maks 4.
//   - Window habis / slot penuh -> mulai. >1 pemain = multi, 1 = single.
//   - Setelah sesi sebuah kiosk mulai, join berikutnya ke kiosk itu -> sesi
//     BARU (kiosk dipakai berulang sepanjang hari).
//
// whats_app_session_id BUKAN kunci grup — itu identitas per-user (1:1 dgn
// user), hanya disimpan sebagai konteks. Server yang MEMBUAT session_id dan
// mengembalikannya saat join; klien memakai session_id itu untuk polling.
//
// Zero dependency: cukup `node server.js` (Node 18+). Store in-memory.
// ============================================================

'use strict';
const http = require('http');
const crypto = require('crypto');

const PORT        = parseInt(process.env.PORT || '8787', 10);
const WINDOW_MS   = parseInt(process.env.JOIN_WINDOW_SECONDS || '15', 10) * 1000;
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || '4', 10);
const GAME_MS     = parseInt(process.env.GAME_SECONDS || '180', 10) * 1000;
// grace setelah durasi game untuk menunggu skor pemain yang HP-nya lambat/tutup
const RESULT_GRACE_MS = parseInt(process.env.RESULT_GRACE_SECONDS || '25', 10) * 1000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
// sesi dibersihkan dari memori sekian lama setelah selesai
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_SECONDS || '300', 10) * 1000;

// ---------- store ----------
const sessions = new Map();       // session_id -> session
const deviceActive = new Map();   // device_key -> session_id sesi yang SEDANG membentuk/berjalan

const newId = () => crypto.randomBytes(6).toString('hex');
// kunci grup: device_id (kiosk). Tanpa kiosk (uji tanpa device) -> solo per user.
const deviceKeyOf = (deviceId, uid) => deviceId ? `dev:${deviceId}` : `u:${uid}`;

function createSession(deviceKey) {
  const now = Date.now();
  const s = {
    id: newId(),
    device: deviceKey,
    phase: 'waiting',                 // waiting | playing | ended
    createdAt: now,
    deadline: now + WINDOW_MS,        // batas window tunggu
    players: new Map(),               // user_id -> player
    roster: null,                     // array user_id (dibekukan saat mulai)
    mode: null,                       // single | multi
    playDeadline: null,               // batas kumpul skor
    endedAt: null,
  };
  sessions.set(s.id, s);
  deviceActive.set(deviceKey, s.id);  // jadi sesi "membentuk" untuk kiosk ini
  return s;
}

// Transisi fase dihitung lazily tiap request (tanpa timer per-sesi).
function advance(s) {
  const now = Date.now();
  if (s.phase === 'waiting' && now >= s.deadline) {
    s.phase = 'playing';
    s.roster = [...s.players.keys()];
    s.mode = s.roster.length > 1 ? 'multi' : 'single';
    s.playDeadline = now + GAME_MS + RESULT_GRACE_MS;
  }
  if (s.phase === 'playing') {
    const allIn = s.roster.length > 0 &&
      s.roster.every(uid => s.players.get(uid)?.submitted);
    if (allIn || now >= s.playDeadline) {
      s.phase = 'ended';
      s.endedAt = now;
    }
  }
}

// Snapshot yang aman dikirim ke klien.
function publicState(s) {
  const now = Date.now();
  const list = (s.phase === 'waiting' ? [...s.players.keys()] : s.roster || [])
    .map(uid => {
      const p = s.players.get(uid);
      return { user_id: uid, nickname: p ? p.nickname : 'Player' };
    });
  return {
    session_id: s.id,
    phase: s.phase,
    // saat waiting mode belum final (bisa berubah kalau ada yang join);
    // provisional dari jumlah pemain sekarang.
    mode: s.mode || (s.players.size > 1 ? 'multi' : 'single'),
    final_mode: s.mode,                       // null selama waiting
    count: list.length,
    max: MAX_PLAYERS,
    players: list,
    ms_left: s.phase === 'waiting' ? Math.max(0, s.deadline - now) : 0,
    window_ms: WINDOW_MS,
  };
}

function resultsPayload(s) {
  const rows = (s.roster || [...s.players.keys()])
    .map(uid => {
      const p = s.players.get(uid);
      return { user_id: uid, nickname: p.nickname,
               whats_app_session_id: p.whatsAppSessionId || '',
               score: p.score ?? 0, submitted: !!p.submitted };
    })
    .sort((a, b) => b.score - a.score);
  return { session_id: s.id, mode: s.mode, ready: s.phase === 'ended', results: rows };
}

// ---------- HTTP ----------
function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 1e4) reject(new Error('payload too large')); // guard
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

const clip = s => String(s || 'Player').slice(0, 40);

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const u = new URL(req.url, `http://${req.headers.host}`);
  const path = u.pathname.replace(/\/+$/, '') || '/';

  try {
    // --- health ---
    if (req.method === 'GET' && path === '/health') {
      return send(res, 200, { ok: true, sessions: sessions.size, uptime: process.uptime() });
    }

    // --- join: pemain masuk (dipanggil saat game di HP dibuka) ---
    // Grup per device_id (kiosk); server yang menentukan session_id.
    if (req.method === 'POST' && path === '/session/join') {
      const b = await readBody(req);
      const uid = b.user_id;
      if (!uid) return send(res, 400, { error: 'user_id wajib' });

      const key = deviceKeyOf(b.device_id, uid);
      // ambil sesi yang sedang membentuk untuk kiosk ini
      let s = null;
      const activeId = deviceActive.get(key);
      if (activeId) { s = sessions.get(activeId); if (s) advance(s); }
      // tidak ada sesi waiting untuk kiosk ini (belum ada / yg lama sudah mulai)
      // -> buka sesi BARU (kiosk dipakai berurutan sepanjang hari)
      if (!s || s.phase !== 'waiting') s = createSession(key);

      if (!s.players.has(uid) && s.players.size < MAX_PLAYERS) {
        s.players.set(uid, {
          user_id: uid,
          nickname: clip(b.nickname),
          device_id: b.device_id || '',
          whatsAppSessionId: b.whats_app_session_id || '',
          score: null,
          submitted: false,
          joinedAt: Date.now(),
        });
        // rolling window: tiap pemain BARU join, buka lagi window penuh
        s.deadline = Date.now() + WINDOW_MS;
      } else if (s.players.has(uid)) {
        // re-join (reload HP): perbarui nickname; jangan gandakan / reset window
        s.players.get(uid).nickname = clip(b.nickname || s.players.get(uid).nickname);
      }
      // slot penuh -> mulai sekarang (tidak menunggu sisa window)
      if (s.players.size >= MAX_PLAYERS) s.deadline = Date.now();
      advance(s);
      return send(res, 200, publicState(s));
    }

    // --- state: polling waiting room (pakai session_id dari /join) ---
    if (req.method === 'GET' && path === '/session/state') {
      const s = sessions.get(u.searchParams.get('session_id'));
      if (!s) return send(res, 404, { error: 'sesi tidak ditemukan' });
      advance(s);
      return send(res, 200, publicState(s));
    }

    // --- score: kirim skor akhir ---
    if (req.method === 'POST' && path === '/session/score') {
      const b = await readBody(req);
      const s = sessions.get(b.session_id);
      if (!s) return send(res, 404, { error: 'sesi tidak ditemukan' });
      advance(s);
      const p = s.players.get(b.user_id);
      if (!p) return send(res, 404, { error: 'pemain tidak ada di sesi' });
      if (!p.submitted) {                       // skor pertama = final (anti timpa)
        p.score = Math.max(0, parseInt(b.score, 10) || 0);
        p.submitted = true;
      }
      advance(s);
      return send(res, 200, { ok: true, ready: s.phase === 'ended' });
    }

    // --- results: polling ranking akhir ---
    if (req.method === 'GET' && path === '/session/results') {
      const s = sessions.get(u.searchParams.get('session_id'));
      if (!s) return send(res, 404, { error: 'sesi tidak ditemukan' });
      advance(s);
      return send(res, 200, resultsPayload(s));
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    return send(res, 400, { error: err.message || 'bad request' });
  }
});

// bersihkan sesi lama supaya memori tidak menumpuk (aktivasi jangka panjang)
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const stale = (s.phase === 'ended' && s.endedAt && now - s.endedAt > SESSION_TTL_MS) ||
                  (now - s.createdAt > SESSION_TTL_MS + GAME_MS + WINDOW_MS);
    if (stale) {
      sessions.delete(id);
      if (deviceActive.get(s.device) === id) deviceActive.delete(s.device);
    }
  }
}, 60_000).unref();

server.listen(PORT, () => {
  console.log(`[mp] server jalan di :${PORT}  (window ${WINDOW_MS / 1000}s, max ${MAX_PLAYERS}, game ${GAME_MS / 1000}s)`);
});

module.exports = { server, sessions, deviceActive }; // untuk test
