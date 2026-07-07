// ============================================================
// UI + game loop — render papan di canvas, layar & efek sesuai
// mockup FA_Tetris Gamification (artboard 1080x2340).
// ============================================================

import { CONFIG, PLAYER } from './config.js';
import { Tetris, SHAPES } from './tetris.js';
import { notifyGameStart, notifyGameEnd } from './kiosk.js';

const $ = sel => document.querySelector(sel);

// ---------- skala stage ke viewport ----------
// Lebar desain tetap 1080; tinggi mengikuti layar supaya tidak ada
// letterbox hitam. Elemen bawah (swoosh, copyright, botol) sudah
// di-anchor ke bottom sehingga aman untuk tinggi berapa pun.
function fitStage() {
  const stage = $('#stage');
  let s = innerWidth / 1080;
  let H = Math.round(innerHeight / s);
  if (H < 1900) {
    // layar terlalu lebar (desktop/landscape): fit tinggi, bar di samping
    s = innerHeight / 2340;
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
});

// ---------- state ----------
const CELL = CONFIG.cell;
const canvas = $('#board');
const ctx = canvas.getContext('2d');

let game = null;
let running = false;
let over = false;
let timeLeft = CONFIG.gameSeconds;
let dropTimer = 0;
let lockTimer = -1;      // -1 = belum mendarat
let lockResets = 0;
let softDropping = false;
let lastTs = 0;
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

// ---------- HUD ----------
function fmtTime(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}
function updateHud() {
  $('#hud-score').textContent = game.score;
  $('#hud-time').textContent = fmtTime(Math.max(0, timeLeft));
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
    holder.appendChild(c);
  }
}

