<?php
declare(strict_types=1);

// Game Connect (API Game Vendor v4 �5) -- satu-satunya panggilan game ke
// Grivy. WAJIB server-to-server: token yang sama juga dipakai utk voucher,
// jadi tidak boleh sampai ke browser pemain (lihat �4 dokumen). Panggilan ini
// murni registrasi + info lobi Grivy sendiri; pengelompokan/skor/ranking kita
// TETAP dari sesi kita sendiri (lihat index.php) -- jadi kegagalan di sini
// tidak boleh menghambat game.
function grivy_connect(string $waSessionId, string $gameSessionId): array {
  $url = (string) cfg('grivy_connect_url');
  $token = (string) cfg('grivy_token');
  if ($url === '' || $token === '') return ['ok' => false, 'error' => 'grivy belum dikonfigurasi'];

  $json = json_encode([
    'wa_session_id'   => $waSessionId,
    'game_session_id' => $gameSessionId,
  ], JSON_UNESCAPED_UNICODE);

  $headers = ['Content-Type: application/json', 'Accept: application/json',
              // Tanpa prefix "Bearer " -- token dikirim apa adanya (�4).
              'Authorization: ' . $token];

  if (!function_exists('curl_init')) {
    $ctx = stream_context_create(['http' => [
      'method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $json,
      'timeout' => (int) cfg('kiosk_timeout_seconds'), 'ignore_errors' => true,
    ]]);
    $body = @file_get_contents($url, false, $ctx);
    return ['ok' => $body !== false, 'body' => $body === false ? null : json_decode((string) $body, true)];
  }

  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_POSTFIELDS => $json, CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => (int) cfg('kiosk_timeout_seconds'),
    CURLOPT_CONNECTTIMEOUT => 5,
    // Endpoint Grivy (Cloud Functions) pakai HTTP/2 + renegosiasi TLS yang
    // bikin sebagian build curl (php-cli Windows/XAMPP) hang sampai timeout --
    // paksa HTTP/1.1 + TLS 1.2 supaya konsisten di semua environment.
    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
    CURLOPT_SSLVERSION => CURL_SSLVERSION_TLSv1_2,
  ]);
  $body = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err = curl_error($ch);
  curl_close($ch);

  if ($body === false) {
    error_log('[coke-api] grivy connect gagal: ' . $err);
    return ['ok' => false, 'error' => $err];
  }
  return ['ok' => $status >= 200 && $status < 300, 'status' => $status, 'body' => json_decode((string) $body, true)];
}
