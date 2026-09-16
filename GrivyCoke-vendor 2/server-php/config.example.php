<?php
// ============================================================
// SALIN file ini jadi `config.php` lalu isi kredensial database cPanel.
// `config.php` TIDAK ikut ke git (lihat .gitignore) — jangan commit password.
// ============================================================

return [
  // --- Database (cPanel > MySQL Databases) ---
  // Nama DB & user di cPanel selalu berprefix username hosting,
  // contoh: 'ceklxxxx_coke' dan 'ceklxxxx_coke'.
  'db_host' => 'localhost',
  'db_name' => 'NAMADB_ANDA',
  'db_user' => 'USERDB_ANDA',
  'db_pass' => 'PASSWORD_ANDA',
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
  // Isi string acak panjang. Kosong = endpoint admin dimatikan.
  'admin_token' => '',

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
  'kiosk_api_key'        => '',
  'kiosk_api_key_header' => 'X-API-Key',
  'kiosk_timeout_seconds' => 10,
  'kiosk_max_attempts'    => 5,

  // --- Grivy Game Connect (API Game Vendor v4 Bagian 5) ---
  // Token statis per environment, dikirim apa adanya di header Authorization
  // (TANPA prefix "Bearer"). Token ini juga otorisasi voucher -- jangan pernah
  // kirim ke klien. Endpoint di bawah adalah Production; token diberikan
  // terpisah oleh Grivy dan hanya boleh disimpan di config.php server.
  'grivy_connect_url' => 'https://us-central1-barcode-stage.cloudfunctions.net/partnerWaSessionGameConnect',
  'grivy_token'       => '',
  'grivy_timeout_seconds' => 10,
  'grivy_max_attempts'    => 3,

  // Timezone untuk riwayat & kunci minggu leaderboard.
  'timezone' => 'Asia/Jakarta',
];
