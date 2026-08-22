<?php
// ============================================================
// Pengirim server-to-server ke API kiosk vendor.
// ------------------------------------------------------------
// Kiosk Vendor Feedback (Q4): Game Start / Game End WAJIB dipanggil
// server-to-server. API kiosk tidak boleh bisa dipanggil dari browser pemain
// (skor gampang dipalsukan lewat devtools), jadi postMessage dan fetch dari
// klien ditolak. File inilah yang melakukan panggilan resmi itu.
//
// Kejadian diantrekan dulu ke tabel `kiosk_events` (lihat queue_kiosk_event()
// di lib.php), baru dikirim di sini. Alasannya: request pemain tidak boleh
// ikut menunggu API kiosk, dan panggilan yang gagal harus bisa dicoba ulang.
//
// Dipanggil dari:
//   - cron  : cleanup.php (disarankan tiap 1-5 menit)
//   - manual: GET /kiosk/flush?token=ADMIN_TOKEN
//   - sesekali secara acak dari request /session/join (jaring pengaman)
// ============================================================

declare(strict_types=1);

// Kirim satu payload ke URL kiosk. Balik [http_status, body|error].
function kiosk_post(string $url, array $payload): array {
  $json    = json_encode($payload, JSON_UNESCAPED_UNICODE);
  $headers = ['Content-Type: application/json', 'Accept: application/json'];

  // Auth opsional — sesuaikan begitu kiosk vendor mengirim detail auth-nya.
  $key = (string) cfg('kiosk_api_key');
  if ($key !== '') {
    $headerName = (string) (cfg('kiosk_api_key_header') ?: 'Authorization');
    $headers[]  = $headerName . ': ' . $key;
  }

  if (!function_exists('curl_init')) {
    // Fallback kalau cURL tidak aktif di hosting.
    $ctx = stream_context_create(['http' => [
      'method'        => 'POST',
      'header'        => implode("\r\n", $headers),
      'content'       => $json,
      'timeout'       => (int) cfg('kiosk_timeout_seconds'),
      'ignore_errors' => true,
    ]]);
    $body   = @file_get_contents($url, false, $ctx);
    $status = 0;
    foreach ($http_response_header ?? [] as $h) {
      if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $status = (int) $m[1];
    }
    return [$status, $body === false ? 'request gagal' : (string) $body];
  }

  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $json,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => (int) cfg('kiosk_timeout_seconds'),
    CURLOPT_CONNECTTIMEOUT => 5,
  ]);
  $body   = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err    = curl_error($ch);
  curl_close($ch);
  return [$status, $body === false ? ($err ?: 'request gagal') : (string) $body];
}

// Kirim antrean yang masih pending. $limit = maks kejadian per panggilan.
function kiosk_flush(int $limit = 20): array {
  $maxAttempts = (int) cfg('kiosk_max_attempts');
  $st = db()->prepare(
    'SELECT * FROM kiosk_events
      WHERE status = "pending" AND attempts < ?
   ORDER BY id ASC LIMIT ' . max(1, $limit));
  $st->execute([$maxAttempts]);
  $events = $st->fetchAll();

  $sent = 0; $failed = 0;
  foreach ($events as $e) {
    $url = (string) cfg($e['event'] === 'game_start' ? 'kiosk_start_url' : 'kiosk_end_url');
    if ($url === '') continue;                    // belum dikonfigurasi -> biarkan antre

    $payload = json_decode($e['payload'], true) ?: [];
    [$status, $body] = kiosk_post($url, $payload);
    $ok = $status >= 200 && $status < 300;

    $attempts = (int) $e['attempts'] + 1;
    // Berhenti mencoba setelah batas — supaya antrean tidak dipukul terus.
    $newStatus = $ok ? 'sent' : ($attempts >= $maxAttempts ? 'failed' : 'pending');

    db()->prepare(
      'UPDATE kiosk_events SET status = ?, attempts = ?, http_status = ?,
              last_error = ?, sent_at = ? WHERE id = ?')
      ->execute([$newStatus, $attempts, $status ?: null,
                 $ok ? null : mb_substr((string) $body, 0, 500),
                 $ok ? date('Y-m-d H:i:s') : null, $e['id']]);

    if ($ok) { $sent++; } else {
      $failed++;
      error_log("[coke-api] kiosk {$e['event']} sesi {$e['session_id']} gagal "
              . "(HTTP $status, percobaan $attempts): " . mb_substr((string) $body, 0, 200));
    }
  }
  return ['sent' => $sent, 'failed' => $failed, 'processed' => count($events)];
}
