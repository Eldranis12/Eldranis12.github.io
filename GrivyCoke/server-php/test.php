<?php
// ============================================================
// Integrasi test — port dari server/test.js + skenario khusus versi database
// dan penyesuaian "Kiosk Vendor Feedback" (penamaan field, diskualifikasi,
// leaderboard kumulatif, antrean kiosk server-to-server).
//
//   cd server-php
//   COKE_DB_NAME=coke_test COKE_DB_USER=root COKE_DB_PASS= php test.php
//
// Butuh MySQL/MariaDB yang jalan + database kosong (default: coke_test).
// Tabel dibuat otomatis dan DIKOSONGKAN tiap kali test jalan.
// ============================================================

declare(strict_types=1);

$PORT = (int) (getenv('TEST_PORT') ?: 8799);
$BASE = "http://127.0.0.1:$PORT";

// timing pendek untuk test
putenv('COKE_JOIN_WINDOW_SECONDS=1');
putenv('COKE_RESULT_GRACE_SECONDS=1');
putenv('COKE_GAME_SECONDS=0');
putenv('COKE_CORS_ORIGIN=*');
putenv('COKE_ADMIN_TOKEN=test-token');
// Endpoint kiosk palsu: /health di server test ini sendiri (selalu balas 200),
// jadi jalur server-to-server benar-benar diuji ujung ke ujung.
putenv("COKE_KIOSK_START_URL=$BASE/health");
putenv("COKE_KIOSK_END_URL=$BASE/health");
if (!getenv('COKE_DB_NAME')) putenv('COKE_DB_NAME=coke_test');

// config.php wajib ada (lib.php membacanya). Untuk test, kalau belum ada,
// buat otomatis dari contoh — semua nilai penting ditimpa env COKE_* di atas.
if (!is_file(__DIR__ . '/config.php')) {
  copy(__DIR__ . '/config.example.php', __DIR__ . '/config.php');
  echo "(config.php dibuat otomatis dari contoh untuk test)\n";
}

require __DIR__ . '/lib.php';
require __DIR__ . '/kiosk.php';

// ---------- siapkan database ----------
run_schema();
db()->exec('SET FOREIGN_KEY_CHECKS=0');
foreach (['session_players', 'sessions', 'game_history', 'kiosk_events'] as $t) {
  db()->exec("TRUNCATE TABLE $t");
}
db()->exec('SET FOREIGN_KEY_CHECKS=1');

// ---------- jalankan server ----------
$env = '';
foreach (['COKE_JOIN_WINDOW_SECONDS', 'COKE_RESULT_GRACE_SECONDS', 'COKE_GAME_SECONDS',
          'COKE_CORS_ORIGIN', 'COKE_ADMIN_TOKEN', 'COKE_DB_NAME', 'COKE_DB_USER',
          'COKE_DB_PASS', 'COKE_DB_HOST', 'COKE_KIOSK_START_URL', 'COKE_KIOSK_END_URL'] as $k) {
  $v = getenv($k);
  if ($v !== false) $env .= $k . '=' . escapeshellarg($v) . ' ';
}
$desc = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
$srv = proc_open("$env PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:$PORT "
               . escapeshellarg(__DIR__ . '/router-dev.php'), $desc, $pipes, __DIR__);
if (!is_resource($srv)) { fwrite(STDERR, "gagal start server\n"); exit(1); }
register_shutdown_function(function () use ($srv) { @proc_terminate($srv); });

for ($i = 0; $i < 50; $i++) {
  if (@file_get_contents("$BASE/health") !== false) break;
  usleep(100_000);
}

// ---------- helper ----------
function http(string $method, string $url, ?array $body = null): array {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_TIMEOUT        => 10,
  ]);
  if ($body !== null) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
  }
  $out = curl_exec($ch);
  curl_close($ch);
  return json_decode((string) $out, true) ?: [];
}

