// ============================================================
// UI + game loop — render papan di canvas, layar & efek sesuai
// mockup FA_Tetris Gamification (artboard 1080x2340).
// ============================================================

import { CONFIG, PLAYER } from './config.js';
import { Tetris, SHAPES } from './tetris.js';
import { notifyGameStart, notifyGameEnd } from './kiosk.js';
import { playSfx } from './audio.js';
import { createSession } from './session.js';

const $ = sel => document.querySelector(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]));

// ---------- skala stage ke viewport ----------
// Lebar desain tetap 1080; tinggi mengikuti layar supaya tidak ada
// letterbox hitam. Elemen bawah (swoosh, copyright, botol) sudah
// di-anchor ke bottom sehingga aman untuk tinggi berapa pun.
// Pakai visualViewport kalau ada: window.innerHeight bisa salah/telat
// update di beberapa browser Android (toolbar dinamis, gesture nav) dan
// bikin stage ke-render lebih besar dari layar (feedback S24FE).
function viewportSize() {
  const vv = window.visualViewport;
  return vv ? { w: vv.width, h: vv.height } : { w: innerWidth, h: innerHeight };
}
function fitStage() {
  const stage = $('#stage');
  const { w: vw, h: vh } = viewportSize();
  let s = vw / 1080;
  let H = Math.round(vh / s);
  if (H < 1900) {
    // layar terlalu lebar (desktop/landscape): fit tinggi, bar di samping
    s = vh / 2340;
    H = 2340;
  }
  stage.style.width = '1080px';
  stage.style.height = H + 'px';
  if ('zoom' in stage.style) {
    stage.style.zoom = s;            // zoom ikut layout -> tidak ada overflow
  } else {
    stage.style.transform = `scale(${s})`;
  }

  // layar lebih pendek dari desain 2340 -> kecilkan konten proporsional
  const k = Math.min(1, H / 2340);
  for (const fit of document.querySelectorAll('.fit')) {
    fit.style.zoom = k;
    fit.style.height = Math.round(H / k) + 'px';
  }
}
addEventListener('resize', fitStage);
addEventListener('orientationchange', () => setTimeout(fitStage, 60));
if (window.visualViewport) {
  visualViewport.addEventListener('resize', fitStage);
  visualViewport.addEventListener('scroll', fitStage);
}
fitStage();

// ---------- preload gambar ----------
const IMG = {};
function loadImages(map) {
  return Promise.all(Object.entries(map).map(([key, src]) => new Promise(res => {
    const im = new Image();
    im.onload = () => { IMG[key] = im; res(); };
    im.onerror = () => { console.warn('gagal load', src); res(); };
    im.src = src;
  })));
}
const imagesReady = loadImages({
  red: 'assets/img/block-red.png',
  white: 'assets/img/block-white.png',
  trailRed: 'assets/img/trail-red.png',
  trailWhite: 'assets/img/trail-white.png',
  rowRed: 'assets/img/row-red.png',
  rowWhite: 'assets/img/row-white.png',
  bubbleRed: 'assets/img/bubble-red.png',
  bubbleWhite: 'assets/img/bubble-white.png',
});

// ---------- state ----------
const CELL = CONFIG.cell;
const canvas = $('#board');
const ctx = canvas.getContext('2d');

let game = null;
let session = null;      // SessionService (remote/local) — lihat js/session.js
let gameMode = 'single'; // 'single' | 'multi' (ditentukan setelah waiting room)
let running = false;
let over = false;
let timeLeft = CONFIG.gameSeconds;
let dropTimer = 0;
let lockTimer = -1;      // -1 = belum mendarat
let lockResets = 0;
let softDropping = false;
let lastTs = 0;
let lastTickSecond = -1; // detik terakhir yang sudah bunyi "tick" (10 detik terakhir)
let elapsed = 0;

// animasi
let clearAnim = null;     // { rows, color, t }
let trails = [];          // { x, y, w, color, t }  efek gradasi jatuh
let bubbles = [];         // partikel gelembung line clear
let pendingSpawn = false;

