// Integrasi test server multiplayer. Jalankan: node test.js
// Model: grup per device_id (kiosk) + window bergulir; server yang membuat
// session_id. Pakai window pendek supaya cepat.
'use strict';
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT: String(PORT), JOIN_WINDOW_SECONDS: '1',
  RESULT_GRACE_SECONDS: '1', GAME_SECONDS: '0' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (p, body) => fetch(BASE + p, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const get = p => fetch(BASE + p).then(r => r.json());
const join = (device_id, user_id, nickname) =>
  post('/session/join', { device_id, user_id, nickname, whats_app_session_id: 'wa-' + user_id });
const state = sid => get(`/session/state?session_id=${sid}`);
const score = (sid, user_id, s) => post('/session/score', { session_id: sid, user_id, score: s });
const results = sid => get(`/session/results?session_id=${sid}`);

async function run() {
  let pass = 0;
  const ok = (name) => { console.log('  ✓', name); pass++; };

  // --- 1. single: 1 pemain di 1 kiosk -> mode single ---
  {
    const j = await join('k1', 'u1', 'Andi');
    assert.ok(j.session_id, 'server mengembalikan session_id');
    assert.equal(j.count, 1);
    await sleep(1200);
    const st = await state(j.session_id);
    assert.equal(st.phase, 'playing');
    assert.equal(st.final_mode, 'single');
    await score(j.session_id, 'u1', 500);
    await sleep(50);
    const rz = await results(j.session_id);
    assert.equal(rz.ready, true);
    assert.equal(rz.results[0].score, 500);
    ok('single: 1 pemain 1 kiosk -> single + skor terkumpul');
  }

  // --- 2. multi: 2 pemain KIOSK SAMA (device_id sama) -> grup jadi 1 sesi ---
  {
    const ja = await join('k2', 'a', 'Ana');
    const jb = await join('k2', 'b', 'Budi');   // device sama -> sesi sama
    assert.equal(ja.session_id, jb.session_id, 'device sama -> session_id sama');
    assert.equal(jb.count, 2);
    await sleep(1200);
    const st = await state(ja.session_id);
    assert.equal(st.final_mode, 'multi');
    await score(ja.session_id, 'a', 300);
    await score(ja.session_id, 'b', 900);
    await sleep(50);
    const rz = await results(ja.session_id);
    assert.equal(rz.ready, true);
    assert.deepEqual(rz.results.map(r => r.nickname), ['Budi', 'Ana']);
    ok('multi: 2 pemain kiosk sama -> 1 sesi, ranking desc benar');
  }

  // --- 3. device_id BEDA -> sesi terpisah (masing-masing single) ---
  {
    const jx = await join('kX', 'x', 'X');
    const jy = await join('kY', 'y', 'Y');       // kiosk beda
    assert.notEqual(jx.session_id, jy.session_id, 'device beda -> session_id beda');
    assert.equal(jx.count, 1);
    assert.equal(jy.count, 1);
    ok('kiosk beda -> sesi terpisah');
  }

  // --- 4. rolling window: pemain baru (kiosk sama) -> window reset ---
  {
    const j1 = await join('k4', 'r1', 'R1');
    assert.ok(j1.ms_left > 800);
    await sleep(600);
    const mid = await state(j1.session_id);
    assert.ok(mid.ms_left < 500, 'window menyusut sebelum join ke-2');
    const j2 = await join('k4', 'r2', 'R2');
    assert.equal(j2.session_id, j1.session_id);
    assert.ok(j2.ms_left > 800, 'window reset penuh setelah pemain baru join');
    ok('rolling window: pemain baru -> window reset ke penuh');
  }

  // --- 5. kiosk dipakai berurutan: setelah sesi mulai, join baru -> sesi BARU ---
  {
    const j1 = await join('k5', 's1', 'S1');
    await sleep(1200);                             // sesi pertama mulai
    const st1 = await state(j1.session_id);
    assert.equal(st1.phase, 'playing');
    const j2 = await join('k5', 's2', 'S2');       // kiosk sama, tapi sesi lama sudah jalan
    assert.notEqual(j2.session_id, j1.session_id, 'sesi baru untuk kiosk yang sama');
    assert.equal(j2.count, 1);
    ok('kiosk berurutan: setelah sesi mulai -> join baru buka sesi baru');
  }

  // --- 6. maks 4 pemain: pemain ke-5 (kiosk sama) -> sesi baru ---
  {
    let j;
    for (const uid of ['p1', 'p2', 'p3', 'p4']) j = await join('k6', uid, uid);
    assert.equal(j.count, 4);
    const j5 = await join('k6', 'p5', 'Late');     // penuh -> sesi lama mulai -> ini sesi baru
    assert.notEqual(j5.session_id, j.session_id);
    assert.equal(j5.count, 1);
    ok('maks 4: pemain ke-5 -> sesi baru (kiosk penuh)');
  }

  // --- 7. re-join tidak menggandakan pemain ---
  {
    const j1 = await join('k7', 'z', 'Z');
    const j2 = await join('k7', 'z', 'Z2');        // user sama, reload
    assert.equal(j2.session_id, j1.session_id);
    assert.equal(j2.count, 1);
    assert.equal(j2.players[0].nickname, 'Z2');
    ok('re-join (reload): tidak menggandakan, nickname diperbarui');
  }

  console.log(`\n${pass} test lulus ✅`);
}

const srv = spawn('node', [path.join(__dirname, 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
srv.stdout.on('data', async d => {
  if (!/server jalan/.test(String(d))) return;
  try {
    await run();
    srv.kill();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST GAGAL:', err.message);
    srv.kill();
    process.exit(1);
  }
});
setTimeout(() => { console.error('server tidak start'); srv.kill(); process.exit(1); }, 5000).unref();