$BASE_URL = $BASE;
$post    = fn(string $p, array $b) => http('POST', $GLOBALS['BASE_URL'] . $p, $b);
$get     = fn(string $p)           => http('GET',  $GLOBALS['BASE_URL'] . $p);
// nama field mengikuti dokumen: kiosk_id, user_uid, nickname_entered, wa_session_id
$join    = fn($kiosk, $uid, $nick) => $GLOBALS['post']('/session/join',
             ['kiosk_id' => $kiosk, 'user_uid' => $uid, 'nickname' => mb_strtoupper($nick),
              'nickname_entered' => $nick, 'wa_session_id' => 'wa-' . $uid]);
$state   = fn($sid)                => $GLOBALS['get']("/session/state?session_id=$sid");
$score   = fn($sid, $uid, $s)      => $GLOBALS['post']('/session/score',
             ['session_id' => $sid, 'user_uid' => $uid, 'score' => $s]);
$results = fn($sid)                => $GLOBALS['get']("/session/results?session_id=$sid");

$pass = 0;
function eq($a, $b, string $what): void {
  if ($a !== $b) throw new RuntimeException("$what — dapat " . json_encode($a) . ", harusnya " . json_encode($b));
}
function truthy($v, string $what): void { if (!$v) throw new RuntimeException($what); }
$ok = function (string $name) use (&$pass) { echo "  ✓ $name\n"; $pass++; };

