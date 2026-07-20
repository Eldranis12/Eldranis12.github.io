# Tutorial Deploy — Server Multiplayer Coke Hangout Tetris

> **Untuk: Claude yang jalan di VPS (Podman + Caddy).**
> Semua file server ada di repo GitHub `Eldranis12/Eldranis12.github.io`
> (folder `GrivyCoke/server/`). Ikuti langkah berurutan.

---

## 0. Konteks & tujuan

Men-deploy **server multiplayer** untuk game Tetris "Coke Hangout". Game statik
di GitHub Pages (`https://eldranis12.github.io/GrivyCoke/`); server ini menangani
**waiting room** + **kumpul skor akhir + ranking**. **Bukan real-time** — tiap
pemain main di papan HP sendiri.

- Runtime: **Node.js, zero dependency** (tak ada `npm install`).
- Store: **in-memory** (data sesi sementara; tak perlu DB/volume).
- Hasil akhir: server hidup di `https://coke-mp.8infiniooh.com` (via Caddy).

**Model pengelompokan (penting):** pemain dikelompokkan per **`device_id`
(kiosk)** + window bergulir 15 dtk, BUKAN per `whats_app_session_id` (itu
per-user). Server yang membuat `session_id`. Ini sudah ada di kode — kamu tidak
perlu mengubah logika, cukup deploy.

### Fakta stack server
- Container engine **Podman** + `podman-compose`.
- Reverse proxy **Caddy** (container); tiap app = container di network
  **`infini-net`**; Caddy menjangkau via **nama container:port** (pola:
  `photobooth.8infiniooh.com` → `photobooth-admin:3210`).
- TLS via **Cloudflare Origin cert**.

### ⚠️ Guardrails (WAJIB)
1. **Jangan** sentuh/restart container lain (photobooth dll) atau Caddy selain
   **menambah satu site block** baru.
2. **Backup Caddyfile** sebelum mengedit (`cp Caddyfile Caddyfile.bak`).
3. Pakai network `infini-net` yang **sudah ada** (external) — jangan buat baru.
4. **Jangan publish port ke host** — Caddy menjangkau via nama container.
5. Kalau ada yang tidak sesuai asumsi (nama network beda, cara reload Caddy
   beda), **berhenti dan lapor**, jangan menebak yang destruktif.

---

## 1. Ambil file dari repo

```bash
cd ~
git clone https://github.com/Eldranis12/Eldranis12.github.io.git coke-hangout
cd coke-hangout/GrivyCoke/server
# (update berikutnya cukup: git pull)
```

Folder ini sudah berisi `server.js`, `Containerfile`, `compose.yml`,
`package.json` — semua yang dibutuhkan.

```bash
node --check server.js && echo "server.js OK"    # kalau node ada di host
node test.js                                      # opsional: 7 integrasi test
```

---

## 2. Build & jalankan container

```bash
podman-compose up -d --build
podman ps --filter name=coke-mp        # STATUS harus Up (healthy)
podman logs coke-mp                     # harus: [mp] server jalan di :8787 ...
```

`compose.yml` sudah men-set env (`CORS_ORIGIN=https://eldranis12.github.io`,
window 15 dtk, maks 4) dan join ke `infini-net` tanpa publish port.

<details><summary>Tanpa podman-compose (podman manual)</summary>

```bash
podman build -t coke-mp -f Containerfile .
podman run -d --name coke-mp --restart unless-stopped --network infini-net \
  -e PORT=8787 -e CORS_ORIGIN=https://eldranis12.github.io \
  -e JOIN_WINDOW_SECONDS=15 -e MAX_PLAYERS=4 -e GAME_SECONDS=180 coke-mp
```
</details>

---

## 3. Tambah subdomain di Caddy

Cari Caddyfile yang dipakai container Caddy. **Backup dulu**, lalu tambahkan blok
ini — **tiru pola blok `photobooth`** (khususnya baris `tls` kalau per-site):

```caddy
coke-mp.8infiniooh.com {
    # samakan baris TLS dgn blok photobooth (Cloudflare Origin cert), mis:
    # tls /path/cf-origin.pem /path/cf-origin.key
    reverse_proxy coke-mp:8787
}
```

Reload Caddy (pakai cara yang biasa; jangan restart paksa kalau ada reload halus):
```bash
podman exec caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
  || podman-compose restart caddy      # fallback, sesuaikan
```

---

## 4. DNS & verifikasi

Pastikan `coke-mp.8infiniooh.com` mengarah ke server (Cloudflare A record →
proxied). Kalau sudah ada wildcard `*.8infiniooh.com`, tak perlu tambah apa-apa.

```bash
curl -s https://coke-mp.8infiniooh.com/health          # -> {"ok":true,...}
```

Uji sesi 1 pemain (window 15 dtk; `join` balas `session_id`):
```bash
BASE=https://coke-mp.8infiniooh.com
SID=$(curl -s -X POST $BASE/session/join -H 'Content-Type: application/json' \
  -d '{"device_id":"kiosk-uji","user_id":"u1","nickname":"Uji"}' \
  | sed -E 's/.*"session_id":"([^"]+)".*/\1/')
echo "session_id=$SID"
sleep 16
curl -s -X POST $BASE/session/score -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"$SID\",\"user_id\":\"u1\",\"score\":123}"
curl -s "$BASE/session/results?session_id=$SID"
# -> {..."ready":true,"results":[{"nickname":"Uji","score":123,...}]}
```

Kalau `/health` balas `{"ok":true}` dan hasil di atas muncul, **server siap**. ✅

---

## 5. Lapor balik

Sampaikan ke user:
- URL publik: **`https://coke-mp.8infiniooh.com`**
- Output `curl /health`
- Status container `coke-mp` (Up/healthy)

Sisi game **sudah** menunjuk ke URL ini (`MP_URL_DEFAULT` di `js/config.js`),
jadi begitu server hidup, multiplayer langsung aktif — tak perlu ubah game.

---

## Update / maintenance

```bash
cd ~/coke-hangout && git pull
cd GrivyCoke/server && podman-compose up -d --build
podman logs -f coke-mp
```

## Troubleshooting

| Gejala | Kemungkinan | Aksi |
|---|---|---|
| `/health` refused via Caddy | site block/DNS belum aktif | `podman logs caddy`; cek DNS resolve |
| Caddy 502 | Caddy tak bisa jangkau `coke-mp:8787` | pastikan container `coke-mp` di `infini-net` & Up |
| Game gagal (CORS error di console HP) | `CORS_ORIGIN` ≠ origin game | pastikan `CORS_ORIGIN=https://eldranis12.github.io` di `compose.yml`, `up -d` |
| Container restart terus | error runtime | `podman logs coke-mp` |
