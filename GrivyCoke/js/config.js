// ============================================================
// Konfigurasi game + parameter URL dari Grivy
// ============================================================

const url = new URLSearchParams(location.search);

// Base URL server multiplayer (Node.js, folder server/).
// Saat game dibuka di localhost (dev) otomatis pakai server lokal
// (http://localhost:8787) — tinggal `node server/server.js`. Di host lain
// (produksi/GitHub Pages) pakai URL produksi. Override kapan saja: ?mp_url=
// (mis. ?mp_url=http://192.168.1.5:8787 untuk uji dari HP di LAN yang sama).
const IS_LOCALHOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
const MP_URL_DEFAULT = IS_LOCALHOST
  ? 'http://localhost:8787'
  : 'https://coke-mp.8infiniooh.com';

export const PLAYER = {
  whatsAppSessionId: url.get('whats_app_session_id') || '',
  userId:            url.get('user_id') || '',
  nickname:          url.get('nickname') || 'Player',
  deviceId:          url.get('device_id') || '',
};

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

  // animasi line clear: fase 1 baris berubah warna, fase 2 hilang kiri->kanan
  clearAnimMs: 650,

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
  // contoh: ?others=Nadia:450,Bima:300 (dihapus saat server multiplayer jadi)
  mockOthers: (url.get('others') || '')
    .split(',')
    .filter(Boolean)
    .slice(0, 3)
    .map(s => {
      const [nickname, score] = s.split(':');
      return { nickname: nickname || 'Player', score: parseInt(score, 10) || 0 };
    }),

  // endpoint kiosk vendor (diisi saat detail API tersedia)
  kioskStartUrl: url.get('kiosk_start_url') || '',
  kioskEndUrl:   url.get('kiosk_end_url') || '',
};
