// ============================================================
// Integrasi kiosk vendor — sisi klien.
// ------------------------------------------------------------
// PENTING (Kiosk Vendor Feedback, Q4): Game Start / Game End WAJIB dipanggil
// server-to-server. Kiosk vendor menolak `window.parent.postMessage` maupun
// `fetch` langsung dari browser pemain, karena API mereka tidak boleh bisa
// dipanggil dari klien — skor gampang dipalsukan lewat devtools.
//
// Karena itu file ini TIDAK lagi memanggil API kiosk. Panggilan resmi
// dilakukan backend: `server-php/kiosk.php` (dipicu saat sesi mulai dan saat
// sesi selesai). Yang tersisa di sini hanya sinyal postMessage untuk
// keperluan debug/embed lokal — sifatnya TIDAK otoritatif dan tidak boleh
// dijadikan sumber data kiosk.
// ============================================================

import { CONFIG, PLAYER } from './config.js';

// Sinyal debug ke parent window (hanya aktif dengan ?kiosk_debug=1).
function notifyParent(type, payload = {}) {
  if (!CONFIG.kioskDebug) return;
  try {
    if (typeof window === 'undefined') return;
    const msg = {
      source: 'coke_tetris',
      note: 'DEBUG ONLY — bukan sumber data kiosk (lihat Q4, server-to-server)',
      type,
      timestamp: new Date().toISOString(),
      ...payload,
    };
    if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
    if (window.opener && !window.opener.closed) window.opener.postMessage(msg, '*');
  } catch (err) {
    console.warn('[kiosk debug] gagal kirim postMessage:', err);
  }
}

const base = sessionId => ({
  game_session_id: sessionId || '',      // id sesi buatan backend game
  kiosk_id: PLAYER.deviceId,             // = device_id
  user_uid: PLAYER.userId,
  wa_session_id: PLAYER.waSessionId,
  nickname: PLAYER.nicknameNormalized || PLAYER.nickname,
  nickname_entered: PLAYER.nickname,
});

export function notifyGameStart(sessionId) {
  notifyParent('GAME_START', base(sessionId));
}

export function notifyScoreUpdate(sessionId, score) {
  notifyParent('SCORE_UPDATE', { ...base(sessionId), score: score || 0 });
}

export function notifyGameExit(sessionId, score) {
  notifyParent('GAME_CLOSED', { ...base(sessionId), score: score || 0 });
}

export function notifyGameEnd(sessionId, results) {
  notifyParent('GAME_END', { ...base(sessionId), results: results || [] });
}