// ---------- layar ----------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
  $(id).classList.remove('hidden');
}

// ---------- waiting room (lobby multiplayer) ----------
// Render status join dari server: jumlah pemain, hitung mundur window,
// daftar nickname yang sudah bergabung di sesi ini.
function updateWaiting(st) {
  const count = st.count ?? (st.players ? st.players.length : 1);
  const max = st.max ?? CONFIG.maxPlayers;
  const sec = Math.ceil((st.ms_left ?? 0) / 1000);
  const cEl = $('#waiting-count'), tEl = $('#waiting-timer'), rEl = $('#waiting-roster');
  if (cEl) cEl.textContent = `${count}/${max} pemain`;
  if (tEl) tEl.textContent = sec > 0 ? `Mulai dalam ${sec} detik…` : 'Memulai…';
  if (rEl && st.players) {
    rEl.innerHTML = st.players.map(p =>
      `<div class="wr-name${p.user_id === PLAYER.userId ? ' me' : ''}">${esc(p.nickname)}</div>`
    ).join('');
  }
}

// ---------- HUD ----------
function fmtTime(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}
function updateHud() {
  $('#hud-score').textContent = game.score;
  const t = Math.max(0, timeLeft);
  $('#hud-time').textContent = fmtTime(t);

  // feedback 13 Jul: 10 detik terakhir -> angka time berkedip + tick sound
  const secLeft = Math.ceil(t);
  const lastTen = running && !over && t > 0 && secLeft <= 10;
  $('#hud-time').classList.toggle('blink', lastTen);
  if (lastTen && secLeft !== lastTickSecond) {
    lastTickSecond = secLeft;
    playSfx('tick');
  }
}

// ---------- NEXT queue (mini canvas per balok) ----------
function renderNext() {
  const holder = $('#next-queue');
  holder.innerHTML = '';
  const mini = 26; // px per sel mini
  for (const q of game.queue.slice(0, 3)) {
    const m = SHAPES[q.name];
    let minX = 9, maxX = -1, minY = 9, maxY = -1;
    m.forEach((row, y) => row.forEach((v, x) => {
      if (v) { minX = Math.min(minX, x); maxX = Math.max(maxX, x);
               minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }));
    const c = document.createElement('canvas');
    c.width = (maxX - minX + 1) * mini;
    c.height = (maxY - minY + 1) * mini;
    c.style.width = c.width + 'px';
    const g = c.getContext('2d');
    const img = IMG[q.color];
    m.forEach((row, y) => row.forEach((v, x) => {
      if (v) g.drawImage(img, (x - minX) * mini, (y - minY) * mini, mini, mini);
    }));
    // slot ukuran tetap: balok apapun bentuknya dipusatkan, supaya 3 slot
    // rapi mengisi tinggi box NEXT (feedback 13 Jul: ada ruang kosong)
    const slot = document.createElement('div');
    slot.className = 'next-slot';
    slot.appendChild(c);
    holder.appendChild(slot);
  }
}

// feedback 13 Jul: sound per kata (file menyusul, lihat js/audio.js)
const WORD_SFX = {
  'Mantap!': 'mantap',
  'Keren!': 'keren',
  'Gokil!': 'gokil',
  'Sempurna!': 'sempurna',
  'Perfect!': 'perfect',
};

// ---------- popup kata (Mantap! +100 dst) ----------
// koordinat grid di dalam #board-wrap (canvas #board di offset 58,58,
// tiap sel CELL px — lihat #board di style.css)
const GRID_X = 58, GRID_Y = 58;
const GRID_W = CONFIG.cols * CELL;   // 600
const GRID_H = CONFIG.rows * CELL;   // 1200

// feedback 14 Jul: kata + combo disusun bertumpuk rapi dalam SATU grup
// (tidak saling menimpa), muncul di dekat balok yang melengkapi baris
// (horizontal mengikuti kolom balok terakhir), dan sedikit DI ATAS efek
// line clear (tidak menimpa baris yang dihapus).
function popupGroup(items, centerCol, rowTop, rowCount) {
  const group = document.createElement('div');
  group.className = 'popup-group';
  group.style.left = '-9999px'; // sembunyikan sampai ukuran terukur
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'popup' + (it.combo ? ' combo' : '');
    el.innerHTML = `${it.word}<br><span class="pts">+${it.pts}</span>`;
    group.appendChild(el);
  }
  $('#popup-layer').appendChild(group);

  const w = group.offsetWidth, h = group.offsetHeight, gap = 18;
  const cellX = GRID_X + centerCol * CELL;
  const topRowY = GRID_Y + rowTop * CELL;
  const bottomRowY = GRID_Y + (rowTop + rowCount) * CELL;

  // horizontal: pusatkan di balok, jaga tetap di dalam papan
  let left = cellX - w / 2;
  left = Math.max(GRID_X + 4, Math.min(GRID_X + GRID_W - w - 4, left));

  // vertikal: utamakan di atas baris; kalau tak muat, taruh di bawahnya
  let top = topRowY - gap - h;
  if (top < GRID_Y + 4) top = Math.min(bottomRowY + gap, GRID_Y + GRID_H - h - 4);

  group.style.left = left + 'px';
  group.style.top = top + 'px';
  setTimeout(() => group.remove(), 1200);
}

