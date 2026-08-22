# Backend PHP + MySQL — Coke Hangout (Nongkrong) Tetris

Backend sesi + leaderboard. Menggantikan `server/server.js` (Node, store
in-memory) karena hosting produksi = **Niagahoster paket Bisnis (shared
cPanel)**: yang dijamin ada di situ PHP + MySQL, bukan proses Node 24/7.
Server Node lama menyimpan sesi di RAM — di shared hosting prosesnya bisa
di-restart kapan saja dan semua sesi + skor hilang. Versi ini stateless:
seluruh state ada di MySQL. `server/server.js` tetap dipakai untuk dev lokal.

Sudah disesuaikan dengan dokumen **"Kiosk Vendor Feedback"** (Q1–Q7).

## Penamaan field (Q1 — kesepakatan lintas vendor)

Grivy meminta satu nama yang sama dipakai ketiga pihak. Yang dipakai di sini:

| Nama | Arti |
|---|---|
| `wa_session_id` | id sesi WhatsApp milik Grivy, **per-user (1:1)**. Konteks + kunci submit pemenang. **Bukan** kunci grup |
| `user_uid` | id pemain dari Grivy — kunci pencocokan pemenang (Q7) |
| `kiosk_id` | = `device_id`. **Kunci pengelompokan multiplayer** |
| `game_session_id` | id sesi game, **dibuat backend ini** |
| `nickname` | versi NORMALISASI Grivy (trim, spasi rapat, HURUF BESAR) — untuk pencocokan |
| `nickname_entered` | teks asli persis seperti diketik pemain — **inilah yang ditampilkan** |

Nama lama (`device_id`, `user_id`, `whats_app_session_id`) masih diterima
supaya link yang sudah beredar tidak rusak.

> ⚠️ **Belum beres:** contoh game URL yang ditulis Grivy di dokumen
> **tidak memuat `device_id`/`kiosk_id`**, padahal seluruh pengelompokan
> multiplayer bergantung padanya. Tanpa parameter itu, tiap pemain jatuh ke
> sesi solo. Harus dikonfirmasi ke Grivy sebelum produksi.

## Aturan yang mengikuti feedback

- **Q4 — server-to-server.** Game Start / Game End dikirim backend ini ke API
  kiosk, bukan dari browser. Kejadian diantrekan ke tabel `kiosk_events` lalu
  dikirim worker (retry + jejak error), supaya request pemain tidak menunggu
  API kiosk. Panggilan langsung dari klien sudah dicabut dari `js/kiosk.js`.
- **Q5 — diskualifikasi.** Pemain yang putus / tidak menyelesaikan game (tidak
  pernah mengirim skor akhir sampai sesi ditutup) ditandai `disqualified`,
  skornya jadi 0, dan tidak dihitung di leaderboard. Skor live-nya sengaja
  **tidak** dipakai.
- **Q6 — leaderboard mingguan.** Skor **kumulatif** sepanjang minggu kalau
  pemain main berkali-kali; reset tiap Senin (ISO week, WIB). Bisa diubah ke
  skor tertinggi lewat `leaderboard_scoring` atau `?scoring=best`.
- **Q7 — pencocokan pemenang** memakai `user_uid`, bukan nickname.

## Yang disimpan

| Tabel | Isi | Umur |
|---|---|---|
| `sessions` | sesi kiosk yang sedang berjalan | sementara (±5 menit setelah selesai) |
| `session_players` | pemain + skor berjalan | ikut sesi (CASCADE) |
| `game_history` | **riwayat permanen tiap permainan** | selamanya — arsip + sumber leaderboard |
| `kiosk_events` | antrean & jejak panggilan server-to-server ke kiosk | selamanya (audit) |

Begitu sebuah sesi masuk fase `ended`, semua pemainnya diarsipkan ke
`game_history`. Karena itu `/session/results` tetap bisa menampilkan ranking
walau baris sesinya sudah dibersihkan.

## API

### Sesi (dipakai game)

