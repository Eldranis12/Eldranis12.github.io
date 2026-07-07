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

export function notifyGameStart(sessionId) {
  return post(CONFIG.kioskStartUrl, {
    event: 'game_start',
    session_id: sessionId,
    device_id: PLAYER.deviceId,
    timestamp: new Date().toISOString(),
  });
}

export function notifyGameEnd(sessionId, results) {
  // results: [{ nickname, score }]
  return post(CONFIG.kioskEndUrl, {
    event: 'game_end',
    session_id: sessionId,
    device_id: PLAYER.deviceId,
    completed: true,
    results,
    timestamp: new Date().toISOString(),
  });
}
