// ============================================================
// Integrasi kiosk vendor — stub.
// Endpoint, auth, dan skema payload menyusul dari kiosk vendor;
// sesuaikan body di bawah begitu detailnya tersedia.
// ============================================================

import { CONFIG, PLAYER } from './config.js';

async function post(urlStr, payload) {
  if (!urlStr) {
    console.log('[kiosk stub]', payload);
    return;
  }
  try {
    await fetch(urlStr, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[kiosk] gagal memanggil API:', err);
  }
}

// Kirim pesan ke parent window jika game berjalan di dalam iframe
function notifyParent(type, payload = {}) {
  try {
    if (typeof window !== 'undefined') {
      const msg = {
        source: 'coke_tetris',
        type,
        timestamp: new Date().toISOString(),
        ...payload,
      };
      // Jika di dalam iframe
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, '*');
      }
      // Jika dibuka via window.open()
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(msg, '*');
      }
    }
  } catch (err) {
    console.warn('[iframe message error]', err);
  }
}

export function notifyGameStart(sessionId) {
  notifyParent('GAME_START', {
    session_id: sessionId || '',
    device_id: PLAYER.deviceId,
    user_id: PLAYER.userId,
    nickname: PLAYER.nickname,
  });
  return post(CONFIG.kioskStartUrl, {
    event: 'game_start',
    session_id: sessionId,
    device_id: PLAYER.deviceId,
    timestamp: new Date().toISOString(),
  });
}

export function notifyScoreUpdate(sessionId, score) {
  notifyParent('SCORE_UPDATE', {
    session_id: sessionId || '',
    device_id: PLAYER.deviceId,
    user_id: PLAYER.userId,
    nickname: PLAYER.nickname,
    score: score || 0,
  });
}

export function notifyGameExit(sessionId, score) {
  notifyParent('GAME_CLOSED', {
    session_id: sessionId || '',
    device_id: PLAYER.deviceId,
    user_id: PLAYER.userId,
    nickname: PLAYER.nickname,
    score: score || 0,
  });
}

export function notifyGameEnd(sessionId, results) {
  // results: [{ nickname, score }]
  notifyParent('GAME_END', {
    session_id: sessionId || '',
    device_id: PLAYER.deviceId,
    user_id: PLAYER.userId,
    nickname: PLAYER.nickname,
    results: results || [],
  });
  return post(CONFIG.kioskEndUrl, {
    event: 'game_end',
    session_id: sessionId,
    device_id: PLAYER.deviceId,
    completed: true,
    results,
    timestamp: new Date().toISOString(),
  });
}
