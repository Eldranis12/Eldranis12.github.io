# Coke Hangout (Nongkrong) — Tetris Web App

Game Tetris berbasis browser untuk Coca-Cola Campus Activation Phase 2 (Grivy).
Dibuka dari link WhatsApp di HP — tanpa framework, tanpa build step, total asset ± 1,5 MB.

## Menjalankan

Serve folder ini sebagai static site, contoh:

```
python -m http.server 8123
```

lalu buka `http://localhost:8123`. (Preview Claude Code: konfigurasi `tetris` di `.claude/launch.json`.)

## Struktur

| Path | Isi |
|---|---|
| `index.html` | 3 layar: Cara Bermain, Game, Your Score |
| `css/style.css` | Layout mengikuti artboard desain 1080x2340, di-scale ke viewport |
| `js/config.js` | Konfigurasi game + pembacaan parameter URL dari Grivy |
| `js/tetris.js` | Logika inti Tetris (papan 10x20, 7-bag, warna selang-seling merah/putih) |
| `js/main.js` | Render canvas, efek, input, timer, alur layar |
| `js/kiosk.js` | Stub API kiosk vendor (game start / game end) |
| `assets/img/` | Asset dari `UI Coke ROM.zip` + hasil ekstrak `FA_Tetris Gamification.ai` |

## Parameter URL

```
?whats_app_session_id=abc123&user_id=xyz&nickname=Grady&device_id=001
```

Tambahan untuk pengujian/konfigurasi:

- `duration` — lama permainan dalam detik (default `180` sesuai spec sheet FA; brief menyebut 2 menit → pakai `duration=120` bila itu yang final)
- `wait` — lama jendela tunggu multiplayer dalam detik (default 0 = langsung mulai)
- `others` — simulasi hasil pemain lain untuk demo TY page multiplayer,
  contoh `?others=Nadia:450,Bima:300` (dihapus saat server multiplayer jadi)
- `kiosk_start_url`, `kiosk_end_url` — endpoint kiosk vendor (sementara, sampai detail API resmi tersedia)

## Aturan main (sesuai spec sheet FA_Tetris Gamification)

- Balok jatuh warna selang-seling merah/putih, ada bayangan (ghost) + garis titik-titik
- Efek gradasi saat turun cepat / jatuhkan langsung
- Skor: 1 baris **Mantap! +100**, 2 baris **Keren! +200**, 3 baris **Gokil! +300**,
  4 baris **Sempurna! +400**, Combo x2 **+50**, Combo x5 **+250**, Perfect Clear **+1500**
- Waktu habis atau balok mencapai atas → halaman Your Score

## Brief UI 07 Jul 2026 (PDF) — sudah diterapkan

- Sound effects dari folder `Audio/` → `assets/audio/` (start, move, rotate,
  clear, mendarat normal/cepat/sangat cepat) via `js/audio.js`
- +1 poin untuk setiap balok yang mendarat
- Bubble line clear pakai asset `Bubble Red/White.png`, jumlah diperbanyak,
  warna ikut balok terakhir, terbang kiri → kanan
- Kata popup: fill putih + stroke merah (sesuai KV)
- Deco atas nempel tepi layar (kompensasi padding transparan PNG)
- Deskripsi cara main maks 3 baris; box NEXT setinggi score+time;
  tombol kontrol lebih besar & rapat; botol TY lebih besar, boleh terpotong
- Waiting screen multiplayer: "Siap Bertanding?" + botol sebagai loading
  (aktif dengan `?wait=<detik>`)

**Belum (menunggu asset/desain):** font resmi dari GDrive (taruh file font di
`assets/fonts/` lalu daftarkan @font-face), confetti TY multiplayer, desain
scoreboard TY final, asset tombol "Saya siap".

## Keputusan dari klien (email Mahda, Jul 2026)

- Maks **4 pemain** per sesi; 1 pemain yang masuk = single player
- Satu-satunya beda multiplayer: pemain saling berkompetisi, dan **TY page
  menampilkan poin semua pemain di sesi itu** (implementasi: daftar peringkat
  di layar Your Score, baris pemain sendiri di-highlight putih; desain final
  menyusul dari Happy Cahyadi)
- Leaderboard kiosk = Top 5 mingguan; pemain hanya melihat skornya sendiri
  di HP setelah main

## Belum dikerjakan (menunggu keputusan/integrasi)

- **Multiplayer sinkron antar pemain** — perlu server (rekomendasi: Node.js + Colyseus);
  saat ini single-player, jendela tunggu hanya simulasi overlay
- **API kiosk vendor** — payload di `js/kiosk.js` masih asumsi, sesuaikan saat skema resmi keluar
- **Validasi skor server-side** — wajib sebelum produksi karena leaderboard berhadiah voucher
- **Font brand (TCCC)** — sementara memakai Montserrat + Oswald dari Google Fonts
- Tombol "Main Lagi" di layar skor tidak ada di desain (ditambahkan untuk pengujian)
