# Ganti FANTA Horror dari Testing ke Live

Panduan mengubah game dari channel **staging** ke **live campaign**.

*(English version: [SWITCH-TO-LIVE.md](SWITCH-TO-LIVE.md))*

Inti perubahannya cuma satu angka. Sisanya verifikasi — dan ada satu jebakan
(lihat [Syarat penting](#syarat-penting-domain-hosting)) yang bisa membuat semua
pemain melihat "kupon habis" walau kuponnya masih ada.

---

## Perbedaan kedua channel

| | Channel `0` — Testing | Channel `1` — Live |
|---|---|---|
| Domain | `https://stage.grivy.app` | `https://fun.fanta.id` |
| Kode kampanye bioskop | `fanta-horror-testing-main-cinema` | `fanta-horror-196` |
| Kode kampanye Fanta | `fanta-horror-testing-main-voucher` | `fanta-horror-564` |

Kode-kode ini yang dipakai untuk cek kuota kupon **dan** untuk mengarahkan pemain
saat menekan tombol "AMBIL VOUCHER DI SINI". Kalau channel salah, pemain
diarahkan ke kampanye yang salah.

---

## Langkah 1 — Channel

**Sudah dilakukan.** [`js/game.js`](js/game.js) **baris 13** kini terkirim sebagai:

```js
const DEFAULT_CHANNEL = 1; // 0 = Staging / Testing, 1 = Live / Real Campaign
```

Untuk kembali ke staging, ubah `1` menjadi `0`. Hanya itu — jangan ubah array
`CHANNELS` di bawahnya, kode kampanye untuk kedua channel sudah terisi di sana.

## Langkah 2 — Naikkan versi cache

Ini **wajib**, bukan opsional. Browser menyimpan `game.js` di cache; tanpa ini
pemain lama bisa tetap menjalankan versi testing berhari-hari.

Buka [`index.html`](index.html), **baris 193**:

```html
<script src="js/game.js?v=20260813-coupon-fix"></script>
```

Ganti nilai `?v=` dengan apa pun yang baru, misalnya tanggal go-live:

```html
<script src="js/game.js?v=20260901-live"></script>
```

## Langkah 3 — Commit dan push

```bash
git add js/game.js index.html && git commit -m "Ganti channel ke live" && git push
```

---

## Verifikasi

Buka game, lalu buka **console browser** (di HP: pakai Safari/Chrome remote
debugging, atau tes dulu di desktop). Cari baris log:

```
[GRIVY DEBUG hh:mm:ss] 🎟️ Init Config & Channel Info
```

Buka grup itu dan pastikan isinya:

```
channelMode : "1 (Real Campaign)"
domain      : "https://fun.fanta.id"
activeCodes : { cinemaMain: "fanta-horror-196", fantaMain: "fanta-horror-564" }
```

Kalau masih tertulis `0 (Staging / Testing)` atau domainnya `stage.grivy.app`,
berarti Langkah 1 belum tersimpan atau browser masih memakai `game.js` lama —
ulangi Langkah 2 dan muat ulang dengan hard refresh.

Lalu cek satu log berikutnya, `API Request: Check Coupon Quota`, dan pastikan
`endpointUrl` mengarah ke `https://fun.fanta.id/api/games/campaigns-check-active`.

---

## Syarat penting: domain hosting

**Game harus di-hosting di `fun.fanta.id`** (production-nya di
`fun.fanta.id/c/fanta-horror-game-922`).

Alasannya: pengecekan kuota memanggil `https://fun.fanta.id/api/games/campaigns-check-active`.
Kalau game dibuka dari domain lain — misalnya `eldranis12.github.io` — panggilan
itu jadi lintas-domain dan besar kemungkinan diblokir browser (CORS).

Yang terjadi kalau diblokir: game **tidak error**, tapi jatuh ke mode aman
*fail-closed* dan menganggap **kupon habis**. Semua pemain akan melihat state
"YAKALI GAK MAU FANTA" walau kuponnya sebenarnya masih tersedia — dan tidak ada
pesan error yang kelihatan oleh pemain.

Jadi: `DEFAULT_CHANNEL = 1` di GitHub Pages **bukan** tes yang sah. Uji live
hanya di `fun.fanta.id`.

---

## Cara lain (tanpa mengubah kode)

Berguna untuk mengetes live sebelum benar-benar merilis.

### Lewat URL

Tambahkan parameter di URL:

```
?env=live       (atau ?channel=1)   -> paksa live
?env=test       (atau ?channel=0)   -> paksa testing
```

Contoh: `https://fun.fanta.id/c/fanta-horror-game-922?env=live`

### Lewat konfigurasi host

Kalau game di-embed dan host-nya yang menentukan channel, definisikan variabel
ini **sebelum** `game.js` dimuat:

```html
<script>window.FANTA_HORROR_CONFIG = { env: 'live' };</script>
```

### Urutan prioritas

Parameter URL → `window.FANTA_HORROR_CONFIG` → `DEFAULT_CHANNEL`

Artinya parameter URL selalu menang. Kalau ada yang membagikan tautan berisi
`?env=test`, penerima akan menjalankan versi testing meski `DEFAULT_CHANNEL`
sudah `1`.

---

## Jangan sebarkan parameter QA

Parameter ini melewati pengecekan kuota asli dan **memaksa** state kupon:

| Parameter | Efek |
|---|---|
| `?coupon=active` | Paksa semua kupon tersedia |
| `?coupon=out` | Paksa semua kupon habis |
| `?coupon=fanta-out` | Paksa kupon Fanta habis |
| `?coupon=cinema-out` | Paksa kupon bioskop habis |

Sengaja dibiarkan aktif untuk QA. Tapi jangan dipakai di tautan yang disebar ke
publik: `?coupon=active` membuat game menawarkan voucher walau kuotanya sudah
habis di Grivy.

---

## Kembali ke testing

Balikkan `DEFAULT_CHANNEL` ke `0`, naikkan lagi `?v=` di `index.html`, commit,
push. Atau untuk cek cepat tanpa deploy, buka dengan `?env=test`.

---

## Kalau bermasalah

**Semua pemain lihat "kupon habis" padahal kuota masih ada**
Hampir pasti panggilan API gagal dan game jatuh ke *fail-closed*. Cek console
untuk `Coupon Quota API Check Failed / Fallback Active`. Penyebab tersering:
game tidak di-hosting di `fun.fanta.id` (lihat [Syarat penting](#syarat-penting-domain-hosting)),
atau API tidak menjawab dalam 3 detik (ada batas waktu).

**Channel masih testing padahal sudah diubah**
Cache. Pastikan `?v=` di `index.html` sudah diganti, lalu hard refresh. Cek juga
URL tidak mengandung `?env=test` — parameter URL mengalahkan setelan di kode.

**Tombol voucher mengarah ke kampanye yang salah**
Berarti channel-nya salah. Verifikasi lewat log `Init Config & Channel Info`
seperti di bagian [Verifikasi](#verifikasi).

**Melihat respons mentah dari API**
Ketik `lastGrivyResponse` di console. Kalau ada error, `lastGrivyError` berisi
pesannya.
