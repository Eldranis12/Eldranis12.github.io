<?php
// ============================================================
// Konfigurasi STAGING siap deploy.
// Hanya tiga nilai database bertanda WAJIB DIISI yang belum dapat ditentukan
// dari source code. File ini berisi secret dan tidak boleh masuk repo publik.
// ============================================================

return [
  // --- Database (cPanel > MySQL Databases) ---
  // Nama DB & user di cPanel selalu berprefix username hosting,
  // contoh: 'ceklxxxx_coke' dan 'ceklxxxx_coke'.
  'db_host' => 'localhost',
  'db_name' => 'WAJIB_DIISI_NAMA_DATABASE',
  'db_user' => 'WAJIB_DIISI_USER_DATABASE',
  'db_pass' => 'WAJIB_DIISI_PASSWORD_DATABASE',
  'db_port' => 3306,

  // --- Aturan sesi Flow 5 v4 ---
  'lobby_wait_seconds'    => 12,   // tunggu lobby Grivy (rekomendasi 10-12 dtk)
  'join_window_seconds'   => 12,   // alias kompatibilitas config lama
  'allow_legacy_grouping' => false,// hanya untuk test; produksi harus false
  'max_players'           => 4,    // maks pemain per sesi
  'game_seconds'          => 180,  // durasi game default
  'result_grace_seconds'  => 25,   // toleransi menunggu skor pemain lambat
  'session_ttl_seconds'   => 300,  // umur baris sesi setelah selesai (lalu dihapus)

  // --- Keamanan ---
  // Domain game. Produksi WAJIB diisi persis (bukan '*') supaya tidak bisa
  // dipanggil dari domain lain. Boleh array untuk beberapa domain.
  'cors_origin' => ['https://eldranis12.github.io'],

  // Batas atas skor yang masih dianggap wajar (sanity check, bukan anti-cheat
  // penuh). Skor di atas ini ditolak. 3 menit main realistis << 100000.
  'max_score' => 100000,

  // Token untuk endpoint admin (/history, /leaderboard?full=1, /cleanup).
  // Token unik untuk endpoint admin paket staging ini.
  'admin_token' => '9cba9ae46bf2ac968c536544b6338d7be0414e166eca5b3b',

  // --- Leaderboard mingguan ---
  // 'cumulative' = skor DIJUMLAHKAN kalau pemain main berkali-kali dalam satu
  // minggu (sesuai Kiosk Vendor Feedback Q6). 'best' = pakai skor tertinggi.
  'leaderboard_scoring' => 'cumulative',

  // --- API kiosk vendor (server-to-server, Q4) ---
  // Isi dari dokumentasi Kiosk Vendor. Selama URL kosong,
  // kejadian TIDAK diantrekan sama sekali (tidak ada yang menumpuk).
  'kiosk_start_url' => 'https://cokezerotheringan-ringan.com/romapi/v1/nongkrong/game-start',
  'kiosk_end_url'   => 'https://cokezerotheringan-ringan.com/romapi/v1/nongkrong/game-end',
  // Dokumentasi ROM terkini memakai kunci polos dalam header X-API-Key.
  'kiosk_api_key'        => 'ROM-GRIVY-STAGING-2026-7KQ9P2M8X4R6',
  'kiosk_api_key_header' => 'X-API-Key',
  'kiosk_timeout_seconds' => 10,
  'kiosk_max_attempts'    => 5,

  // --- Grivy Game Connect (API Game Vendor v4 Bagian 5) ---
  // Token statis per environment, dikirim apa adanya di header Authorization
  // (TANPA prefix "Bearer"). Token ini juga otorisasi voucher -- jangan pernah
  // kirim ke klien. Endpoint dan token di bawah khusus Stage.
  'grivy_connect_url' => 'https://us-central1-barcode-stage.cloudfunctions.net/partnerWaSessionGameConnect',
  'grivy_token'       => 'ef47904b-49e1-4b5e-b419-51c929276588ac272eb6-edb1-45cb-9bea-3d59d7fff957',
  'grivy_timeout_seconds' => 10,
  'grivy_max_attempts'    => 3,

  // Timezone untuk riwayat & kunci minggu leaderboard.
  'timezone' => 'Asia/Jakarta',
];
