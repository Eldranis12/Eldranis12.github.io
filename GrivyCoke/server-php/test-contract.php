<?php
// Contract test murni (tanpa database/network) untuk Flow 5 v4.
declare(strict_types=1);

// lib.php mendefinisikan cfg(), tetapi test ini hanya memanggil fungsi murni
// sehingga tidak memerlukan config.php maupun kredensial.
require __DIR__ . '/lib.php';
require __DIR__ . '/grivy.php';

function contract_eq($actual, $expected, string $label): void {
  if ($actual !== $expected) {
    throw new RuntimeException($label . ': dapat ' . json_encode($actual)
      . ', harusnya ' . json_encode($expected));
  }
}

$success = grivy_normalize_response(200, json_encode([
  'error' => ['code' => 0, 'message' => 'Success'],
  'connected_game_users_count' => 2,
  'all_game_users_count' => 3,
  'users' => [
    ['nick_name' => 'NICK2', 'connected_at' => 1788446888],
    ['nick_name' => 'NICK3'],
  ],
]));
contract_eq($success['ok'], true, 'success');
contract_eq($success['connected_count'], 2, 'connected count');
contract_eq($success['invited_count'], 3, 'invited count');
contract_eq(isset($success['users'][0]['connected_at']), true, 'connected_at');

$notFound = grivy_normalize_response(200, '{"error":{"code":40,"message":"WhatsApp campaign session not found"}}');
contract_eq($notFound['ok'], false, 'business error');
contract_eq($notFound['error_code'], 40, 'business error code');
contract_eq($notFound['retryable'], false, 'code 40 tidak di-retry');

$locked = grivy_normalize_response(500, '{"error":"unsupported_action: partnerWaSessionGameConnect:wcs_x"}');
contract_eq($locked['retryable'], true, 'concurrency lock di-retry');
$internal = grivy_normalize_response(200, '{"error":{"code":99,"message":"Internal error"}}');
contract_eq($internal['retryable'], true, 'code 99 di-retry');

$session = [
  'id' => 'KIOSK_01-20260907T101500-7f3a',
  'device_key' => 'gs:hash', 'mode' => 'multi',
  'roster' => ['u1', 'u2'],
  'players' => [
    'u1' => ['wa_session_id' => 'wcs_1', 'nickname' => 'DODI',
             'nickname_entered' => 'Dodi', 'score' => 1250, 'submitted' => 1,
             'kiosk_id' => 'KIOSK_01'],
    'u2' => ['wa_session_id' => 'wcs_2', 'nickname' => 'ANI',
             'nickname_entered' => 'Ani', 'score' => 9000, 'submitted' => 0,
             'kiosk_id' => 'KIOSK_01'],
  ],
];
$start = build_kiosk_payload('game_start', $session);
contract_eq(array_keys($start), ['kiosk_id', 'game_session_id', 'players'], 'field Game Start');
contract_eq($start['game_session_id'], $session['id'], 'ID kiosk dipertahankan');
contract_eq($start['players'], [['wa_session_id' => 'wcs_1'], ['wa_session_id' => 'wcs_2']], 'pemain Game Start');

$end = build_kiosk_payload('game_end', $session);
contract_eq($end['game_status'], 'COMPLETED', 'status ronde');
contract_eq($end['players'][0]['status'], 'FINISHED', 'status selesai');
contract_eq($end['players'][1]['status'], 'DQ', 'status DQ');
contract_eq($end['players'][1]['score'], 0, 'skor DQ');

echo "Flow 5 v4 contract tests lulus.\n";
