# FANTA Horror Game

Mini-game kampanye FANTA x Suzzanna. Pemain menjaga botol FANTA dari tangan Suzzanna
yang muncul dari kuburan selama 30 detik; yang bertahan dapat voucher bioskop lewat
platform kupon Grivy.

Statis sepenuhnya — HTML, CSS, dan JavaScript biasa. Tidak ada build step, tidak ada
dependency, tidak ada `npm install`.

---

## Menjalankan secara lokal

Butuh web server. **Membuka `index.html` langsung lewat `file://` tidak akan jalan** —
poster share diambil dengan `fetch()`, dan browser memblokirnya di origin `file://`.

Server apa pun bisa. Yang paling ringkas, tanpa instalasi (Python sudah ada di
kebanyakan mesin):

```bash
python -m http.server 8661
```

Lalu buka <http://localhost:8661/index.html>.

Kalau tidak ada Python:

```bash
npx serve -l 8661
```

### Perlu tahu saat development lokal

API kuota Grivy tidak bisa dijangkau dari `localhost`, jadi console akan memunculkan
error dan game jatuh ke mode **"Kupon Habis"** (fail-closed — disengaja, supaya kupon
tidak pernah ditawarkan kalau statusnya belum jelas). Untuk melihat tampilan normal,
paksa lewat URL:

```
http://localhost:8661/index.html?coupon=active
```

---

## Parameter URL

Semua opsional. Berguna untuk QA tanpa menyentuh kode.

| Parameter | Nilai | Fungsi |
|---|---|---|
| `?coupon=active` | — | Paksa kupon tersedia (lewati cek API) |
| `?coupon=out` | — | Paksa kupon habis, untuk menguji state "YAKALI GAK MAU FANTA" |
| `?env=` | `live` \| `test` | Pilih channel Grivy |
| `?channel=` | `1` \| `0` | Sama seperti `?env`, format angka |

Contoh: `index.html?env=live&coupon=active`

---

## Struktur

```
FantaHorror/
├── index.html          # Kelima layar: LP, pilih voucher, game, menang, kalah
├── index.css           # Seluruh styling & layout responsif
├── js/
│   ├── game.js         # Game engine, config Grivy, alur layar
│   └── sound.js        # SoundManager: BGM, SFX, mute
└── assets/
    ├── *.webp / *.png  # Artwork (webp yang di-serve)
    ├── fonts/          # Bebas Neue Pro
    └── sounds/*.mp3    # 15 klip audio
```

---

## Konfigurasi kampanye

Diatur di bagian atas [`js/game.js`](js/game.js):

```js
const DEFAULT_CHANNEL = 0;   // 0 = Staging/Testing, 1 = Live
```

Channel 0 mengarah ke `stage.grivy.app`, channel 1 ke `fun.fanta.id`. Kode kampanye
per channel ada di array `CHANNELS`.

Bisa juga di-override tanpa mengubah file, dengan mendefinisikan
`window.FANTA_HORROR_CONFIG` **sebelum** `game.js` dimuat — berguna kalau game
di-embed dan host-nya yang menentukan channel:

```html
<script>window.FANTA_HORROR_CONFIG = { env: 'live' };</script>
```

Urutan prioritas: parameter URL → `window.FANTA_HORROR_CONFIG` → `DEFAULT_CHANNEL`.

Untuk merilis ke live, ikuti [GANTI-KE-LIVE.md](GANTI-KE-LIVE.md)
([English](SWITCH-TO-LIVE.md)) — termasuk syarat
hosting yang, kalau dilanggar, membuat semua pemain melihat "kupon habis" tanpa
pesan error apa pun.

### Parameter gameplay

Konstanta di [`js/game.js`](js/game.js), sekitar baris 152:

| Konstanta | Nilai | Arti |
|---|---|---|
| `SESSION_SIZE` | `5` | Botol per gelombang |
| `SESSION_THREATS` | `1` | Berapa botol per gelombang yang diincar Suzzanna |
| `SESSION_GAP_MS` | `700` | Jeda antar gelombang |
| `ATTACK_DELAY_MS` | `1000` | Jeda sebelum tangan muncul |

