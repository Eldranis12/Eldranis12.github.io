<?php
declare(strict_types=1);

// Grivy Game Connect - Flow 5 v4. Seluruh request dilakukan dari backend
// karena token partner juga mengizinkan operasi sensitif lain.
function grivy_http_post(string $url, array $headers, string $json): array {
  $timeout = max(1, (int) (cfg('grivy_timeout_seconds') ?? cfg('kiosk_timeout_seconds') ?? 10));

  if (!function_exists('curl_init')) {
    $ctx = stream_context_create(['http' => [
      'method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $json,
      'timeout' => $timeout, 'ignore_errors' => true,
    ]]);
    $body = @file_get_contents($url, false, $ctx);
    $status = 0;
    foreach ($http_response_header ?? [] as $header) {
      if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $m)) $status = (int) $m[1];
    }
    return [$status, $body === false ? '' : (string) $body,
            $body === false ? 'request gagal' : ''];
  }

  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $json,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => $timeout,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
    CURLOPT_SSLVERSION => CURL_SSLVERSION_TLSv1_2,
  ]);
  $body = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $error = curl_error($ch);
  curl_close($ch);
  return [$status, $body === false ? '' : (string) $body, $body === false ? $error : ''];
}

function grivy_normalize_response(int $status, string $raw, string $transportError = ''): array {
  $decoded = json_decode($raw, true);
  $error = is_array($decoded) ? ($decoded['error'] ?? null) : null;
  $code = is_array($error) && isset($error['code']) ? (int) $error['code'] : null;
  $message = is_array($error) ? (string) ($error['message'] ?? '')
           : (is_string($error) ? $error : ($transportError ?: 'respons Grivy tidak valid'));
  $unsupported = $status === 500 && str_contains($message, 'unsupported_action:');
  $ok = $status >= 200 && $status < 300 && $code === 0;

  $users = [];
  if ($ok && is_array($decoded['users'] ?? null)) {
    foreach ($decoded['users'] as $user) {
      if (!is_array($user)) continue;
      $row = ['nickname' => clip($user['nick_name'] ?? 'Player', 20) ?: 'Player'];
      if (isset($user['connected_at'])) $row['connected_at'] = (int) $user['connected_at'];
      $users[] = $row;
    }
  }

  return [
    'ok' => $ok,
    'http_status' => $status,
    'error_code' => $code,
    'error_message' => $ok ? '' : $message,
    'retryable' => $unsupported || $code === 99 || $status === 0 || $status >= 502,
    'connected_count' => $ok ? max(0, (int) ($decoded['connected_game_users_count'] ?? 0)) : 0,
    'invited_count' => $ok ? max(0, (int) ($decoded['all_game_users_count'] ?? 0)) : 0,
    'users' => $users,
  ];
}

function grivy_connect(string $waSessionId, string $gameSessionId): array {
  $url = (string) cfg('grivy_connect_url');
  $token = (string) cfg('grivy_token');
  if ($url === '' || $token === '') {
    return ['ok' => false, 'http_status' => 0, 'error_code' => null,
            'error_message' => 'Game Connect belum dikonfigurasi', 'retryable' => false,
            'connected_count' => 0, 'invited_count' => 0, 'users' => []];
  }

  $json = json_encode([
    'wa_session_id' => $waSessionId,
    'game_session_id' => $gameSessionId,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $headers = ['Content-Type: application/json', 'Accept: application/json',
              'Authorization: ' . $token]; // token polos, tanpa prefix Bearer

  $attempts = max(1, (int) (cfg('grivy_max_attempts') ?? 3));
  $result = [];
  for ($attempt = 1; $attempt <= $attempts; $attempt++) {
    [$status, $body, $transportError] = grivy_http_post($url, $headers, (string) $json);
    $result = grivy_normalize_response($status, $body, $transportError);
    $result['attempts'] = $attempt;
    if ($result['ok'] || !$result['retryable'] || $attempt === $attempts) break;
    $delayMs = str_contains((string) $result['error_message'], 'unsupported_action:') ? 1100 : 600;
    usleep($delayMs * 1000);
  }

  if (empty($result['ok'])) {
    error_log('[coke-api] Game Connect gagal: HTTP ' . ($result['http_status'] ?? 0)
            . ', code ' . (($result['error_code'] ?? null) === null ? '-' : $result['error_code'])
            . ', ' . mb_substr((string) ($result['error_message'] ?? ''), 0, 180));
  }
  return $result;
}
