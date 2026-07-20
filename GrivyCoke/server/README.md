# Server Multiplayer — Coke Hangout Tetris

Server sesi untuk mode **single/multiplayer**, sesuai dokumen *"Kebutuhan dari
Grivy"* (12 Jul 2026). **Bukan real-time**: tiap pemain main di papan sendiri
di HP masing-masing. Server hanya:

1. **Waiting room** — mengelompokkan pemain per **`device_id` (kiosk)** +
   window **bergulir** (reset 15 dtk tiap pemain baru join, maks 4). Server
   yang **membuat `session_id`** dan mengembalikannya saat join.
2. **Kumpul skor akhir + ranking** — skor dikirim sekali di akhir sesi.

Aturan mode: mulai jika slot penuh **ATAU** window habis;
`>1 pemain → multiplayer`, `1 pemain → single player`.

> **Kunci grup = `device_id`, BUKAN `whats_app_session_id`** (klarifikasi Grivy
> Jul 2026). Grivy tak punya konsep game-session; `whats_app_session_id` itu
> per-user (1:1, beda tiap pemain) — hanya konteks. Pemain masuk kode di kiosk
> berurutan; yang join ke `device_id` sama dalam window = satu sesi. Kiosk sama
> dipakai berulang: setelah sesi mulai, join berikutnya ke kiosk itu = sesi baru.

Zero dependency (Node 18+). Store **in-memory** — data sesi bersifat sementara
(hanya untuk TY page). Leaderboard mingguan berhadiah dikelola Kiosk Vendor.

## Menjalankan

```bash
cd server
node server.js          # default :8787
npm test                # integrasi test (6 skenario)
```

### Environment variables

| Var | Default | Keterangan |
|---|---|---|
| `PORT` | `8787` | Port server |
| `JOIN_WINDOW_SECONDS` | `15` | Lama window tunggu (dokumen Bagian 5) |
| `MAX_PLAYERS` | `4` | Maks pemain per sesi (email Mahda) |
| `GAME_SECONDS` | `180` | Durasi game — untuk hitung batas kumpul skor |
| `RESULT_GRACE_SECONDS` | `25` | Toleransi menunggu skor pemain yang HP-nya lambat/tutup |
| `CORS_ORIGIN` | `*` | Batasi ke domain game saat produksi |
| `SESSION_TTL_SECONDS` | `300` | Umur sesi di memori setelah selesai |

## API

Semua body/response JSON. CORS aktif (`CORS_ORIGIN`).

| Method | Path | Dipanggil saat | Body / Query |
|---|---|---|---|
| `POST` | `/session/join` | Game di HP dibuka | `{device_id, user_id, nickname, whats_app_session_id?}` → balas `{session_id, …}` |
| `GET`  | `/session/state` | Polling waiting room (~1 dtk) | `?session_id=` |
| `POST` | `/session/score` | Game pemain selesai | `{session_id, user_id, score}` |
| `GET`  | `/session/results` | Polling ranking di TY page | `?session_id=` |
| `GET`  | `/health` | Cek status | — |

**Alur:** `join` mengelompokkan lewat `device_id` lalu **mengembalikan
`session_id`**; klien pakai `session_id` itu untuk `state`/`score`/`results`.
`whats_app_session_id` opsional (konteks per-user, ikut di hasil).

**State (`phase`):** `waiting` → `playing` → `ended`.
`final_mode` (`single`/`multi`) terisi begitu window habis.
`results.ready = true` saat semua pemain submit **atau** grace habis.

## Menghubungkan ke game

Isi base URL server di [`js/config.js`](../js/config.js) (`MP_URL_DEFAULT`) atau
lewat parameter uji `?mp_url=http://localhost:8787`. Kosong = game jalan mode
lokal (single player / simulasi `?others=`). Klien: [`js/session.js`](../js/session.js).

## Deploy — GitHub Pages + host Node

**GitHub Pages hanya melayani file statik, tidak menjalankan Node.js.** Jadi:

- **Game** (html/js/css) → tetap di GitHub Pages: `eldranis12.github.io/GrivyCoke/`.
- **Server ini** → host Node terpisah ber-**HTTPS** (persisten, bukan serverless,
  karena sesi disimpan di memori). Bisa auto-deploy dari repo GitHub yang sama.

> Halaman Pages HTTPS → server **wajib HTTPS** (kalau HTTP, browser blokir karena
> mixed content), dan `CORS_ORIGIN` harus origin game.

