// ============================================================
// Logika inti Tetris (tanpa DOM) — papan 10x20, 7-bag,
// warna balok selang-seling merah/putih sesuai spec sheet FA.
// ============================================================

import { CONFIG } from './config.js';

// bentuk balok: matriks rotasi 0; dirotasi runtime
export const SHAPES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]],
};
const NAMES = Object.keys(SHAPES);

// offset percobaan saat rotasi (wall kick sederhana)
const KICKS = [[0,0],[-1,0],[1,0],[0,-1],[-2,0],[2,0]];

export function rotateMatrix(m) {
  const n = m.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      out[x][n - 1 - y] = m[y][x];
  return out;
}

export class Tetris {
  constructor() {
    this.cols = CONFIG.cols;
    this.rows = CONFIG.rows;
    // grid[y][x] = null | 'red' | 'white'
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
    this.bag = [];
    this.queue = [];
    this.colorToggle = Math.random() < 0.5; // warna pertama acak, lalu selang-seling
    while (this.queue.length < 3) this.queue.push(this.#nextFromBag());
    this.piece = null;
    this.score = 0;
    this.combo = 0;
    this.topOut = false;
    this.spawn();
  }

  #nextFromBag() {
    if (this.bag.length === 0) {
      this.bag = [...NAMES].sort(() => Math.random() - 0.5);
    }
    const name = this.bag.pop();
    this.colorToggle = !this.colorToggle;
    return { name, color: this.colorToggle ? 'red' : 'white' };
  }

  spawn() {
    const next = this.queue.shift();
    this.queue.push(this.#nextFromBag());
    const matrix = SHAPES[next.name].map(r => [...r]);
    this.piece = {
      name: next.name,
      color: next.color,
      matrix,
      x: Math.floor((this.cols - matrix[0].length) / 2),
      y: -this.#topPadding(matrix),
    };
    if (this.collides(this.piece.matrix, this.piece.x, this.piece.y)) {
      this.topOut = true;
    }
  }

  #topPadding(m) {
    for (let y = 0; y < m.length; y++)
      if (m[y].some(v => v)) return y;
    return 0;
  }

  collides(matrix, px, py) {
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const gx = px + x, gy = py + y;
        if (gx < 0 || gx >= this.cols || gy >= this.rows) return true;
        if (gy >= 0 && this.grid[gy][gx]) return true;
      }
    }
    return false;
  }

  move(dx) {
    const p = this.piece;
    if (!this.collides(p.matrix, p.x + dx, p.y)) { p.x += dx; return true; }
    return false;
  }

  rotate() {
    const p = this.piece;
    const rotated = rotateMatrix(p.matrix);
    for (const [kx, ky] of KICKS) {
      if (!this.collides(rotated, p.x + kx, p.y + ky)) {
        p.matrix = rotated;
        p.x += kx;
        p.y += ky;
        return true;
      }
    }
    return false;
  }

  softStep() { // turun 1; false kalau mendarat
    const p = this.piece;
    if (!this.collides(p.matrix, p.x, p.y + 1)) { p.y++; return true; }
    return false;
  }

  ghostY() {
    const p = this.piece;
    let y = p.y;
    while (!this.collides(p.matrix, p.x, y + 1)) y++;
    return y;
  }

  hardDrop() {
    const from = this.piece.y;
    this.piece.y = this.ghostY();
    return this.piece.y - from; // jarak jatuh (untuk efek trail)
  }

  // kunci balok ke grid; kembalikan info clear untuk animasi/skor
  lock() {
    const p = this.piece;
    for (let y = 0; y < p.matrix.length; y++)
      for (let x = 0; x < p.matrix[y].length; x++)
        if (p.matrix[y][x]) {
          const gy = p.y + y;
          if (gy < 0) { this.topOut = true; continue; }
          this.grid[gy][p.x + x] = p.color;
        }

    const fullRows = [];
    for (let y = 0; y < this.rows; y++)
      if (this.grid[y].every(v => v)) fullRows.push(y);

    const result = {
      rows: fullRows,
      lastColor: p.color,
      points: 0,
      word: null,
      comboWord: null,
      comboPoints: 0,
      perfect: false,
    };

    if (fullRows.length > 0) {
      this.combo++;
      result.points = CONFIG.lineScores[fullRows.length] || 0;
      result.word = CONFIG.lineWords[fullRows.length] || 'Mantap!';
      if (CONFIG.comboBonus[this.combo]) {
        result.comboPoints = CONFIG.comboBonus[this.combo];
        result.comboWord = `Combo x${this.combo}`;
      }
    } else {
      this.combo = 0;
    }
    return result;
  }

  // hapus baris (dipanggil setelah animasi selesai)
  clearRows(rows) {
    for (const y of rows) {
      this.grid.splice(y, 1);
      this.grid.unshift(Array(this.cols).fill(null));
    }
    const perfect = this.grid.every(r => r.every(v => !v));
    return perfect;
  }
}
