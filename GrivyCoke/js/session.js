// ============================================================
// SessionService — jembatan game <-> server multiplayer.
// ------------------------------------------------------------
// Dua mode di balik satu interface:
//   • REMOTE — CONFIG.multiplayerUrl diisi + ada whats_app_session_id &
//     user_id. Join sesi ke server (folder server/), polling waiting room,
//     kirim skor akhir, ambil ranking nyata.
//   • LOCAL  — tidak ada server/parameter. Game jalan single player (fallback
//     aman), atau simulasi pemain lain lewat ?others= untuk demo TY page.
//
// Aturan mode (dokumen Grivy Bagian 5): >1 pemain -> multi, 1 -> single.
// Model TIDAK real-time: papan tiap pemain independen; server hanya
// mengelompokkan + mengumpulkan skor akhir.
// ============================================================

import { CONFIG, PLAYER } from './config.js';

const POLL_MS = 1000;
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
    this._q = {
      whats_app_session_id: PLAYER.whatsAppSessionId,
      user_id: PLAYER.userId,
      nickname: PLAYER.nickname,
      device_id: PLAYER.deviceId,
    };
    this._joined = false;
  }

  async join() {
    await jpost(this.base + '/session/join', this._q);
    this._joined = true;
  }

  // Polling waiting room sampai fase 'playing'. onTick({count,max,players,msLeft})
  // dipanggil tiap poll untuk update overlay. Resolve {mode, players}.
  async waitForStart(onTick) {
    const qs = `whats_app_session_id=${encodeURIComponent(this._q.whats_app_session_id)}` +
               `&user_id=${encodeURIComponent(this._q.user_id)}`;
    for (;;) {
      const st = await jget(`${this.base}/session/state?${qs}`);
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
    return jpost(this.base + '/session/score', { ...this._q, score }).catch(() => {});
  }

  // Polling ranking sampai server bilang ready (semua submit / grace habis),
  // dibatasi timeoutMs supaya TY page tidak menggantung kalau ada HP tutup.
  async getResults(timeoutMs = 30000) {
    const qs = `whats_app_session_id=${encodeURIComponent(this._q.whats_app_session_id)}` +
               `&user_id=${encodeURIComponent(this._q.user_id)}`;
    const until = Date.now() + timeoutMs;
    let last = null;
    for (;;) {
      try {
        last = await jget(`${this.base}/session/results?${qs}`);
        if (last.ready || Date.now() > until) break;
      } catch { if (Date.now() > until) break; }
      await sleep(POLL_MS);
    }
    const rows = (last && last.results) || [];
    return rows.map(r => ({ nickname: r.nickname, score: r.score, me: r.user_id === this._q.user_id }));
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

  async getResults() {
    return [{ nickname: PLAYER.nickname, score: this._score, me: true },
            ...this.others.map(o => ({ nickname: o.nickname, score: o.score, me: false }))]
      .sort((a, b) => b.score - a.score);
  }
}

// Pilih implementasi: remote hanya kalau URL server + identitas pemain lengkap.
export function createSession() {
  const canRemote = CONFIG.multiplayerUrl && PLAYER.whatsAppSessionId && PLAYER.userId;
  return canRemote ? new RemoteSession(CONFIG.multiplayerUrl) : new LocalSession();
}
