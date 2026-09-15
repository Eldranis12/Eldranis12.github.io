<?php
// Fake Grivy Game Connect untuk integration test lokal. Tidak dipakai produksi.
declare(strict_types=1);
header('Content-Type: application/json');

if (($_SERVER['REQUEST_URI'] ?? '/') === '/health') {
  echo '{"ok":true}';
  return;
}
if (($_SERVER['HTTP_AUTHORIZATION'] ?? '') !== 'test-grivy-token') {
  http_response_code(500);
  echo '{"error":"Token is invalid."}';
  return;
}
$body = json_decode((string) file_get_contents('php://input'), true) ?: [];
if (($body['game_session_id'] ?? '') === 'error-24') {
  echo '{"error":{"code":24,"message":"Game session id mismatch"}}';
  return;
}
$wa = (string) ($body['wa_session_id'] ?? '');
$connected = str_ends_with($wa, 'g2') ? 2 : 1;
echo json_encode([
  'error' => ['code' => 0, 'message' => 'Success'],
  'connected_game_users_count' => $connected,
  'all_game_users_count' => 2,
  'users' => [
    ['nick_name' => 'G1', 'connected_at' => 1788446888],
    $connected === 2 ? ['nick_name' => 'G2', 'connected_at' => 1788446890]
                     : ['nick_name' => 'G2'],
  ],
], JSON_UNESCAPED_SLASHES);
