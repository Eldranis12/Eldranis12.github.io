<?php
// ============================================================
// Dipanggil cron cPanel untuk (1) membersihkan baris sesi lama dan
// (2) mengirim antrean Game Start / Game End ke API kiosk server-to-server:
//   /usr/local/bin/php /home/USER/public_html/coke-api/cleanup.php
// Karena sekarang ikut mengirim event kiosk, jalankan tiap 1-5 menit
// (bukan 15) supaya kiosk tidak menunggu lama. game_history TIDAK pernah
// dihapus.
// ============================================================

declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/kiosk.php';

// Lewat CLI tidak butuh token; lewat HTTP wajib token admin.
if (PHP_SAPI !== 'cli') {
  $token = cfg('admin_token');
  if (!$token || !hash_equals((string) $token, (string) ($_GET['token'] ?? ''))) {
    fail(401, 'token admin salah');
  }
}

$n = cleanup();
// sekalian dorong antrean Game Start / Game End ke API kiosk (server-to-server)
$q = kiosk_flush(50);

if (PHP_SAPI === 'cli') {
  echo date('c') . " cleanup: $n sesi lama dihapus; "
     . "kiosk: {$q['sent']} terkirim, {$q['failed']} gagal\n";
} else {
  send(200, ['ok' => true, 'deleted_sessions' => $n, 'kiosk' => $q]);
}