try {
  // --- 1. single ---
  $j = $join('k1', 'u1', 'Andi');
  truthy($j['session_id'] ?? null, 'server mengembalikan session_id');
  eq($j['game_session_id'], $j['session_id'], 'game_session_id = session_id');
  eq($j['count'], 1, 'jumlah pemain');
  usleep(1_200_000);
  $st = $state($j['session_id']);
  eq($st['phase'], 'playing', 'fase');
  eq($st['final_mode'], 'single', 'mode final');
  $score($j['session_id'], 'u1', 500);
  $rz = $results($j['session_id']);
  eq($rz['ready'], true, 'hasil siap');
  eq($rz['results'][0]['score'], 500, 'skor');
  $ok('single: 1 pemain 1 kiosk -> single + skor terkumpul');
  $sessionSingle = $j['session_id'];

  // --- 2. multi, kiosk sama ---
  $ja = $join('k2', 'a', 'Ana');
  $jb = $join('k2', 'b', 'Budi');
  eq($ja['session_id'], $jb['session_id'], 'kiosk sama -> session_id sama');
  eq($jb['count'], 2, 'jumlah pemain');
  usleep(1_200_000);
  eq($state($ja['session_id'])['final_mode'], 'multi', 'mode final');
  $score($ja['session_id'], 'a', 300);
  $score($ja['session_id'], 'b', 900);
  $rz = $results($ja['session_id']);
  eq($rz['ready'], true, 'hasil siap');
  eq(array_column($rz['results'], 'nickname_entered'), ['Budi', 'Ana'], 'urutan ranking');
  $ok('multi: 2 pemain kiosk sama -> 1 sesi, ranking desc benar');

  // --- 3. kiosk beda -> sesi terpisah ---
  $jx = $join('kX', 'x', 'X');
  $jy = $join('kY', 'y', 'Y');
  truthy($jx['session_id'] !== $jy['session_id'], 'kiosk beda -> session_id beda');
  eq($jx['count'], 1, 'jumlah kX'); eq($jy['count'], 1, 'jumlah kY');
  $ok('kiosk beda -> sesi terpisah');

  // --- 4. rolling window ---
  $j1 = $join('k4', 'r1', 'R1');
  truthy($j1['ms_left'] > 800, 'window awal penuh');
  usleep(600_000);
  truthy($state($j1['session_id'])['ms_left'] < 500, 'window menyusut sebelum join ke-2');
  $j2 = $join('k4', 'r2', 'R2');
  eq($j2['session_id'], $j1['session_id'], 'sesi sama');
  truthy($j2['ms_left'] > 800, 'window reset penuh setelah pemain baru join');
  $ok('rolling window: pemain baru -> window reset ke penuh');

  // --- 5. kiosk dipakai berurutan ---
  $j1 = $join('k5', 's1', 'S1');
  usleep(1_200_000);
  eq($state($j1['session_id'])['phase'], 'playing', 'sesi pertama mulai');
  $j2 = $join('k5', 's2', 'S2');
  truthy($j2['session_id'] !== $j1['session_id'], 'sesi baru untuk kiosk yang sama');
  eq($j2['count'], 1, 'jumlah pemain sesi baru');
  $ok('kiosk berurutan: setelah sesi mulai -> join baru buka sesi baru');

  // --- 6. maks 4 pemain ---
  $j = [];
  foreach (['p1', 'p2', 'p3', 'p4'] as $uid) $j = $join('k6', $uid, $uid);
  eq($j['count'], 4, 'sesi penuh');
  $j5 = $join('k6', 'p5', 'Late');
  truthy($j5['session_id'] !== $j['session_id'], 'pemain ke-5 -> sesi baru');
  eq($j5['count'], 1, 'jumlah pemain sesi baru');
  $ok('maks 4: pemain ke-5 -> sesi baru (kiosk penuh)');

  // --- 7. re-join tidak menggandakan ---
  $j1 = $join('k7', 'z', 'Z');
  $j2 = $join('k7', 'z', 'Z2');
  eq($j2['session_id'], $j1['session_id'], 'sesi sama');
  eq($j2['count'], 1, 'tidak digandakan');
  eq($j2['players'][0]['nickname'], 'Z2', 'nama diperbarui');
  $ok('re-join (reload): tidak menggandakan, nama diperbarui');

  // ====== penyesuaian Kiosk Vendor Feedback ======

  // --- 8. nama: tampilan pakai nickname_entered, normalisasi disimpan ---
  $jn = $join('k10', 'nick', 'Grady');   // nickname=GRADY, nickname_entered=Grady
  eq($jn['players'][0]['nickname'], 'Grady', 'yang ditampilkan = teks asli pemain');
  usleep(1_200_000);
  $score($jn['session_id'], 'nick', 700);
  $rz = $results($jn['session_id']);
  eq($rz['results'][0]['nickname'], 'GRADY', 'versi normalisasi tetap tersimpan');
  eq($rz['results'][0]['nickname_entered'], 'Grady', 'teks asli tersedia untuk tampilan');
  $ok('nama: nickname_entered untuk tampilan, nickname normalisasi utk pencocokan');

  // --- 9. nama parameter lama masih diterima (masa transisi) ---
  $legacy = $post('/session/join', ['device_id' => 'k11', 'user_id' => 'old1',
                                    'nickname' => 'Lama', 'whats_app_session_id' => 'wa-old']);
  eq($legacy['count'], 1, 'join dgn nama field lama tetap jalan');
  eq($legacy['players'][0]['user_uid'], 'old1', 'user_id lama dipetakan ke user_uid');
  $ok('kompatibilitas: device_id/user_id/whats_app_session_id lama masih diterima');

  // --- 10. Q5: pemain yang tidak menyelesaikan game -> DISKUALIFIKASI ---
  $jd1 = $join('k12', 'finish', 'Finisher');
  $jd2 = $join('k12', 'quit', 'Quitter');
  eq($jd1['session_id'], $jd2['session_id'], 'satu sesi');
  usleep(1_200_000);
  $sid = $jd1['session_id'];
  // 'quit' sempat sinkron skor live 5000 lalu HP-nya mati (tidak submit final)
  $post('/session/score', ['session_id' => $sid, 'user_uid' => 'quit',
                           'score' => 5000, 'live' => true]);
  $score($sid, 'finish', 400);
  usleep(2_500_000);                       // lewati play_deadline + grace
  $rz = $results($sid);
  eq($rz['ready'], true, 'sesi ditutup');
  $byUid = array_column($rz['results'], null, 'user_uid');
  eq($byUid['quit']['disqualified'], true, 'pemain yang putus didiskualifikasi');
  eq($byUid['quit']['score'], 0, 'skor live-nya TIDAK dipakai');
  eq($byUid['finish']['disqualified'], false, 'yang selesai tidak kena DQ');
  eq($rz['results'][0]['user_uid'], 'finish', 'yang DQ diletakkan di bawah');
  $ok('Q5: pemain putus di tengah -> DQ, skor live diabaikan');

  // --- 11. pemain DQ tidak masuk leaderboard ---
  $lb = $get('/leaderboard?limit=50');
  $uids = array_column($lb['leaderboard'], 'user_uid');
  truthy(!in_array('quit', $uids, true), 'pemain DQ tidak muncul di leaderboard');
  truthy(in_array('finish', $uids, true), 'pemain yang selesai muncul');
  $ok('leaderboard: pemain terdiskualifikasi dikecualikan');

  // --- 12. Q6: skor KUMULATIF sepanjang minggu ---
  $jr = $join('k8', 'rep', 'Repeat');
  usleep(1_200_000);
  $score($jr['session_id'], 'rep', 8000);
  $jr2 = $join('k8', 'rep', 'Repeat');
  usleep(1_200_000);
  $score($jr2['session_id'], 'rep', 100);
  $lb = $get('/leaderboard?limit=50');
  $mine = array_values(array_filter($lb['leaderboard'], fn($r) => $r['user_uid'] === 'rep'))[0];
  eq($lb['scoring'], 'cumulative', 'mode skor default kumulatif');
  eq($mine['score'], 8100, 'skor dijumlahkan (8000 + 100)');
  eq($mine['total_score'], 8100, 'total_score');
  eq($mine['best_score'], 8000, 'best_score tetap dilaporkan');
  eq($mine['plays'], 2, 'jumlah main dihitung');
  $ok('Q6: leaderboard mingguan kumulatif (?scoring=best masih tersedia)');

  // --- 13. mode 'best' masih bisa dipakai kalau Mahda berubah pikiran ---
  $lbBest = $get('/leaderboard?limit=50&scoring=best');
  $mineBest = array_values(array_filter($lbBest['leaderboard'], fn($r) => $r['user_uid'] === 'rep'))[0];
  eq($lbBest['scoring'], 'best', 'mode best aktif');
  eq($mineBest['score'], 8000, 'pakai skor tertinggi');
  $ok('leaderboard: ?scoring=best mengembalikan skor tertinggi');

  // --- 14. minggu: reset Senin, rentang tanggal dilaporkan ---
  eq($lb['week'], week_key(), 'minggu berjalan');
  truthy(preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $lb['week_from']), 'week_from tanggal');
  eq((new DateTime($lb['week_from']))->format('N'), '1', 'minggu mulai hari Senin');
  $weeks = $get('/leaderboard/weeks');
  truthy(count($weeks['weeks']) > 0, 'daftar minggu terisi');
  eq($weeks['weeks'][0]['is_current'], true, 'minggu berjalan ditandai');
  $ok('minggu: ISO week (mulai Senin) + endpoint daftar minggu');

  // --- 15. Q1: daftar pemenang membawa wa_session_id ---
  truthy(isset($get('/leaderboard/winners')['error']), 'butuh token admin');
  $win = $get('/leaderboard/winners?token=test-token&top=3');
  truthy(count($win['winners']) > 0, 'ada pemenang');
  truthy(!empty($win['winners'][0]['wa_session_id']), 'wa_session_id ikut untuk submit pemenang');
  truthy(is_array($win['winners'][0]['wa_session_ids']), 'semua wa_session_id minggu itu ikut');
  truthy(!isset($lb['leaderboard'][0]['wa_session_id']), 'wa_session_id TIDAK dibocorkan ke publik');
  $ok('Q1: /leaderboard/winners bawa wa_session_id, endpoint publik tidak');

  // --- 16. Q4: Game Start & Game End diantrekan untuk server-to-server ---
  kiosk_flush(50);
  $ev = db()->prepare('SELECT event, status, http_status FROM kiosk_events WHERE session_id = ?');
  $ev->execute([$sessionSingle]);
  $rowsEv = array_column($ev->fetchAll(), null, 'event');
  truthy(isset($rowsEv['game_start']), 'game_start diantrekan');
  truthy(isset($rowsEv['game_end']), 'game_end diantrekan');
  eq($rowsEv['game_end']['status'], 'sent', 'terkirim server-to-server');
  eq((int) $rowsEv['game_end']['http_status'], 200, 'kiosk balas 200');
  $ok('Q4: game_start & game_end terkirim server-to-server (dgn antrean + retry)');

  // --- 17. payload kiosk memakai penamaan yang disepakati ---
  $pl = db()->prepare('SELECT payload FROM kiosk_events WHERE event = "game_end" AND session_id = ?');
  $pl->execute([$sessionSingle]);
  $payload = json_decode((string) $pl->fetchColumn(), true);
  eq($payload['game_session_id'], $sessionSingle, 'game_session_id');
  truthy(array_key_exists('kiosk_id', $payload), 'kiosk_id ada');
  $p0 = $payload['players'][0];
  foreach (['user_uid', 'wa_session_id', 'nickname', 'nickname_entered', 'score', 'rank'] as $f) {
    truthy(array_key_exists($f, $p0), "field $f ada di payload pemain");
  }
  $ok('payload kiosk: game_session_id / kiosk_id / user_uid / wa_session_id / rank');

  // ====== versi database (tetap dari sebelumnya) ======

  // --- 18. riwayat tersimpan permanen ---
  $row = db()->prepare('SELECT * FROM game_history WHERE session_id = ? AND user_uid = ?');
  $row->execute([$sessionSingle, 'u1']);
  $h = $row->fetch();
  truthy($h, 'baris riwayat ada');
  eq((int) $h['score'], 500, 'skor di riwayat');
  eq($h['mode'], 'single', 'mode di riwayat');
  eq((int) $h['rank_in_session'], 1, 'peringkat di sesi');
  eq($h['wa_session_id'], 'wa-u1', 'wa_session_id tersimpan');
  $ok('riwayat: sesi selesai otomatis diarsipkan ke game_history');

  // --- 19. hasil masih terbaca setelah baris sesi dibersihkan ---
  db()->prepare('DELETE FROM sessions WHERE id = ?')->execute([$sessionSingle]);
  $rz = $results($sessionSingle);
  eq($rz['ready'], true, 'hasil dari arsip siap');
  eq($rz['results'][0]['score'], 500, 'skor dari arsip');
  $ok('TY page tetap jalan walau baris sesi sudah dibersihkan (fallback arsip)');

  // --- 20. skor tidak wajar ditolak ---
  $j = $join('k9', 'cheat', 'Cheater');
  truthy(isset($score($j['session_id'], 'cheat', 999_999_999)['error']), 'skor di atas batas ditolak');
  $ok('validasi: skor di atas max_score ditolak');

  // --- 21. endpoint admin butuh token ---
  truthy(isset($get('/history')['error']), 'tanpa token ditolak');
  truthy(($get('/history?token=test-token&limit=5')['total'] ?? 0) > 0, 'riwayat terbaca');
  truthy(($get('/stats?token=test-token')['total']['c'] ?? 0) > 0, 'stats terbaca');
  $ok('admin: /history & /stats terlindungi token dan mengembalikan data');

  echo "\n$pass test lulus ✅\n";
  @proc_terminate($srv);
  exit(0);

} catch (Throwable $e) {
  echo "\n❌ TEST GAGAL: " . $e->getMessage() . "\n";
  echo $e->getFile() . ':' . $e->getLine() . "\n";
  @proc_terminate($srv);
  exit(1);
}