// popup di tengah papan (Perfect! — baris sudah hilang saat ini dipanggil)
function popupCenter(word, pts) {
  const group = document.createElement('div');
  group.className = 'popup-group center';
  const el = document.createElement('div');
  el.className = 'popup';
  el.innerHTML = `${word}<br><span class="pts">+${pts}</span>`;
  group.appendChild(el);
  $('#popup-layer').appendChild(group);
  setTimeout(() => group.remove(), 1200);
}

// kolom tengah balok (dipakai untuk menempatkan popup di dekat balok terakhir)
function pieceCenterCol(p) {
  let minC = 99, maxC = -1;
  p.matrix.forEach((row, y) => row.forEach((v, x) => {
    if (v) { const gx = p.x + x; if (gx < minC) minC = gx; if (gx > maxC) maxC = gx; }
  }));
  return (minC + maxC + 1) / 2;
}

// ---------- render papan ----------
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // grid & border sudah ada di asset board.png (background #board-wrap)

  // efek gradasi jatuh (trail)
  for (const t of trails) {
    const img = t.color === 'red' ? IMG.trailRed : IMG.trailWhite;
    ctx.globalAlpha = t.t;
    ctx.drawImage(img, t.x, t.y - t.h, t.w, t.h);
    ctx.globalAlpha = 1;
  }

  // balok terkunci
  // animasi clear: fase 1 (30% awal) baris sudah berubah warna balok terakhir,
  // fase 2 balok hilang dari kiri ke kanan
  const clearing = new Set(clearAnim ? clearAnim.rows : []);
  const prog = clearAnim ? Math.max(0, (0.7 - clearAnim.t) / 0.7) : 0;
  for (let y = 0; y < CONFIG.rows; y++) {
    for (let x = 0; x < CONFIG.cols; x++) {
      const cellColor = game.grid[y][x];
      if (!cellColor) continue;
      if (clearing.has(y)) {
        const cut = prog * (CONFIG.cols + 3) - x;
        const a = Math.max(0, Math.min(1, 1 - cut));
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(IMG[cellColor], x * CELL, y * CELL, CELL, CELL);
        ctx.globalAlpha = 1;
      } else {
        ctx.drawImage(IMG[cellColor], x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  // overlay stroke: satu kotak per kelompok baris berurutan (multi-baris =
  // satu kotak lebih tinggi, sesuai spec sheet .ai).
  // PNG row-red/white 1817x377 punya margin glow besar; kotak solidnya di
  // bbox (94,95)-(1720,280) -> skala supaya kotak solid pas menutup baris.
  if (clearAnim) {
    const img = clearAnim.color === 'red' ? IMG.rowRed : IMG.rowWhite;
    const fadeIn = Math.min(1, (1 - clearAnim.t) * 5);
    const fadeOut = Math.min(1, clearAnim.t * 5);
    ctx.globalAlpha = Math.min(fadeIn, fadeOut);
    for (const [top, count] of clearAnim.groups) {
      const tx = -4, tw = canvas.width + 8;          // target kotak solid
      const ty = top * CELL - 4, th = count * CELL + 8;
      const sx = tw / (1720 - 94), sy = th / (280 - 95);
      ctx.drawImage(img, tx - 94 * sx, ty - 95 * sy, 1817 * sx, 377 * sy);
    }
    ctx.globalAlpha = 1;
  }

  // gelembung (asset Bubble Red/White dari GDrive): terbang kiri -> kanan
  for (const b of bubbles) {
    if (b.delay > 0) continue;
    const img = b.color === 'red' ? IMG.bubbleRed : IMG.bubbleWhite;
    ctx.globalAlpha = Math.max(0, Math.min(1, b.t));
    ctx.drawImage(img, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    ctx.globalAlpha = 1;
  }

  // saat animasi clear berjalan, balok terakhir sudah menyatu ke grid —
  // jangan digambar lagi sebagai balok aktif (feedback: "balok yang
  // melengkapi baris tidak ikut hilang")
  const p = game.piece;
  if (p && !over && !clearAnim) {
    const gy = game.ghostY();

    // bayangan balok (silhouette)
    if (gy > p.y) {
      drawSilhouette(p.matrix, p.x, gy);
      drawDots(p, gy);
    }

    // balok aktif
    for (let y = 0; y < p.matrix.length; y++)
      for (let x = 0; x < p.matrix[y].length; x++)
        if (p.matrix[y][x] && p.y + y >= 0)
          ctx.drawImage(IMG[p.color], (p.x + x) * CELL, (p.y + y) * CELL, CELL, CELL);
  }
}

// siluet bayangan: bentuk balok menyatu dengan satu outline putih
// (digambar via offscreen canvas + dilasi supaya outline hanya di tepi luar)
const silCanvas = document.createElement('canvas');
silCanvas.width = 5 * CELL + 24;
silCanvas.height = 5 * CELL + 24;
const silCtx = silCanvas.getContext('2d');

function drawSilhouette(m, px, py) {
  const pad = 12;
  silCtx.clearRect(0, 0, silCanvas.width, silCanvas.height);
  silCtx.beginPath();
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m[y].length; x++)
      if (m[y][x])
        silCtx.roundRect(pad + x * CELL, pad + y * CELL, CELL + 1, CELL + 1, 12);
  silCtx.fillStyle = '#fff';
  silCtx.fill();

  const dx = px * CELL - pad, dy = py * CELL - pad;
  // outline: gambar bentuk putih diperbesar ke 8 arah
  for (const [ox, oy] of [[-3,0],[3,0],[0,-3],[0,3],[-2,-2],[2,-2],[-2,2],[2,2]])
    ctx.drawImage(silCanvas, dx + ox, dy + oy);
  // isi: warna gelap semi transparan menimpa bagian dalam
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  silCtx.globalCompositeOperation = 'source-in';
  silCtx.fillStyle = 'rgb(82, 38, 32)';
  silCtx.fillRect(0, 0, silCanvas.width, silCanvas.height);
  silCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(silCanvas, dx, dy);
  ctx.restore();
}

function drawDots(p, gy) {
  // titik-titik dari balok aktif ke bayangan
  let cx = 0, count = 0, bottom = 0;
  for (let y = 0; y < p.matrix.length; y++)
    for (let x = 0; x < p.matrix[y].length; x++)
      if (p.matrix[y][x]) { cx += p.x + x + 0.5; count++; bottom = Math.max(bottom, p.y + y + 1); }
  cx = (cx / count) * CELL;
  const y0 = bottom * CELL + 14;
  const y1 = gy * CELL - 8;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let y = y0; y < y1; y += 34) {
    ctx.beginPath(); ctx.arc(cx, y, 5, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------- efek ----------
function addTrail(distance, alpha = 0.9) {
  // gradasi per kolom mengikuti siluet balok (sesuai contoh spec sheet .ai):
  // tiap kolom balok dapat gradasi dari sel teratasnya ke atas
  const p = game.piece;
  const tops = {}; // kolom grid -> baris teratas yang terisi
  p.matrix.forEach((row, y) => row.forEach((v, x) => {
    if (!v) return;
    const gx = p.x + x, gy = p.y + y;
    if (tops[gx] === undefined || gy < tops[gx]) tops[gx] = gy;
  }));
  const h = Math.min(distance, 4) * CELL;
  for (const [gx, topY] of Object.entries(tops)) {
    trails.push({
      x: gx * CELL,
      w: CELL,
      y: topY * CELL,
      h,
      color: p.color,
      t: alpha,
    });
  }
}

function spawnBubbles(groups, color) {
  // seperti balon sabun ditiup dari kiri: muncul di kiri, terbang ke kanan,
  // ukuran & jumlah acak; warna mengikuti balok terakhir.
  // Feedback 07 Jul: bubble diperbanyak + pakai asset bubble dari GDrive.
  for (const [top, count] of groups) {
    const n = (18 + Math.floor(Math.random() * 14)) * count;
    for (let i = 0; i < n; i++) {
      bubbles.push({
        x: -20 + Math.random() * 140,
        y: (top - 0.5) * CELL + Math.random() * (count + 1) * CELL,
        r: 6 + Math.random() * 22,
        vx: 350 + Math.random() * 500,          // px/detik ke kanan
        vy: -60 + Math.random() * 90,           // sedikit naik-turun
        delay: Math.random() * 0.35,            // muncul bergantian
        color,
        t: 1,
        life: 0.7 + Math.random() * 0.7,
      });
    }
  }
}

// ---------- penempatan balok ----------
function placePiece(landMode = 'normal') {
  const res = game.lock();
  lockTimer = -1;
  lockResets = 0;

  // Feedback 07 Jul: setiap balok yang turun bernilai 1 poin
  game.score += 1;

  if (res.rows.length > 0) {
    game.score += res.points + res.comboPoints;
    const sorted = [...res.rows].sort((a, b) => a - b);
    const rowTop = sorted[0], rowCount = sorted.length;

    // kata utama + combo disusun bertumpuk rapi, dekat balok terakhir yang
    // melengkapi baris, sedikit di atas efek line clear (feedback 14 Jul)
    const centerCol = pieceCenterCol(game.piece);
    const items = [{ word: res.word, pts: res.points }];
    if (res.comboWord) items.push({ word: res.comboWord, pts: res.comboPoints, combo: true });
    popupGroup(items, centerCol, rowTop, rowCount);
    playSfx(WORD_SFX[res.word]);

    // baris penuh berubah warna mengikuti balok terakhir yang melengkapinya
    for (const y of res.rows)
      game.grid[y] = Array(CONFIG.cols).fill(res.lastColor);

    // kelompokkan baris berurutan -> satu kotak efek per kelompok
    const groups = [];
    for (const y of sorted) {
      const g = groups[groups.length - 1];
      if (g && y === g[0] + g[1]) g[1]++;
      else groups.push([y, 1]);
    }

    spawnBubbles(groups, res.lastColor);
    clearAnim = { rows: res.rows, groups, color: res.lastColor, t: 1 };
    pendingSpawn = true; // spawn setelah animasi
    playSfx('clear');
  } else {
    // suara mendarat normal saat balok terkunci oleh gravitasi;
    // varian cepat/sangat cepat dibunyikan saat tombol ditekan (tanpa delay)
    if (landMode === 'normal') playSfx('landNormal');
    game.spawn();
    renderNext();
  }
  updateHud();
  if (game.topOut) endGame('topout');
}

// ---------- loop ----------
let loopId = 0; // mencegah loop ganda saat startGame dipanggil ulang

function tick(ts, id) {
  if (!running || id !== loopId) return;
  const dt = Math.min(50, ts - lastTs);
  lastTs = ts;
  elapsed += dt / 1000;
  timeLeft = CONFIG.gameSeconds - elapsed;

  if (timeLeft <= 0) { updateHud(); endGame('timeup'); return; }

  // update efek
  trails = trails.filter(t => (t.t -= dt / 400) > 0);
  bubbles = bubbles.filter(b => {
    if (b.delay > 0) { b.delay -= dt / 1000; return true; }
    b.x += b.vx * dt / 1000;
    b.y += b.vy * dt / 1000;
    b.t -= dt / (b.life * 1000);
    return b.t > 0 && b.x < canvas.width + 40;
  });

  if (clearAnim) {
    clearAnim.t -= dt / CONFIG.clearAnimMs;
    if (clearAnim.t <= 0) {
      const perfect = game.clearRows(clearAnim.rows);
      if (perfect) {
        game.score += CONFIG.perfectClearBonus;
        popupCenter('Perfect!', CONFIG.perfectClearBonus);
        playSfx('perfect');
      }
      clearAnim = null;
      if (pendingSpawn) {
        pendingSpawn = false;
        game.spawn();
        renderNext();
        if (game.topOut) { updateHud(); endGame('topout'); return; }
      }
      updateHud();
    }
  } else {
    // gravitasi (kecepatan konstan)
    dropTimer += dt;
    const interval = softDropping ? CONFIG.softDropMs : CONFIG.gravityMs;
    if (dropTimer >= interval) {
      dropTimer = 0;
      if (game.softStep()) {
        lockTimer = -1;
        // turun cepat: efek gradasi mengikuti balok tiap langkah
        if (softDropping) addTrail(2.5, 0.45);
      } else if (lockTimer < 0) {
        lockTimer = 0;
      }
    }
    if (lockTimer >= 0) {
      lockTimer += dt;
      if (lockTimer >= CONFIG.lockDelayMs) {
        // cek ulang: kalau balok sudah digeser keluar tepian dan masih bisa
        // turun, jangan dikunci di udara (bug balok melayang)
        const p = game.piece;
        if (!game.collides(p.matrix, p.x, p.y + 1)) {
          lockTimer = -1;
        } else {
          placePiece(softDropping ? 'fast' : 'normal');
        }
      }
    }
  }

  updateHud();
  draw();
  requestAnimationFrame(ts2 => tick(ts2, id));
}

// ---------- input ----------
function afterShift() {
  // setelah bergeser/berputar: kalau balok bisa turun lagi (keluar dari
  // tepian), batalkan lock supaya tidak terkunci melayang
  const p = game.piece;
  if (!game.collides(p.matrix, p.x, p.y + 1)) {
    lockTimer = -1;
  } else if (lockTimer >= 0 && lockResets < CONFIG.maxLockResets) {
    lockTimer = 0; lockResets++;
  }
}
function tryMove(dx) {
  if (!running || over || clearAnim) return;
  if (game.move(dx)) { playSfx('move'); afterShift(); }
}
function tryRotate() {
  if (!running || over || clearAnim) return;
  if (game.rotate()) { playSfx('rotate'); afterShift(); }
}
function doHardDrop() {
  if (!running || over || clearAnim) return;
  playSfx('landHard'); // langsung saat tombol ditekan, tanpa delay
  const dist = game.hardDrop();
  if (dist > 0) addTrail(dist);
  placePiece('hard');
}
function startSoftDrop() {
  if (softDropping) return;
  softDropping = true;
  if (running && !over) playSfx('landFast'); // langsung saat tombol ditekan
}

function bindHold(el, onPress, repeatMs) {
  let iv = null;
  const start = e => {
    e.preventDefault();
    onPress();
    if (repeatMs) iv = setInterval(onPress, repeatMs);
  };
  const stop = () => { if (iv) { clearInterval(iv); iv = null; } };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('pointerleave', stop);
}

bindHold($('#ctl-left'),  () => tryMove(-1), 140);
bindHold($('#ctl-right'), () => tryMove(1), 140);
$('#ctl-rotate').addEventListener('pointerdown', e => { e.preventDefault(); tryRotate(); });
$('#ctl-drop').addEventListener('pointerdown', e => { e.preventDefault(); doHardDrop(); });

const dnBtn = $('#ctl-down');
dnBtn.addEventListener('pointerdown', e => { e.preventDefault(); startSoftDrop(); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
  dnBtn.addEventListener(ev, () => { softDropping = false; });

addEventListener('keydown', e => {
  if (e.repeat && (e.key === ' ' || e.key === 'ArrowUp')) return;
  switch (e.key) {
    case 'ArrowLeft': tryMove(-1); break;
    case 'ArrowRight': tryMove(1); break;
    case 'ArrowUp': case 'x': tryRotate(); break;
    case 'ArrowDown': startSoftDrop(); break;
    case ' ': e.preventDefault(); doHardDrop(); break;
  }
});
addEventListener('keyup', e => {
  if (e.key === 'ArrowDown') softDropping = false;
});

// cegah menu context "download image" saat tombol ditahan lama di HP
addEventListener('contextmenu', e => e.preventDefault());

// ---------- confetti (TY page) ----------
// Asset resmi "Confetti 30" (PNG sequence 279 frame + alpha asli) di-encode
// jadi animated AVIF transparan via avifenc (bukan ffmpeg/libaom yang
// membuang alpha). Downscale frame lewat premultiplied alpha supaya warna
// tepi partikel tidak tercampur hitam (terlihat gelap/kusam).
// Pipeline: ffmpeg fps=20,premultiply,scale=720,unpremultiply -> avifenc
// --fps 20 --repetition-count 0 -q 50 --qalpha 62.
const CONFETTI_SRC = 'assets/video/confetti.avif';
let confettiHideTimer = null;

function startConfetti() {
  const img = $('#confetti-img');
  img.src = CONFETTI_SRC + '?t=' + Date.now(); // mulai animasi dari awal
  img.classList.remove('hidden');
  clearTimeout(confettiHideTimer);
  confettiHideTimer = setTimeout(() => img.classList.add('hidden'), 9300); // durasi avif 9.3s
}

// ---------- alur game ----------
async function startGame() {
  await imagesReady;

  const id = ++loopId;   // matikan loop lama kalau ada
  game = new Tetris();
  window.__game = game; // akses debug/QA
  running = true;
  over = false;
  timeLeft = CONFIG.gameSeconds;
  elapsed = 0;
  dropTimer = 0;
  lockTimer = -1;
  lastTickSecond = -1;
  trails = []; bubbles = []; clearAnim = null; pendingSpawn = false;
  $('#popup-layer').innerHTML = '';
  $('#hud-time').classList.remove('blink');

  show('#screen-game');
  renderNext();
  updateHud();
  draw();

  // ---- waiting room + penentuan mode (dokumen Grivy Bagian 5) ----
  // REMOTE: join sesi ke server, polling sampai window habis / slot penuh,
  // lalu server memutuskan single vs multi. LOCAL: simulasi via ?wait=/?others=.
  session = createSession();
  gameMode = 'single';
  const showLobby = session.remote || CONFIG.waitWindowMs > 0;
  if (showLobby) {
    $('#waiting-overlay').classList.remove('hidden');
    updateWaiting({ count: 1, max: CONFIG.maxPlayers,
      players: [{ user_id: PLAYER.userId, nickname: PLAYER.nickname }],
      ms_left: session.remote ? CONFIG.joinWindowSeconds * 1000 : CONFIG.waitWindowMs });
  }
  try {
    if (session.remote) await session.join();
    const res = await session.waitForStart(updateWaiting);
    gameMode = res.mode;
  } catch (err) {
    // server tak terjangkau -> jangan blokir pemain, jatuh ke single player
    console.warn('[mp] gagal join/menunggu, fallback single player:', err);
    gameMode = 'single';
  }
  if (id !== loopId) return; // sudah di-restart selama menunggu
  $('#waiting-overlay').classList.add('hidden');

  notifyGameStart(session && session.sessionId ? session.sessionId : '');
  lastTs = performance.now();
  requestAnimationFrame(ts => tick(ts, id));
}

// render ranking TY page. Pemain yang belum selesai ditandai "bermain…"
// (bukan skor 0) supaya jelas skornya akan menyusul.
function renderResults(rows) {
  const list = rows.slice(0, CONFIG.maxPlayers).sort((a, b) => {
    const sa = a.submitted !== false, sb = b.submitted !== false;
    if (sa !== sb) return sa ? -1 : 1;        // yang sudah selesai di atas
    return (b.score || 0) - (a.score || 0);
  });
  $('#session-results').innerHTML = list.map((r, i) => `
    <div class="result-row${r.me ? ' me' : ''}${r.submitted === false ? ' pending' : ''}">
      <span class="rank">${i + 1}</span>
      <span class="name">${esc(r.nickname)}</span>
      <span class="score">${r.submitted === false ? 'bermain…' : r.score}</span>
    </div>`).join('');
}

async function endGame(reason = 'timeup') {
  if (over) return;
  over = true;
  running = false;
  const gen = loopId;   // token: batalkan kalau game di-restart selama await
  draw();

  // kirim skor akhir ke server sesi (mengalir ke ranking). Single/local pun
  // aman: LocalSession menyimpan skor, RemoteSession POST /session/score.
  if (session) session.submitScore(game.score);

  // feedback 13 Jul: waktu habis -> tampilkan "Yah, Waktunya Habis!" di board
  // dulu, delay 2 detik, baru pindah ke Your Score
  let minDelay = 900;
  if (reason === 'timeup') {
    const el = document.createElement('div');
    el.className = 'time-up-text';
    el.textContent = 'Yah, Waktunya Habis!';
    $('#popup-layer').appendChild(el);
    minDelay = 2000;
  }

  await sleep(minDelay);
  if (gen !== loopId) return; // sudah di-restart -> jangan tampilkan hasil lama

  $('#final-score').textContent = game.score;
  const holder = $('#session-results');
  const screen = $('#screen-result');
  const isMulti = gameMode === 'multi' || (session && session.mode === 'multi');
  const fallback = [{ nickname: PLAYER.nickname, score: game.score, me: true, submitted: true }];

  // Tampilkan TY page LANGSUNG (tidak menunggu pemain lain -> tidak "nyangkut").
  // Multi: judul "SCOREBOARD" + panel ranking (desain Happy). Single: "YOUR SCORE".
  if (isMulti) {
    screen.classList.add('multi');
    $('.your-score').textContent = 'SCOREBOARD';
    holder.classList.remove('hidden');
    renderResults(fallback);         // render awal: skor sendiri
  } else {
    screen.classList.remove('multi');
    $('.your-score').textContent = 'YOUR SCORE';
    holder.classList.add('hidden');
  }

  show('#screen-result');
  playSfx('success');   // Big Band Celebration bersamaan confetti
  startConfetti();

  // multiplayer: pantau skor pemain lain -> ranking update HIDUP sampai sesi
  // selesai (semua submit / grace habis). Pemain yang selesai duluan otomatis
  // melihat skor final semua orang tanpa refresh.
  if (isMulti && session) {
    const finalRows = await session.watchResults(rows => {
      if (gen === loopId) renderResults(rows);
    }).catch(() => fallback);
    if (gen !== loopId) return;
    renderResults(finalRows);
    notifyGameEnd(session && session.sessionId ? session.sessionId : '', finalRows.map(({ nickname, score }) => ({ nickname, score })));
  } else {
    notifyGameEnd(session && session.sessionId ? session.sessionId : '', fallback.map(({ nickname, score }) => ({ nickname, score })));
  }
}

$('#btn-start').addEventListener('click', () => { playSfx('start'); startGame(); });

window.__endGame = endGame; // hook debug/QA
window.__confetti = { start: startConfetti, img: () => $('#confetti-img') }; // hook debug/QA