| Method | Path | Dipanggil saat |
|---|---|---|
| `POST` | `/session/join` | Game di HP dibuka → balas `{session_id, game_session_id, …}` |
| `GET`  | `/session/state?session_id=` | Polling waiting room (~1 dtk) |
| `POST` | `/session/score` | Skor live (`live:true`) & skor akhir |
| `GET`  | `/session/results?session_id=` | Polling ranking di TY page |
| `*`    | `/health` | Cek status (menerima method apa pun) |

### Leaderboard

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/leaderboard` | Papan mingguan. `?week=2026W34`, `?limit=10`, `?all_time=1`, `?scoring=best`. **Publik** — `wa_session_id` sengaja tidak disertakan |
| `GET` | `/leaderboard/weeks` | Daftar minggu yang punya data + rentang tanggalnya. **Publik** |
| `GET` | `/leaderboard/winners?token=…` | Top-N + `wa_session_id` untuk submit pemenang mingguan (Q1). `?top=10`, `?week=`. **Admin** |

Baris leaderboard berisi `rank`, `user_uid`, `nickname_entered`, `score`
(sesuai mode skor), `total_score`, `best_score`, `plays`, `kiosk_id`,
`first_played`, `last_played`.

**Tie-break:** total sama → yang lebih dulu mencapainya (`last_played` paling
awal) di atas. Aturan resmi tie-break ada di sisi kiosk; ini hanya default
deterministik supaya urutan tidak acak.

### Operasional (admin)

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/history?token=…` | Riwayat mentah. `?day=`, `?week=`, `?user_uid=`, `?kiosk_id=`, `?session_id=`, `?limit=`, `?offset=`, `?include_dq=1` |
| `GET` | `/stats?token=…` | Rekap: total main, pemain unik, hari ini, minggu ini, single vs multi, status antrean kiosk |
| `GET` | `/kiosk/flush?token=…` | Kirim antrean Game Start/End yang tertunda |
| `GET` | `/kiosk/events?token=…` | Lihat antrean + error terakhir tiap kejadian |
| `GET` | `/cleanup?token=…` | Bersihkan baris sesi lama |

Token admin dikirim lewat `?token=` atau header `X-Admin-Token`.

## Pasang di cPanel Niagahoster

1. **Buat database** — cPanel → *MySQL® Databases*: buat database (mis.
   `coke`), buat user, lalu *Add User To Database* dengan **ALL PRIVILEGES**.
   Nama lengkapnya berprefix username hosting (mis. `abcd1234_coke`).
2. **Upload** seluruh isi folder `server-php/` ke `public_html/coke-api/`.
3. **Isi kredensial** — rename `config.example.php` jadi `config.php`, lalu
   isi `db_*`, `cors_origin`, dan `admin_token` (string acak panjang, mis.
   hasil `openssl rand -hex 24`).
4. **Buat tabel** — buka sekali:
   `https://DOMAIN/coke-api/install.php?token=ADMIN_TOKEN` → harus
   `{"ok":true,…}`. **Hapus `install.php`** setelah berhasil.
5. **Cek** — `https://DOMAIN/coke-api/health` → `{"ok":true,…}`.
6. **HTTPS** — cPanel → *SSL/TLS Status* → *Run AutoSSL*. Wajib, karena game
   di-serve lewat HTTPS (mixed content akan diblok browser).
7. **Arahkan game** — di [`js/config.js`](../js/config.js) ubah
   `MP_URL_DEFAULT` jadi `https://DOMAIN/coke-api` (tanpa `/` di akhir).
8. **Cron** — hPanel → *Tingkat lanjut → Cron Jobs*, mode **PHP**, tiap
   **1–5 menit** (bukan 15, karena cron ini juga yang mengirim event ke
   kiosk). Jadwal `*/2 * * * *`, dan kolom perintah diisi **path relatif
   saja**:
   ```
   domains/NAMADOMAIN/public_html/coke-api/cleanup.php
   ```
   hPanel otomatis menambah prefix `/usr/bin/php $HOME/` di depannya. Kalau
   perintah lengkap ikut ditempel, prefiksnya dobel dan cron gagal tanpa
   pesan. Pastikan juga kolom **Jam** dibiarkan `*` — kalau terisi `0`, cron
   hanya hidup pukul 00:00–00:59.

   Catatan: `crontab` lewat SSH diblokir di shared hosting Hostinger, jadi
   cron memang harus dipasang lewat panel.