// ---------- popup kata (Mantap! +100 dst) ----------
function popup(word, pts, isCombo = false) {
  const el = document.createElement('div');
  el.className = 'popup' + (isCombo ? ' combo' : '');
  el.innerHTML = `${word}<br><span class="pts">+${pts}</span>`;
  $('#popup-layer').appendChild(el);
  setTimeout(() => el.remove(), 1200);
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

  // gelembung sabun: terbang dari kiri ke kanan
  for (const b of bubbles) {
    if (b.delay > 0) continue;
    const a = Math.max(0, Math.min(1, b.t));
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.85 * a})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.12 * a})`;
    ctx.fill();
  }

  const p = game.piece;
  if (p && !over) {
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

function spawnBubbles(groups) {
  // seperti balon sabun ditiup dari kiri: muncul di kiri, terbang ke kanan,
  // ukuran & jumlah acak, penempatan tidak sejajar
  for (const [top, count] of groups) {
    const n = 8 + Math.floor(Math.random() * 10) * count;
    for (let i = 0; i < n; i++) {
      bubbles.push({
        x: -20 + Math.random() * 120,
        y: top * CELL + Math.random() * count * CELL,
        r: 5 + Math.random() * 20,
        vx: 350 + Math.random() * 500,          // px/detik ke kanan
        vy: -60 + Math.random() * 90,           // sedikit naik-turun
        delay: Math.random() * 0.25,            // muncul bergantian
        t: 1,
        life: 0.7 + Math.random() * 0.7,
      });
    }
  }
}

// ---------- penempatan balok ----------
function placePiece() {
  const res = game.lock();
  lockTimer = -1;
  lockResets = 0;

  if (res.rows.length > 0) {
    game.score += res.points + res.comboPoints;
    popup(res.word, res.points);
    if (res.comboWord) popup(res.comboWord, res.comboPoints, true);

    // baris penuh berubah warna mengikuti balok terakhir yang melengkapinya
    for (const y of res.rows)
      game.grid[y] = Array(CONFIG.cols).fill(res.lastColor);

    // kelompokkan baris berurutan -> satu kotak efek per kelompok
    const sorted = [...res.rows].sort((a, b) => a - b);
    const groups = [];
    for (const y of sorted) {
      const g = groups[groups.length - 1];
      if (g && y === g[0] + g[1]) g[1]++;
      else groups.push([y, 1]);
    }

    spawnBubbles(groups);
    clearAnim = { rows: res.rows, groups, color: res.lastColor, t: 1 };
    pendingSpawn = true; // spawn setelah animasi
  } else {
    game.spawn();
    renderNext();
  }
  updateHud();
  if (game.topOut) endGame();
}

// ---------- loop ----------
let loopId = 0; // mencegah loop ganda saat startGame dipanggil ulang

function tick(ts, id) {
  if (!running || id !== loopId) return;
  const dt = Math.min(50, ts - lastTs);
  lastTs = ts;
  elapsed += dt / 1000;
  timeLeft = CONFIG.gameSeconds - elapsed;

  if (timeLeft <= 0) { updateHud(); endGame(); return; }

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
        popup('Perfect!', CONFIG.perfectClearBonus);
      }
      clearAnim = null;
      if (pendingSpawn) {
        pendingSpawn = false;
        game.spawn();
        renderNext();
        if (game.topOut) { updateHud(); endGame(); return; }
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
          placePiece();
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
  if (game.move(dx)) afterShift();
}
function tryRotate() {
  if (!running || over || clearAnim) return;
  if (game.rotate()) afterShift();
}
function doHardDrop() {
  if (!running || over || clearAnim) return;
  const dist = game.hardDrop();
  if (dist > 0) addTrail(dist);
  placePiece();
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
dnBtn.addEventListener('pointerdown', e => { e.preventDefault(); softDropping = true; });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
  dnBtn.addEventListener(ev, () => { softDropping = false; });

addEventListener('keydown', e => {
  if (e.repeat && (e.key === ' ' || e.key === 'ArrowUp')) return;
  switch (e.key) {
    case 'ArrowLeft': tryMove(-1); break;
    case 'ArrowRight': tryMove(1); break;
    case 'ArrowUp': case 'x': tryRotate(); break;
    case 'ArrowDown': softDropping = true; break;
    case ' ': e.preventDefault(); doHardDrop(); break;
  }
});
addEventListener('keyup', e => {
  if (e.key === 'ArrowDown') softDropping = false;
});

// cegah menu context "download image" saat tombol ditahan lama di HP
addEventListener('contextmenu', e => e.preventDefault());

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
  trails = []; bubbles = []; clearAnim = null; pendingSpawn = false;
  $('#popup-layer').innerHTML = '';

  show('#screen-game');
  renderNext();
  updateHud();
  draw();

  // lobby multiplayer: tampilkan overlay tunggu kalau diaktifkan (?wait=10)
  if (CONFIG.waitWindowMs > 0) {
    $('#waiting-overlay').classList.remove('hidden');
    await new Promise(r => setTimeout(r, CONFIG.waitWindowMs));
    if (id !== loopId) return; // sudah di-restart selama menunggu
    $('#waiting-overlay').classList.add('hidden');
  }

  notifyGameStart(PLAYER.whatsAppSessionId);
  lastTs = performance.now();
  requestAnimationFrame(ts => tick(ts, id));
}

function endGame() {
  if (over) return;
  over = true;
  running = false;
  draw();

  // hasil semua pemain di sesi ini (pemain lain dari server multiplayer;
  // sementara disimulasikan via ?others=Nama:skor,... untuk demo)
  const results = [
    { nickname: PLAYER.nickname, score: game.score, me: true },
    ...CONFIG.mockOthers,
  ]
    .slice(0, CONFIG.maxPlayers)
    .sort((a, b) => b.score - a.score);

  notifyGameEnd(PLAYER.whatsAppSessionId, results.map(({ nickname, score }) => ({ nickname, score })));

  setTimeout(() => {
    $('#final-score').textContent = game.score;

    // TY page multiplayer: tampilkan poin semua pemain (email Mahda)
    const holder = $('#session-results');
    const screen = $('#screen-result');
    if (results.length > 1) {
      holder.innerHTML = results.map((r, i) => `
        <div class="result-row${r.me ? ' me' : ''}">
          <span class="rank">${i + 1}</span>
          <span class="name">${r.nickname.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</span>
          <span class="score">${r.score}</span>
        </div>`).join('');
      holder.classList.remove('hidden');
      screen.classList.add('multi');
    } else {
      holder.classList.add('hidden');
      screen.classList.remove('multi');
    }

    show('#screen-result');
  }, 900);
}

$('#btn-start').addEventListener('click', startGame);

window.__endGame = endGame; // hook debug/QA
