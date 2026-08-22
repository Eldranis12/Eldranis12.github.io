// ============================================================
// Konfigurasi game + parameter URL dari Grivy
// ============================================================

const url = new URLSearchParams(location.search);

// Base URL backend sesi + leaderboard (PHP + MySQL, folder server-php/,
// di-deploy ke Hostinger/Niagahoster). Saat game dibuka di localhost (dev)
// otomatis pakai server lokal :8787 — bisa `node server/server.js` atau
// `php -S 127.0.0.1:8787 server-php/router-dev.php`. Override kapan saja:
// ?mp_url= (mis. ?mp_url=http://192.168.1.5:8787 untuk uji dari HP di LAN).
//
// CATATAN: kalau nanti domain asli dipasang di hPanel, ganti URL di bawah —
// dan tambahkan domain game ke 'cors_origin' di config.php server.
const IS_LOCALHOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
const MP_URL_DEFAULT = IS_LOCALHOST
  ? 'http://localhost:8787'
  : 'https://lightgrey-gerbil-393119.hostingersite.com/coke-api';

// Parameter URL dari Grivy. Nama resmi mengikuti "Kiosk Vendor Feedback"
// (Q1): wa_session_id, user_uid, nickname, nickname_entered. Nama lama tetap
// diterima sebagai fallback supaya link yang sudah beredar tidak rusak.
//
// Penting soal nickname (Q1): `nickname` adalah versi TERNORMALISASI milik
// Grivy — sudah di-trim, spasi dirapatkan, dan DIBESARKAN semua; dipakai
// Grivy untuk cek keunikan + profanity. Yang ditampilkan ke layar/leaderboard
// harus `nickname_entered`, yaitu teks asli persis seperti diketik pemain.
const param = (...names) => {
  for (const n of names) {
    const v = url.get(n);
    if (v) return v;
  }
  return '';
};

const NICK_NORMALIZED = param('nickname');
const NICK_ENTERED    = param('nickname_entered');

export const PLAYER = {
  // konteks per-user dari WhatsApp; BUKAN kunci grup multiplayer
  waSessionId: param('wa_session_id', 'whats_app_session_id'),
  userId:      param('user_uid', 'user_id'),
  // untuk ditampilkan: pakai teks asli pemain, jatuh ke versi normalisasi
  nickname:    NICK_ENTERED || NICK_NORMALIZED || 'Player',
  // versi normalisasi Grivy — dikirim apa adanya ke backend untuk pencocokan
  nicknameNormalized: NICK_NORMALIZED,
  // kunci grup multiplayer = kiosk. Grivy menyebutnya kiosk_id, kita device_id
  deviceId:    param('device_id', 'kiosk_id'),
};

// Alias lama supaya kode/skrip yang masih memakai nama sebelumnya tidak pecah.
PLAYER.whatsAppSessionId = PLAYER.waSessionId;

export const CONFIG = {
  // papan
  cols: 10,
  rows: 20,
  cell: 60,                    // px dalam koordinat desain (canvas 600x1200)

  // waktu — spec sheet FA: 3 menit (brief menyebut 2 menit; ubah di sini
  // atau lewat ?duration=120 kalau final 2 menit)
  gameSeconds: parseInt(url.get('duration') || '180', 10),

  // kecepatan jatuh (konstan, tidak makin cepat — permintaan klien)
  gravityMs: 800,              // interval turun 1 baris
  softDropMs: 45,              // interval saat tombol turun ditahan
  lockDelayMs: 350,
  maxLockResets: 10,

  // skor (dari spec sheet FA)
  lineScores: { 1: 100, 2: 200, 3: 300, 4: 400 },
  lineWords:  { 1: 'Mantap!', 2: 'Keren!', 3: 'Gokil!', 4: 'Sempurna!' },
  comboBonus: { 2: 50, 5: 250 },
  perfectClearBonus: 1500,

  // animasi line clear: fase 1 baris berubah warna, fase 2 hilang kiri->kanan.
  // durasi ini juga jadi lama sapuan botol + jejak buih (lihat main.js)
  clearAnimMs: 850,

  // multiplayer (email Mahda 2026-07: maks 4 pemain per sesi;
  // TY page multiplayer menampilkan poin semua pemain di sesi itu)
  maxPlayers: 4,
  // jendela join bergulir (email Grivy 2026-07-14): tiap pemain join,
  // buka lagi joinWindowSeconds untuk pemain berikutnya, sampai maxPlayers.
  // Harus configurable — Grivy belum yakin 15 detik cukup. Default akan
  // dipakai backend sesi; ?join_window= untuk override saat testing.
  // (?wait= lama tetap didukung sebagai alias sampai backend sesi jadi.)
  joinWindowSeconds: parseInt(url.get('join_window') || '15', 10),
  waitWindowMs: parseInt(url.get('wait') || url.get('join_window') || '0', 10) * 1000, // window tunggu overlay, 0 = langsung mulai

  // server multiplayer (folder server/). Kosong = mode lokal (single player /
  // simulasi ?others=). Diisi -> game join sesi, waiting room + ranking nyata.
  multiplayerUrl: (url.get('mp_url') || MP_URL_DEFAULT).replace(/\/+$/, ''),

  // simulasi hasil pemain lain untuk demo/uji TY page multiplayer,
  // contoh: ?others=3 atau ?others=Nadia:15000,Bima:7000,Rian:5000
  mockOthers: (() => {
    const raw = url.get('others');
    if (!raw) return [];
    const num = parseInt(raw, 10);
    if (!isNaN(num) && !raw.includes(':')) {
      const defaults = [
        { nickname: 'User name 1', score: 15000 },
        { nickname: 'User name 2', score: 7000 },
        { nickname: 'User name 3', score: 5000 },
      ];
      return defaults.slice(0, Math.min(num, 3));
    }
    return raw
      .split(',')
      .filter(Boolean)
      .slice(0, 3)
      .map((s, i) => {
        const [nickname, score] = s.split(':');
        return {
          nickname: nickname || `User name ${i + 1}`,
          score: parseInt(score, 10) || (15000 - i * 4000),
        };
      });
  })(),

  // Endpoint kiosk vendor TIDAK lagi dipanggil dari browser. Kiosk Vendor
  // Feedback (Q4) menetapkan Game Start / Game End wajib server-to-server —
  // postMessage dan fetch langsung dari klien ditolak karena skor bisa
  // dipalsukan lewat devtools. Pemanggilan itu sekarang dilakukan backend
  // (server-php/kiosk.php). Dua parameter di bawah hanya untuk uji lokal.
  kioskDebug: url.get('kiosk_debug') === '1',
};
