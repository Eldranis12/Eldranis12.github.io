// Integrasi test server multiplayer. Jalankan: node test.js
// Pakai window pendek supaya cepat: JOIN_WINDOW_SECONDS=1 RESULT_GRACE_SECONDS=1
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

async function run() {
  let pass = 0;
  const ok = (name) => { console.log('  ✓', name); pass++; };

  // --- 1. single player: 1 pemain, window habis -> mode single ---
  {
    const sid = 'sess-single';
    let st = await post('/session/join', { whats_app_session_id: sid, user_id: 'u1', nickname: 'Andi' });
    assert.equal(st.phase, 'waiting');
    assert.equal(st.count, 1);
    await sleep(1200); // lewati window
    st = await get(`/session/state?whats_app_session_id=${sid}&user_id=u1`);
    assert.equal(st.phase, 'playing');
    assert.equal(st.final_mode, 'single');
    ok('single player: 1 pemain -> mode single setelah window');

    await post('/session/score', { whats_app_session_id: sid, user_id: 'u1', score: 500 });
    await sleep(50);
    const rz = await get(`/session/results?whats_app_session_id=${sid}`);
    assert.equal(rz.ready, true);
    assert.equal(rz.results[0].score, 500);
    ok('single player: skor terkumpul & results ready');
  }

  // --- 2. multiplayer: 2 pemain dalam window -> mode multi, ranking benar ---
  {
    const sid = 'sess-multi';
    await post('/session/join', { whats_app_session_id: sid, user_id: 'a', nickname: 'Ana' });
    const st = await post('/session/join', { whats_app_session_id: sid, user_id: 'b', nickname: 'Budi' });
    assert.equal(st.count, 2);
    assert.equal(st.mode, 'multi'); // provisional
    await sleep(1200);
    const s2 = await get(`/session/state?whats_app_session_id=${sid}&user_id=a`);
    assert.equal(s2.final_mode, 'multi');
    ok('multiplayer: 2 pemain -> mode multi');

    await post('/session/score', { whats_app_session_id: sid, user_id: 'a', score: 300 });
    let rz = await get(`/session/results?whats_app_session_id=${sid}`);
    assert.equal(rz.ready, false); // masih tunggu Budi
    await post('/session/score', { whats_app_session_id: sid, user_id: 'b', score: 900 });
    await sleep(50);
    rz = await get(`/session/results?whats_app_session_id=${sid}`);
    assert.equal(rz.ready, true);
    assert.deepEqual(rz.results.map(r => r.nickname), ['Budi', 'Ana']); // urut skor desc
    ok('multiplayer: results ready saat semua submit + ranking desc benar');
  }

  // --- 3. maks 4 pemain: pemain ke-5 telat -> sesi solo ---
  {
    const sid = 'sess-full';
    for (const uid of ['p1', 'p2', 'p3', 'p4']) {
      await post('/session/join', { whats_app_session_id: sid, user_id: uid, nickname: uid });
    }
    // slot penuh -> deadline dimajukan; join ke-5 telat
    const st5 = await post('/session/join', { whats_app_session_id: sid, user_id: 'p5', nickname: 'Late' });
    assert.equal(st5.late, true);
    assert.equal(st5.final_mode, 'single');
    ok('maks 4 pemain: pemain ke-5 -> sesi solo (late)');
  }

  // --- 3b. rolling window: pemain baru join -> window reset ---
  {
    const sid = 'sess-rolling';
    const j1 = await post('/session/join', { whats_app_session_id: sid, user_id: 'r1', nickname: 'R1' });
    assert.ok(j1.ms_left > 800, 'window awal ~penuh');
    await sleep(600);                       // window terpakai sebagian
    const mid = await get(`/session/state?whats_app_session_id=${sid}&user_id=r1`);
    assert.ok(mid.ms_left < 500, 'window menyusut sebelum join ke-2');
    const j2 = await post('/session/join', { whats_app_session_id: sid, user_id: 'r2', nickname: 'R2' });
    assert.ok(j2.ms_left > 800, 'window reset penuh setelah pemain baru join');
    ok('rolling window: pemain ke-2 join -> window reset ke penuh');
  }

  // --- 4. re-join tidak menggandakan pemain ---
  {
    const sid = 'sess-rejoin';
    await post('/session/join', { whats_app_session_id: sid, user_id: 'x', nickname: 'X' });
    const st = await post('/session/join', { whats_app_session_id: sid, user_id: 'x', nickname: 'X2' });
    assert.equal(st.count, 1);
    assert.equal(st.players[0].nickname, 'X2');
    ok('re-join (reload): tidak menggandakan, nickname diperbarui');
  }

  console.log(`\n${pass} test lulus ✅`);
}

// spin up server lalu jalankan test
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