9. **Isi endpoint kiosk** di `config.php` (`kiosk_start_url`, `kiosk_end_url`,
   `kiosk_api_key`) begitu kiosk vendor mengirim detailnya. Selama kosong,
   event **tidak** diantrekan sama sekali — jadi tidak ada yang menumpuk.

## Konfigurasi

Semua di `config.php`, bisa ditimpa environment variable berawalan `COKE_`
(dipakai test/staging), mis. `COKE_JOIN_WINDOW_SECONDS=5`.

| Kunci | Default | Keterangan |
|---|---|---|
| `join_window_seconds` | `15` | Window tunggu bergulir |
| `max_players` | `4` | Maks pemain per sesi |
| `game_seconds` | `180` | Durasi game default |
| `result_grace_seconds` | `25` | Toleransi menunggu skor pemain lambat sebelum DQ |
| `session_ttl_seconds` | `300` | Umur baris sesi setelah selesai |
| `cors_origin` | `['https://eldranis12.github.io']` | Domain game. Produksi jangan `*` |
| `max_score` | `100000` | Batas atas skor yang dianggap wajar |
| `admin_token` | *(kosong)* | Token endpoint admin. Kosong = admin dimatikan |
| `leaderboard_scoring` | `cumulative` | `cumulative` (Q6) atau `best` |
| `kiosk_start_url` / `kiosk_end_url` | *(kosong)* | Endpoint kiosk (server-to-server) |
| `kiosk_api_key` / `kiosk_api_key_header` | *(kosong)* / `Authorization` | Auth kiosk |
| `kiosk_timeout_seconds` | `10` | Timeout panggilan kiosk |
| `kiosk_max_attempts` | `5` | Batas percobaan ulang sebelum ditandai `failed` |
| `timezone` | `Asia/Jakarta` | Untuk `played_at` & kunci minggu |

## Dev lokal

```bash
cd server-php
cp config.example.php config.php     # isi kredensial MySQL lokal
php -S 127.0.0.1:8787 router-dev.php
```

Lalu buka game dengan `?mp_url=http://127.0.0.1:8787`.

## Test

```bash
cd server-php
COKE_DB_NAME=coke_test COKE_DB_USER=root COKE_DB_PASS= php test.php
```

Butuh MySQL/MariaDB jalan + database uji kosong. **Isi database uji
di-TRUNCATE tiap kali test jalan** — jangan arahkan ke database produksi.
21 skenario: 7 pertama sama persis dengan `server/test.js` (grouping kiosk,
rolling window, maks 4, re-join), sisanya penyesuaian feedback (penamaan
field, kompatibilitas nama lama, diskualifikasi, leaderboard kumulatif,
minggu ISO, `wa_session_id` untuk pemenang, antrean kiosk server-to-server)
dan perilaku khusus database (arsip riwayat, fallback hasil, validasi skor,
proteksi token admin).

## Catatan

- **Konkurensi.** Pemain masuk kode di kiosk hampir bersamaan dan tiap request
  PHP jalan paralel, jadi `join` dibungkus `GET_LOCK` per kiosk + transaksi
  `SELECT … FOR UPDATE`. Sudah diuji dengan 4 join benar-benar paralel.
- **Validasi skor.** Masih ringan (batas `max_score`, skor hanya bisa naik).
  Justru inilah alasan kiosk mewajibkan server-to-server (Q4): hop
  browser → backend ini tetap bisa dipalsukan. Karena leaderboard berhadiah
  voucher, validasi yang lebih kuat sebaiknya ditambahkan sebelum produksi.
- **Siapa pemilik leaderboard.** Dokumen menyebut leaderboard & winner logic
  dikelola kiosk vendor. Leaderboard di sini berdiri sendiri di atas
  `game_history` — perlu dikonfirmasi ke Grivy/Mahda apakah dipakai sebagai
  sumber resmi atau hanya rekap internal, supaya tidak dobel.