### Render (rekomendasi — sudah ada `render.yaml` di root repo)
1. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**.
2. Connect repo `Eldranis12/Eldranis12.github.io`. Render baca `render.yaml`
   otomatis (root dir `GrivyCoke/server`, start `node server.js`, health `/health`).
3. Deploy → dapat URL HTTPS, mis. `https://coke-hangout-mp.onrender.com`.

### Railway / Fly.io (alternatif PaaS)
- **Railway**: Deploy from repo → Root Directory `GrivyCoke/server` (ada `Procfile`).

Set env minimal `CORS_ORIGIN=https://eldranis12.github.io` (lihat `.env.example`).

### Server sendiri (VPS / punya sendiri)

Kalau sudah punya server (Linux + Node 18+), 4 langkah:

1. **Taruh folder `server/`** di mesin (git clone repo, atau `scp -r server/
   user@host:/opt/coke-hangout/`). Zero dependency — tak perlu `npm install`.
2. **Jalankan persisten** pakai systemd (contoh siap pakai:
   [`deploy/coke-mp.service`](deploy/coke-mp.service)) atau `pm2 start server.js
   --name coke-mp`. Set env di situ, minimal `CORS_ORIGIN` + `PORT`.
3. **Kasih HTTPS** — server ini HTTP polos, jadi taruh di belakang reverse proxy
   TLS. Contoh nginx + certbot: [`deploy/nginx.conf.example`](deploy/nginx.conf.example).
   (Game di Pages HTTPS → server **wajib** HTTPS, kalau tidak diblokir browser.)
4. **Sambungkan** — isi `MP_URL_DEFAULT` di [`../js/config.js`](../js/config.js)
   dengan URL HTTPS server (mis. `https://mp.example.com`), `git push`.

Uji dari luar sebelum go-live:
```bash
curl https://mp.example.com/health          # -> {"ok":true,...}
```
Atau tanpa ubah config, tes langsung dari game:
`https://eldranis12.github.io/GrivyCoke/?mp_url=https://mp.example.com&user_id=u1&nickname=Uji&device_id=001`
(2 HP dgn `device_id` sama = satu sesi; `user_id` beda tiap pemain)

> **Sudah punya app Node/Express sendiri?** Bisa digabung: `server.js` mengekspor
> `sessions` + logikanya sederhana (lihat endpoint di bawah) — pindahkan handler
> `/session/*` jadi router di app-mu, atau jalankan port terpisah + proxy subpath
> (lihat catatan subpath di `nginx.conf.example`).

#### Stack Podman + Caddy (network `infini-net`)

Kalau server pakai Podman + Caddy (tiap app = container di `infini-net`, Caddy
reverse-proxy via nama container — pola `photobooth-admin`), file-nya sudah ada:
[`Containerfile`](Containerfile), [`compose.yml`](compose.yml),
[`deploy/Caddyfile.snippet`](deploy/Caddyfile.snippet).

```bash
# 1. di server, folder server/
podman-compose up -d --build            # build + jalankan container coke-mp di infini-net

# 2. tambah subdomain di Caddyfile (lihat deploy/Caddyfile.snippet):
#    coke-mp.8infiniooh.com { reverse_proxy coke-mp:8787 }
#    lalu reload Caddy (cara reload samakan dgn yang biasa dipakai)

# 3. pastikan DNS coke-mp.8infiniooh.com -> server (kalau belum ada wildcard),
#    Cloudflare proxied (origin cert sudah cover *.8infiniooh.com)

# 4. cek
curl https://coke-mp.8infiniooh.com/health     # -> {"ok":true,...}
```

Container tidak mem-publish port ke host — Caddy menjangkaunya lewat
`coke-mp:8787` di dalam `infini-net`. Lalu isi `MP_URL_DEFAULT =
'https://coke-mp.8infiniooh.com'` di [`../js/config.js`](../js/config.js).

### Sambungkan
Setelah server hidup, isi URL-nya di [`js/config.js`](../js/config.js)
(`MP_URL_DEFAULT`) lalu `git push`. Pages update → multiplayer nyala.

## Catatan produksi

- **Skala:** store in-memory hanya untuk 1 instance. Kalau perlu multi-instance
  (load balancer), pindahkan store ke Redis/DB. Untuk aktivasi 1 proses cukup.
- **Validasi skor:** server ini percaya skor dari klien. Wajib divalidasi
  server-side sebelum produksi karena leaderboard berhadiah (lihat README utama).
- **CORS:** set `CORS_ORIGIN` ke domain game final (mis. `https://ayo.coca-cola.co.id`).
- **dev-static.js:** server statik no-cache untuk preview game lokal (dev only),
  bukan bagian dari server multiplayer.
