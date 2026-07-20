// ============================================================
// SessionService — jembatan game <-> server multiplayer.
// ------------------------------------------------------------
// Dua mode di balik satu interface:
//   • REMOTE — CONFIG.multiplayerUrl + user_id ada. Join ke server; server
//     mengelompokkan pemain per device_id (kiosk) + window bergulir, lalu
//     MENGEMBALIKAN session_id. Klien polling waiting room + ranking pakai
//     session_id itu.
//   • LOCAL  — tidak ada server/parameter. Game jalan single player (fallback
//     aman), atau simulasi pemain lain lewat ?others= untuk demo TY page.
//
// Pengelompokan (klarifikasi Grivy): whats_app_session_id BUKAN kunci grup —
// itu per-user. Grup = device_id (kiosk) + join dalam window 15 dtk. Model
// TIDAK real-time: papan tiap pemain independen; server hanya mengelompokkan
// + mengumpulkan skor akhir.
// ============================================================

import { CONFIG, PLAYER } from './config.js';

const POLL_MS = 1000;
const RESULT_POLL_MS = 2000;   // polling ranking (update hidup) lebih santai
const sleep = ms => new Promise(r => setTimeout(r, ms));

function jget(url) {
  return fetch(url, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}
function jpost(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

// ---------- REMOTE ----------
class RemoteSession {
  constructor(base) {
    this.base = base;
    this.remote = true;
    this.mode = 'single';
    this._sessionId = null;                    // ditentukan server saat join
    this._q = {
      device_id: PLAYER.deviceId,              // kunci grup (kiosk)
      user_id: PLAYER.userId,
      nickname: PLAYER.nickname,
      whats_app_session_id: PLAYER.whatsAppSessionId, // konteks per-user saja
    };
  }

  get sessionId() { return this._sessionId; }

  async join() {
    const r = await jpost(this.base + '/session/join', this._q);
    this._sessionId = r.session_id;            // dipakai untuk polling berikutnya
  }

  // Polling waiting room sampai fase 'playing'. onTick(state) dipanggil tiap
  // poll untuk update overlay. Resolve {mode, players}.
  async waitForStart(onTick) {
    for (;;) {
      const st = await jget(`${this.base}/session/state?session_id=${encodeURIComponent(this._sessionId)}`);
      onTick && onTick(st);
      if (st.phase !== 'waiting') {
        this.mode = st.final_mode || st.mode || 'single';
        this._players = st.players || [];
        return { mode: this.mode, players: this._players };
      }
      await sleep(POLL_MS);
    }
  }

  submitScore(score) {
    return jpost(this.base + '/session/score',
      { session_id: this._sessionId, user_id: this._q.user_id, score }).catch(() => {});
  }

  // Polling ranking dengan UPDATE HIDUP: onUpdate(rows, ready) dipanggil tiap
  // poll sampai server bilang ready (semua submit / grace habis) atau timeout.
  // Ini yang bikin skor pemain yang selesai belakangan muncul di TY page pemain
  // yang selesai duluan (tanpa tampak "nyangkut").
  async watchResults(onUpdate, timeoutMs) {
    // default: tunggu sampai game pasti berakhir (durasi + grace) + buffer
    const cap = timeoutMs ?? (CONFIG.gameSeconds * 1000 + 30000);
    const until = Date.now() + cap;
    let rows = [];
    for (;;) {
      let data = null;
      try { data = await jget(`${this.base}/session/results?session_id=${encodeURIComponent(this._sessionId)}`); } catch {}
      if (data && data.results) {
        rows = data.results.map(r => ({ nickname: r.nickname, score: r.score,
          me: r.user_id === this._q.user_id, submitted: r.submitted }));
        onUpdate(rows, !!data.ready);
        if (data.ready) return rows;
      }
      if (Date.now() > until) return rows;
      await sleep(RESULT_POLL_MS);
    }
  }
}

// ---------- LOCAL (tanpa server) ----------
class LocalSession {
  constructor() {
    this.remote = false;
    this.others = CONFIG.mockOthers || [];
    this.mode = this.others.length > 0 ? 'multi' : 'single';
    this._score = 0;
  }

  get sessionId() { return null; }

  async join() {}

  async waitForStart(onTick) {
    // simulasi countdown overlay hanya kalau ?wait= diaktifkan (demo)
    const total = CONFIG.waitWindowMs;
    const players = [{ user_id: PLAYER.userId, nickname: PLAYER.nickname },
                     ...this.others.map((o, i) => ({ user_id: 'mock' + i, nickname: o.nickname }))];
    if (total > 0) {
      const start = Date.now();
      let msLeft;
      do {
        msLeft = Math.max(0, total - (Date.now() - start));
        onTick && onTick({ count: players.length, max: CONFIG.maxPlayers, players, ms_left: msLeft,
                           mode: this.mode, phase: 'waiting' });
        if (msLeft > 0) await sleep(Math.min(POLL_MS, msLeft));
      } while (msLeft > 0);
    }
    return { mode: this.mode, players };
  }

  async submitScore(score) { this._score = score; }

  async watchResults(onUpdate) {
    const rows = [{ nickname: PLAYER.nickname, score: this._score, me: true, submitted: true },
      ...this.others.map(o => ({ nickname: o.nickname, score: o.score, me: false, submitted: true }))]
      .sort((a, b) => b.score - a.score);
    onUpdate(rows, true);   // lokal: langsung final
    return rows;
  }
}

// Pilih implementasi: remote kalau ada URL server + user_id. Grup ditentukan
// server via device_id (kiosk); tanpa device_id -> server buat sesi solo.
export function createSession() {
  const canRemote = CONFIG.multiplayerUrl && PLAYER.userId;
  return canRemote ? new RemoteSession(CONFIG.multiplayerUrl) : new LocalSession();
}
