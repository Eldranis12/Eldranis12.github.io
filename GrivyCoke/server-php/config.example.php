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

  // --- Aturan sesi (sama persis dgn env server Node lama) ---
  'join_window_seconds'   => 15,   // window tunggu bergulir
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
  // Kosongkan sampai kiosk vendor memberi endpoint + auth. Selama kosong,
  // kejadian TIDAK diantrekan sama sekali (tidak ada yang menumpuk).
  'kiosk_start_url' => '',
  'kiosk_end_url'   => '',
  // Auth opsional. Contoh: 'Bearer xxx' dengan header 'Authorization',
  // atau kunci polos dengan header 'X-Api-Key' — sesuaikan saat detail tiba.
  'kiosk_api_key'        => '',
  'kiosk_api_key_header' => 'Authorization',
  'kiosk_timeout_seconds' => 10,
  'kiosk_max_attempts'    => 5,

  // Timezone untuk riwayat & kunci minggu leaderboard.
  'timezone' => 'Asia/Jakarta',
];