Durasi ronde (`30` detik) dan jumlah nyawa (`5`) ada di constructor `FantaHorrorGame`.

---

## Deploy

Repo ini adalah GitHub Pages, dan FantaHorror salah satu subfoldernya. Push ke `main`
langsung tayang — tidak ada pipeline build:

<https://eldranis12.github.io/FantaHorror/>

### Cache busting — jangan dilewat

Semua `<link>`, `<script>`, dan sebagian `<img>` di `index.html` membawa query `?v=`:

```html
<link rel="stylesheet" href="index.css?v=20260810-bleed3">
<script src="js/game.js?v=20260805-ambientsound"></script>
```

**Setiap kali mengubah CSS/JS, ganti nilai `?v=`-nya.** Kalau tidak, browser yang
sudah pernah membuka game akan tetap memakai versi lama, dan kamu akan mengejar bug
yang sebenarnya sudah diperbaiki. Ini pernah kejadian selama development.

---

## Catatan aset

**Yang di-serve adalah `.webp` dan `.mp3`.** File `.png` dan `.wav` mentah sudah
dikeluarkan dari repo karena tidak pernah dimuat browser — masternya ada di Google
Drive tim desain, dan versi lamanya masih tersimpan di git history.

Saat mengganti artwork, konversi ke webp dan jaga rasio artboard tetap **6:13**
(1080 × 2340) — seluruh posisi UI dihitung sebagai persentase dari artboard itu:

```bash
python -c "from PIL import Image; im=Image.open('baru.png'); im.save('assets/baru.webp','WEBP',quality=88,method=6)"
```

Audio dari `.wav` ke `.mp3` (wav mentah bisa 17 MB, terlalu berat untuk web):

```bash
ffmpeg -i "klip.wav" -c:a mp3_mf -b:a 128k -ar 44100 -ac 2 "assets/sounds/klip.mp3"
```

Daftar klip ada di map `this.sounds` dalam [`js/sound.js`](js/sound.js) —
kunci di situ menentukan nama file yang dicari (`assets/sounds/<nama>.mp3`).

### Aset yang dipanggil secara dinamis

Sebagian besar aset ditulis lengkap di HTML/CSS, tapi tiga kelompok ini dibangun saat
runtime dan **tidak akan terdeteksi kalau kamu mencari nama filenya di kode**:

- `assets/crop_voucher_${tipe}_{active,habis}.webp` — di `updateVoucherUI()`
- `assets/sounds/<nama>.mp3` — di `clip()` pada `sound.js`
- Artwork layar hasil — di `preloadResultArt()`

Hati-hati saat merapikan aset: pencarian teks biasa akan mengira file-file ini tidak
terpakai.

---

## Layout responsif

Artboard dikunci di rasio 6:13. Di HP yang lebih persegi (16:9 seperti iPhone SE),
artboard tidak bisa dilebarkan sampai memenuhi layar — pita UI membentang dari 2%
(headline menang) sampai 93% (tombol AMBIL VOUCHER) tinggi artboard, dan pada lebar
penuh pita itu jadi lebih tinggi dari layar.

Solusinya: kotak UI dibatasi agar semuanya muat, lalu celah kiri-kanan diisi salinan
background yang di-blur (`.screen::before`). Crop vertikalnya dibagi dengan proporsi
2:7 mengikuti sisa ruang di atas dan bawah, bukan rata tengah — rata tengah memotong
headline layar menang.

Kalau mengubah posisi elemen paling atas atau paling bawah, angka-angka itu perlu
dihitung ulang; komentarnya ada di [`index.css`](index.css) pada blok
`@media (max-width: 767px)`.

---

## Halaman testing

Dulu ada `test.html` — panel QA untuk lompat ke layar mana pun tanpa memainkan
gamenya. File itu dikeluarkan sebelum publish karena GitHub Pages menyajikan semua
isi repo, sehingga panel itu ikut bisa diakses publik dan memberi jalan pintas ke
layar menang beserta tombol klaim vouchernya.

Kalau butuh untuk QA, ambil lagi dari git history dan jalankan lokal saja:

```bash
git show 8afae3b:FantaHorror/test.html > test.html
```

Jangan di-commit kembali ke `main`.
