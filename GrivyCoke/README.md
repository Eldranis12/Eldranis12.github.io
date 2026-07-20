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

- `device_id` — **kunci pengelompokan multiplayer** (kiosk). Pemain dengan
  `device_id` sama yang join dalam window 15 dtk = satu sesi game.
- `whats_app_session_id` — per-user (1:1, beda tiap pemain); **konteks saja**,
  bukan kunci grup.
- `user_id` — pembeda pemain di dalam sesi. `nickname` — tampil di ranking.

Tambahan untuk pengujian/konfigurasi:

- `duration` — lama permainan dalam detik (default `180` sesuai spec sheet FA; brief menyebut 2 menit → pakai `duration=120` bila itu yang final)
- `mp_url` — base URL server multiplayer (mis. `?mp_url=http://localhost:8787`).
  Kosong = mode lokal (single player / simulasi `?others=`). Produksi: isi
  `MP_URL_DEFAULT` di `js/config.js`.
- `join_window` — lama window tunggu multiplayer di server, dalam detik (default 15)
- `wait` — (mode lokal) simulasi overlay tunggu tanpa server, dalam detik
- `others` — (mode lokal) simulasi hasil pemain lain untuk demo TY page,
  contoh `?others=Nadia:450,Bima:300`
- `kiosk_start_url`, `kiosk_end_url` — endpoint kiosk vendor (sementara, sampai detail API resmi tersedia)

## Mode Single / Multiplayer

**Bukan real-time** — tiap pemain main di papan sendiri; server hanya
mengelompokkan pemain + mengumpulkan skor akhir.

- **Pengelompokan (klarifikasi Grivy Jul 2026)** — per **`device_id` (kiosk)**,
  bukan `whats_app_session_id`. Grivy tak punya konsep game-session; game yang
  mengelola. Pemain masuk kode di kiosk berurutan; yang join ke `device_id`
  sama dalam window = satu sesi. Server yang **membuat `session_id`**.
- **Waiting room** — window **bergulir**: reset 15 dtk tiap pemain baru join
  (maks 4). Overlay menampilkan daftar pemain + hitung mundur.
- **Penentuan mode** — mulai saat slot penuh **ATAU** window habis;
  `>1 pemain → multiplayer`, `1 pemain → single player`.
- **TY page** — multiplayer = panel **SCOREBOARD** ranking semua pemain (baris
  sendiri di-highlight, botol tampil); single player = "YOUR SCORE" + skor.
- **Fallback aman** — kalau server tak terjangkau / tanpa `user_id`, game
  jalan single player.

Komponen:
- Klien: [`js/session.js`](js/session.js) (abstraksi remote/local) +
  wiring di [`js/main.js`](js/main.js).
- Server: [`server/`](server/) — Node.js zero-dependency. Lihat
  [server/README.md](server/README.md) untuk API & cara menjalankan.

Untuk dev lokal: game pakai server statik no-cache
[`server/dev-static.js`](server/dev-static.js) (dikonfigurasi di
`.claude/launch.json`); jalankan server multiplayer terpisah di `server/`.

**Hosting** — game statik tetap di **GitHub Pages** (`eldranis12.github.io/GrivyCoke/`,
single player jalan penuh di sana). Server multiplayer **tidak bisa** di GitHub
Pages (Pages hanya statik) → deploy ke host Node ber-HTTPS terpisah, bisa
auto-deploy dari repo yang sama (blueprint [`render.yaml`](../render.yaml)). Lalu
isi URL server di `MP_URL_DEFAULT` ([js/config.js](js/config.js)). Detail:
[server/README.md](server/README.md).

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

## Feedback lanjutan (PDF "Untitled presentation") — sudah diterapkan

- Font resmi TCCC Unity terpasang (`assets/fonts/`): HUD/angka pakai
  **TCCC Unity Cond**, teks lain **TCCC Unity Head** (Google Fonts dihapus)
- Confetti pakai asset resmi `Confetti 30.mov` → dikonversi ke
  `assets/video/confetti.avif` (animated AVIF transparan, 163KB, 20fps);
  fallback confetti canvas untuk browser tanpa dukungan AVIF animasi
- Bug fix: balok yang melengkapi baris kini ikut memudar bersama baris
  (sebelumnya digambar ulang sebagai balok aktif selama animasi clear)
- Teks Combo sekarang putih + stroke merah, sama dengan popup utama

**Belum (menunggu asset/desain):** desain scoreboard TY final,
asset tombol "Saya siap".

## Keputusan dari klien (email Mahda, Jul 2026)

- Maks **4 pemain** per sesi; 1 pemain yang masuk = single player
- Satu-satunya beda multiplayer: pemain saling berkompetisi, dan **TY page
  menampilkan poin semua pemain di sesi itu** (implementasi: daftar peringkat
  di layar Your Score, baris pemain sendiri di-highlight putih; desain final
  menyusul dari Happy Cahyadi)
- Leaderboard kiosk = Top 5 mingguan; pemain hanya melihat skornya sendiri
  di HP setelah main

## Belum dikerjakan (menunggu keputusan/integrasi)

- ~~**Multiplayer sinkron antar pemain**~~ — **sudah dibangun** (`server/`, Node.js).
  Catatan: model TIDAK real-time (papan tiap pemain independen; server hanya
  waiting room + kumpul skor), jadi Colyseus tidak diperlukan. Yang tersisa:
  deploy server ke domain HTTPS + isi `MP_URL_DEFAULT` di `js/config.js`.
- **API kiosk vendor** — payload di `js/kiosk.js` masih asumsi, sesuaikan saat skema resmi keluar
- **Validasi skor server-side** — wajib sebelum produksi karena leaderboard berhadiah voucher
- **Font brand (TCCC)** — sementara memakai Montserrat + Oswald dari Google Fonts
- Tombol "Main Lagi" di layar skor tidak ada di desain (ditambahkan untuk pengujian)
