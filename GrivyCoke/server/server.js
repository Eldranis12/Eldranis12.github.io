// ============================================================
// Server multiplayer — Coke Hangout (Nongkrong) Tetris
// ------------------------------------------------------------
// Model sesuai "Kebutuhan dari Grivy" (12 Jul 2026): TIDAK real-time.
// Tiap pemain main di papan sendiri di HP masing-masing. Server hanya:
//   1. Waiting room — kelompokkan pemain lewat whats_app_session_id yang
//      sama (maks 4), hitung window tunggu (default 15 dtk).
//   2. Kumpulkan skor akhir tiap pemain, hasilkan ranking.
//
// Aturan mode (Bagian 5 dokumen): mulai jika semua slot penuh ATAU window
// habis; >1 pemain -> multiplayer, 1 pemain -> single player.
//
// Zero dependency: cukup `node server.js` (Node 18+). Store in-memory —
// data sesi bersifat sementara (TY page saja); leaderboard mingguan
// berhadiah dikelola Kiosk Vendor, bukan server ini.
// ============================================================

'use strict';
const http = require('http');

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
/** @type {Map<string, Session>} */
const sessions = new Map();

function createSession(id) {
  const now = Date.now();
  const s = {
    id,
    phase: 'waiting',                 // waiting | playing | ended
    createdAt: now,
    deadline: now + WINDOW_MS,        // batas window tunggu
    players: new Map(),               // user_id -> player
    roster: null,                     // array user_id (dibekukan saat mulai)
    mode: null,                       // single | multi
    playDeadline: null,               // batas kumpul skor
    endedAt: null,
  };
  sessions.set(id, s);
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
      return { user_id: uid, nickname: p.nickname, score: p.score ?? 0,
               submitted: !!p.submitted };
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const u = new URL(req.url, `http://${req.headers.host}`);
  const path = u.pathname.replace(/\/+$/, '') || '/';

  try {
    // --- health ---
    if (req.method === 'GET' && path === '/health') {
      return send(res, 200, { ok: true, sessions: sessions.size, uptime: process.uptime() });
    }

    // --- join: pemain masuk sesi (dipanggil saat game di HP dibuka) ---
    if (req.method === 'POST' && path === '/session/join') {
      const b = await readBody(req);
      const sid = b.whats_app_session_id, uid = b.user_id;
      if (!sid || !uid) return send(res, 400, { error: 'whats_app_session_id & user_id wajib' });

      let s = sessions.get(sid);
      if (!s) s = createSession(sid);
      advance(s);

      if (s.phase === 'waiting') {
        if (!s.players.has(uid) && s.players.size < MAX_PLAYERS) {
          s.players.set(uid, {
            user_id: uid,
            nickname: String(b.nickname || 'Player').slice(0, 40),
            device_id: b.device_id || '',
            score: null,
            submitted: false,
            joinedAt: Date.now(),
          });
          // rolling window (permintaan klien): tiap pemain BARU join, buka lagi
          // window penuh supaya teman yang menyusul sempat masuk.
          s.deadline = Date.now() + WINDOW_MS;
        } else if (s.players.has(uid)) {
          // re-join (reload HP): perbarui nickname; jangan gandakan / reset window
          s.players.get(uid).nickname = String(b.nickname || s.players.get(uid).nickname).slice(0, 40);
        }
        // slot penuh -> mulai sekarang (tidak menunggu sisa window)
        if (s.players.size >= MAX_PLAYERS) s.deadline = Date.now();
        advance(s);
        return send(res, 200, publicState(s));
      }

      // sesi sudah jalan/selesai: pemain yang sudah di roster boleh lanjut,
      // pendatang telat main sendiri (single) di sesi baru terpisah.
      if (s.roster && s.roster.includes(uid)) return send(res, 200, publicState(s));
      const solo = createSession(`${sid}#solo-${uid}`);
      solo.players.set(uid, { user_id: uid, nickname: String(b.nickname || 'Player').slice(0, 40),
        device_id: b.device_id || '', score: null, submitted: false, joinedAt: Date.now() });
      solo.deadline = Date.now();
      advance(solo);
      return send(res, 200, { ...publicState(solo), late: true });
    }

    // --- state: polling waiting room ---
    if (req.method === 'GET' && path === '/session/state') {
      const sid = u.searchParams.get('whats_app_session_id');
      const uid = u.searchParams.get('user_id');
      const s = sessions.get(sid) || (uid && sessions.get(`${sid}#solo-${uid}`));
      if (!s) return send(res, 404, { error: 'sesi tidak ditemukan' });
      advance(s);
      return send(res, 200, publicState(s));
    }

    // --- score: kirim skor akhir ---
    if (req.method === 'POST' && path === '/session/score') {
      const b = await readBody(req);
      const sid = b.whats_app_session_id, uid = b.user_id;
      if (!sid || !uid) return send(res, 400, { error: 'whats_app_session_id & user_id wajib' });
      const s = sessions.get(sid) || sessions.get(`${sid}#solo-${uid}`);
      if (!s) return send(res, 404, { error: 'sesi tidak ditemukan' });
      advance(s);
      const p = s.players.get(uid);
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
      const sid = u.searchParams.get('whats_app_session_id');
      const uid = u.searchParams.get('user_id');
      const s = sessions.get(sid) || (uid && sessions.get(`${sid}#solo-${uid}`));
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
    if (stale) sessions.delete(id);
  }
}, 60_000).unref();

server.listen(PORT, () => {
  console.log(`[mp] server jalan di :${PORT}  (window ${WINDOW_MS / 1000}s, max ${MAX_PLAYERS}, game ${GAME_MS / 1000}s)`);
});

module.exports = { server, sessions }; // untuk test
