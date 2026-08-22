<?php
// ============================================================
// Router API — Coke Hangout (Nongkrong) Tetris (PHP + MySQL)
// ------------------------------------------------------------
// Sesi (dipakai game):
//   POST /session/join      GET /session/state
//   POST /session/score     GET /session/results
//   GET  /health
// Leaderboard:
//   GET  /leaderboard           papan mingguan (publik)
//   GET  /leaderboard/winners   Top-N + wa_session_id utk submit pemenang (admin)
//   GET  /leaderboard/weeks     daftar minggu yang punya data (publik)
// Operasional (admin):
//   GET  /history   GET /stats   GET /cleanup   GET /kiosk/flush   GET /kiosk/events
//
// Penamaan field mengikuti "Kiosk Vendor Feedback": user_uid, wa_session_id,
// kiosk_id, game_session_id, nickname (normalisasi) + nickname_entered (asli).
// Nama lama (user_id, whats_app_session_id, device_id) masih diterima.
// ============================================================

declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/kiosk.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { send(204, []); }

$method = $_SERVER['REQUEST_METHOD'];
$path   = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// Buang subfolder tempat API dipasang (mis. /coke-api/session/join) supaya
// path yang dicocokkan selalu relatif terhadap folder ini.
$baseDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
if ($baseDir !== '' && str_starts_with($path, $baseDir)) {
  $path = substr($path, strlen($baseDir));
}
$path = '/' . trim($path, '/');
if (str_ends_with($path, '/index.php')) $path = substr($path, 0, -10) ?: '/';

// Kunci antar-proses per kiosk. Tanpa ini dua pemain yang join nyaris
// bersamaan bisa sama-sama tidak melihat sesi milik yang lain lalu
// masing-masing membuat sesi baru (pemain jadi terpisah).
function with_device_lock(string $deviceKey, callable $fn) {
  $name = 'coke_' . substr(md5($deviceKey), 0, 20);
  $st = db()->prepare('SELECT GET_LOCK(?, 5)');
  $st->execute([$name]);
  $got = (int) $st->fetchColumn();
  try {
    return $fn();
  } finally {
    if ($got === 1) { $r = db()->prepare('SELECT RELEASE_LOCK(?)'); $r->execute([$name]); }
  }
}

function admin_guard(): void {
  $token = cfg('admin_token');
  if (!$token) fail(403, 'endpoint admin dimatikan (admin_token kosong di config.php)');
  $given = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? ($_GET['token'] ?? '');
  if (!hash_equals((string) $token, (string) $given)) fail(401, 'token admin salah');
}

// ---------- inti leaderboard ----------
// Q6: skor KUMULATIF sepanjang minggu kalau pemain main berkali-kali
// (dikonfirmasi Grivy), reset tiap Senin pagi -> ISO week WIB.
// Pemain yang didiskualifikasi (putus di tengah game, Q5) tidak dihitung.
// Q7: pencocokan pemenang memakai user_uid, BUKAN nickname — beberapa pemain
// bisa memakai nama tampilan yang sama.
//
// Tie-break: total sama -> yang lebih dulu mencapainya (last_played paling
// awal) menang. Aturan resmi tie-break ada di sisi kiosk; ini hanya default
// yang deterministik supaya urutan tidak acak.
function leaderboard_rows(?string $week, int $limit, string $scoring = 'cumulative'): array {
  $agg = $scoring === 'best' ? 'MAX(score)' : 'SUM(score)';

  $where  = 'disqualified = 0';
  $params = [];
  if ($week !== null) { $where .= ' AND week_key = ?'; $params[] = $week; }

  // GROUP_CONCAT + SEPARATOR 0x1f: ambil nama dari permainan skor tertinggi
  // (aman untuk nickname yang mengandung koma) dan kumpulkan seluruh
  // wa_session_id milik pemain minggu itu — kiosk butuh itu untuk submit
  // pemenang mingguan (Q1).
  $sql = "SELECT user_uid,
                 $agg           AS score,
                 SUM(score)     AS total_score,
                 MAX(score)     AS best_score,
                 COUNT(*)       AS plays,
                 MIN(played_at) AS first_played,
                 MAX(played_at) AS last_played,
                 SUBSTRING_INDEX(GROUP_CONCAT(nickname_entered ORDER BY score DESC, id DESC
                                              SEPARATOR 0x1f), 0x1f, 1) AS nickname_entered,
                 SUBSTRING_INDEX(GROUP_CONCAT(nickname ORDER BY score DESC, id DESC
                                              SEPARATOR 0x1f), 0x1f, 1) AS nickname,
                 SUBSTRING_INDEX(GROUP_CONCAT(kiosk_id ORDER BY id DESC
                                              SEPARATOR 0x1f), 0x1f, 1) AS kiosk_id,
                 GROUP_CONCAT(DISTINCT wa_session_id SEPARATOR 0x1f)    AS wa_session_ids,
                 GROUP_CONCAT(session_id ORDER BY score DESC, id DESC
                              SEPARATOR 0x1f)                          AS game_session_ids
            FROM game_history
           WHERE $where
        GROUP BY user_uid
        ORDER BY score DESC, last_played ASC
           LIMIT $limit";
  $st = db()->prepare($sql);
  $st->execute($params);

  $rows = [];
  foreach ($st->fetchAll() as $i => $r) {
    $wa = array_values(array_filter(explode("\x1f", (string) $r['wa_session_ids'])));
    $gs = array_values(array_filter(explode("\x1f", (string) $r['game_session_ids'])));
    $rows[] = [
      'rank'             => $i + 1,
      'user_uid'         => $r['user_uid'],
      'nickname'         => $r['nickname'],
      'nickname_entered' => $r['nickname_entered'] ?: $r['nickname'],
      'score'            => (int) $r['score'],
      'total_score'      => (int) $r['total_score'],
      'best_score'       => (int) $r['best_score'],
      'plays'            => (int) $r['plays'],
      'kiosk_id'         => $r['kiosk_id'],
      'first_played'     => $r['first_played'],
      'last_played'      => $r['last_played'],
      'wa_session_ids'   => $wa,
      'wa_session_id'    => $wa[0] ?? '',      // untuk submit pemenang (Q1)
      'game_session_ids' => $gs,
    ];
  }
  return $rows;
}

try {

// ---------------- health ----------------
// Sengaja menerima method apa pun — beberapa pemantau (dan uji koneksi kiosk)
// memakai POST/HEAD, bukan GET.
if ($path === '/health') {
  $n = (int) db()->query('SELECT COUNT(*) FROM sessions')->fetchColumn();
  $t = (int) db()->query('SELECT COUNT(*) FROM game_history')->fetchColumn();
  $q = (int) db()->query('SELECT COUNT(*) FROM kiosk_events WHERE status = "pending"')->fetchColumn();
  send(200, ['ok' => true, 'sessions' => $n, 'games_recorded' => $t,
             'kiosk_queue_pending' => $q, 'server_time' => date('c'), 'week' => week_key()]);
}

// ---------------- join ----------------
// Dipanggil saat game di HP dibuka. Mengelompokkan per kiosk_id (device_id)
// dengan window bergulir, lalu MENGEMBALIKAN game_session_id buatan server.
if ($method === 'POST' && $path === '/session/join') {
  $b   = read_body();
  $uid = mb_substr(field($b, 'user_uid', 'user_id'), 0, 128);
  if ($uid === '') fail(400, 'user_uid wajib');

  $kioskId  = mb_substr(field($b, 'kiosk_id', 'device_id'), 0, 128);
  $waId     = mb_substr(field($b, 'wa_session_id', 'whats_app_session_id'), 0, 191);
  $nickNorm = clip(field($b, 'nickname')) ?: 'Player';
  $nickRaw  = clip(field($b, 'nickname_entered')) ?: $nickNorm;

  $key     = device_key_of($kioskId, $uid);
  $durSec  = isset($b['duration']) ? max(0, (int) $b['duration']) : null;
  $maxP    = (int) cfg('max_players');
  $windowM = (int) cfg('join_window_seconds') * 1000;

  $state = with_device_lock($key, function () use ($key, $uid, $kioskId, $waId, $nickNorm,
                                                   $nickRaw, $durSec, $maxP, $windowM) {
    db()->beginTransaction();
    try {
      // sesi yang sedang membentuk untuk kiosk ini
      $st = db()->prepare(
        'SELECT id FROM sessions WHERE device_key = ? AND phase = "waiting"
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE');
      $st->execute([$key]);
      $activeId = $st->fetchColumn();

      $s = null;
      if ($activeId) { $s = load_session((string) $activeId, true); if ($s) advance($s); }

      // belum ada sesi menunggu (atau yang lama sudah mulai) -> sesi BARU
      if (!$s || $s['phase'] !== 'waiting') {
        $s = create_session($key, $durSec);
      } elseif (!$s['duration_ms'] && $durSec) {
        $s['duration_ms'] = $durSec * 1000;
      }

      $now = now_ms();
      if (!isset($s['players'][$uid]) && count($s['players']) < $maxP) {
        db()->prepare(
          'INSERT INTO session_players
             (session_id, user_uid, nickname, nickname_entered, kiosk_id, wa_session_id, joined_at)
           VALUES (?,?,?,?,?,?,?)')
          ->execute([$s['id'], $uid, $nickNorm, $nickRaw, $kioskId, $waId, $now]);
        $s['players'][$uid] = [
          'session_id' => $s['id'], 'user_uid' => $uid, 'nickname' => $nickNorm,
          'nickname_entered' => $nickRaw, 'kiosk_id' => $kioskId, 'wa_session_id' => $waId,
          'score' => null, 'submitted' => 0, 'joined_at' => $now, 'submitted_at' => null,
        ];
        // window bergulir: tiap pemain BARU join, buka lagi window penuh
        $s['deadline'] = $now + $windowM;
      } elseif (isset($s['players'][$uid])) {
        // re-join (HP di-reload): perbarui nama, jangan reset window
        db()->prepare(
          'UPDATE session_players SET nickname = ?, nickname_entered = ?
            WHERE session_id = ? AND user_uid = ?')
          ->execute([$nickNorm, $nickRaw, $s['id'], $uid]);
        $s['players'][$uid]['nickname']         = $nickNorm;
        $s['players'][$uid]['nickname_entered'] = $nickRaw;
      }

      // slot penuh -> mulai sekarang, tak usah tunggu sisa window
      if (count($s['players']) >= $maxP) $s['deadline'] = now_ms();

      save_session($s);
      advance($s);
      db()->commit();
      return public_state($s);
    } catch (Throwable $e) {
      if (db()->inTransaction()) db()->rollBack();
      throw $e;
    }
  });

  // sesekali bersihkan sesi lama + dorong antrean kiosk walau cron belum ada
  if (random_int(1, 25) === 1) {
    try { cleanup(); kiosk_flush(3); } catch (Throwable $e) {}
  }

  send(200, $state);
}

// ---------------- state ----------------
if ($method === 'GET' && $path === '/session/state') {
  $s = load_session((string) ($_GET['session_id'] ?? $_GET['game_session_id'] ?? ''));
  if (!$s) fail(404, 'sesi tidak ditemukan');
  advance($s);
  send(200, public_state($s));
}

// ---------------- score ----------------
// live=true  -> sinkron skor berjalan (belum final)
// live=false -> skor akhir (game over / waktu habis / keluar via beacon)
// Pemain yang tidak pernah mengirim skor akhir akan didiskualifikasi saat
// sesi ditutup (Q5) — skor live-nya tidak dipakai.
if ($method === 'POST' && $path === '/session/score') {
  $b   = read_body();
  $sid = field($b, 'session_id', 'game_session_id');
  $uid = field($b, 'user_uid', 'user_id');

  db()->beginTransaction();
  try {
    $s = load_session($sid, true);
    if (!$s) { db()->rollBack(); fail(404, 'sesi tidak ditemukan'); }
    advance($s);
    if (!isset($s['players'][$uid])) { db()->rollBack(); fail(404, 'pemain tidak ada di sesi'); }

    $incoming = max(0, (int) ($b['score'] ?? 0));
    if ($incoming > (int) cfg('max_score')) { db()->rollBack(); fail(400, 'skor tidak wajar'); }

    $p    = $s['players'][$uid];
    $live = !empty($b['live']);

    if ($live) {
      // selama bermain: hanya naikkan, dan abaikan kalau sudah final
      if (!$p['submitted']) {
        $newScore = max((int) ($p['score'] ?? 0), $incoming);
        db()->prepare('UPDATE session_players SET score = ? WHERE session_id = ? AND user_uid = ?')
            ->execute([$newScore, $s['id'], $uid]);
        $s['players'][$uid]['score'] = $newScore;
      }
    } else {
      $newScore = max((int) ($p['score'] ?? 0), $incoming);
      db()->prepare(
        'UPDATE session_players SET score = ?, submitted = 1, submitted_at = ?
          WHERE session_id = ? AND user_uid = ?')
          ->execute([$newScore, now_ms(), $s['id'], $uid]);
      $s['players'][$uid]['score']     = $newScore;
      $s['players'][$uid]['submitted'] = 1;
    }

    advance($s);          // semua pemain sudah kirim -> 'ended' + arsip + antre kiosk
    db()->commit();
    send(200, ['ok' => true, 'ready' => $s['phase'] === 'ended']);
  } catch (Throwable $e) {
    if (db()->inTransaction()) db()->rollBack();
    throw $e;
  }
}

// ---------------- results ----------------
if ($method === 'GET' && $path === '/session/results') {
  $sid = (string) ($_GET['session_id'] ?? $_GET['game_session_id'] ?? '');
  $s   = load_session($sid);
  if (!$s) {
    // sesi mungkin sudah dibersihkan dari tabel sementara — ambil dari arsip
    $st = db()->prepare(
      'SELECT user_uid, nickname, nickname_entered, wa_session_id, score, mode,
              submitted, disqualified
         FROM game_history WHERE session_id = ?
     ORDER BY disqualified ASC, score DESC');
    $st->execute([$sid]);
    $rows = $st->fetchAll();
    if (!$rows) fail(404, 'sesi tidak ditemukan');
    send(200, [
      'session_id'      => $sid,
      'game_session_id' => $sid,
      'mode'            => $rows[0]['mode'],
      'ready'           => true,
      'results'         => array_map(fn($r) => [
        'user_uid'         => $r['user_uid'],
        'nickname'         => $r['nickname'],
        'nickname_entered' => $r['nickname_entered'] ?: $r['nickname'],
        'wa_session_id'    => $r['wa_session_id'],
        'score'            => (int) $r['score'],
        'submitted'        => (bool) $r['submitted'],
        'disqualified'     => (bool) $r['disqualified'],
      ], $rows),
    ]);
  }
  advance($s);
  send(200, results_payload($s));
}

// ---------------- leaderboard mingguan (publik) ----------------
//   ?week=2026W34   minggu tertentu (default: minggu berjalan)
//   ?limit=10       jumlah baris (default 10, maks 100)
//   ?all_time=1     abaikan minggu, sepanjang aktivasi
//   ?scoring=best   pakai skor tertinggi, bukan kumulatif (default: kumulatif)
if ($method === 'GET' && $path === '/leaderboard') {
  $limit   = min(100, max(1, (int) ($_GET['limit'] ?? 10)));
  $allTime = !empty($_GET['all_time']);
  $week    = $allTime ? null : (string) ($_GET['week'] ?? week_key());
  $scoring = ($_GET['scoring'] ?? cfg('leaderboard_scoring')) === 'best' ? 'best' : 'cumulative';

  $rows = leaderboard_rows($week, $limit, $scoring);
  // wa_session_ids hanya relevan untuk submit pemenang -> jangan diumbar publik
  foreach ($rows as &$r) { unset($r['wa_session_ids'], $r['wa_session_id'], $r['game_session_ids']); }
  unset($r);

  [$from, $to] = $week ? week_range($week) : ['', ''];
  send(200, [
    'scope'       => $allTime ? 'all_time' : 'week',
    'week'        => $week,
    'week_from'   => $from,
    'week_to'     => $to,
    'resets'      => 'Senin 00:00 WIB',
    'scoring'     => $scoring,
    'limit'       => $limit,
    'leaderboard' => $rows,
  ]);
}

// ---------------- daftar minggu yang punya data (publik) ----------------
if ($method === 'GET' && $path === '/leaderboard/weeks') {
  $st = db()->query(
    'SELECT week_key, COUNT(*) plays, COUNT(DISTINCT user_uid) players,
            MIN(played_at) first_played, MAX(played_at) last_played
       FROM game_history WHERE disqualified = 0
   GROUP BY week_key ORDER BY week_key DESC');
  $out = [];
  foreach ($st->fetchAll() as $r) {
    [$from, $to] = week_range($r['week_key']);
    $out[] = $r + ['week_from' => $from, 'week_to' => $to,
                   'is_current' => $r['week_key'] === week_key()];
  }
  send(200, ['weeks' => $out]);
}

// ---------------- pemenang mingguan (admin) ----------------
// Top-N lengkap dengan wa_session_id — inilah yang dibutuhkan kiosk untuk
// submit pemenang mingguan (Q1). Default Top 10 mengikuti "Most Wanted"/
// Top-10 di brief; ganti lewat ?top=.
if ($method === 'GET' && $path === '/leaderboard/winners') {
  admin_guard();
  $top     = min(100, max(1, (int) ($_GET['top'] ?? 10)));
  $week    = (string) ($_GET['week'] ?? week_key());
  $scoring = ($_GET['scoring'] ?? cfg('leaderboard_scoring')) === 'best' ? 'best' : 'cumulative';

  $rows = leaderboard_rows($week, $top, $scoring);
  [$from, $to] = week_range($week);
  send(200, [
    'week' => $week, 'week_from' => $from, 'week_to' => $to,
    'scoring' => $scoring, 'top' => $top,
    'catatan' => 'Cocokkan pemenang lewat user_uid, bukan nickname (Q7). '
               . 'wa_session_id dipakai kiosk untuk submit pemenang (Q1).',
    'winners' => $rows,
  ]);
}

// ---------------- riwayat (admin) ----------------
//   ?day=2026-08-22  ?week=2026W34  ?user_uid=  ?kiosk_id=  ?session_id=
//   ?limit=100 (maks 1000)  ?offset=0  ?include_dq=1
if ($method === 'GET' && $path === '/history') {
  admin_guard();
  $limit  = min(1000, max(1, (int) ($_GET['limit'] ?? 100)));
  $offset = max(0, (int) ($_GET['offset'] ?? 0));

  $where = []; $params = [];
  foreach (['day' => 'day_key', 'week' => 'week_key', 'user_uid' => 'user_uid',
            'user_id' => 'user_uid', 'kiosk_id' => 'kiosk_id', 'device_id' => 'kiosk_id',
            'session_id' => 'session_id'] as $q => $col) {
    if (!empty($_GET[$q])) { $where[] = "$col = ?"; $params[] = (string) $_GET[$q]; }
  }
  if (empty($_GET['include_dq'])) $where[] = 'disqualified = 0';
  $clause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

  $total = db()->prepare("SELECT COUNT(*) FROM game_history $clause");
  $total->execute($params);
  $count = (int) $total->fetchColumn();

  $st = db()->prepare("SELECT * FROM game_history $clause
                        ORDER BY played_at DESC, id DESC LIMIT $limit OFFSET $offset");
  $st->execute($params);
  send(200, ['total' => $count, 'limit' => $limit, 'offset' => $offset,
             'history' => $st->fetchAll()]);
}

// ---------------- rekap (admin) ----------------
if ($method === 'GET' && $path === '/stats') {
  admin_guard();
  $q = fn(string $sql) => db()->query($sql)->fetch();
  send(200, [
    'total'     => $q('SELECT COUNT(*) c, COUNT(DISTINCT session_id) sessions,
                              COUNT(DISTINCT user_uid) players, AVG(score) avg_score,
                              MAX(score) top_score, SUM(disqualified) disqualified
                         FROM game_history'),
    'today'     => $q('SELECT COUNT(*) c, COUNT(DISTINCT session_id) sessions,
                              COUNT(DISTINCT user_uid) players
                         FROM game_history WHERE day_key = "' . date('Y-m-d') . '"'),
    'this_week' => $q('SELECT COUNT(*) c, COUNT(DISTINCT session_id) sessions,
                              COUNT(DISTINCT user_uid) players
                         FROM game_history WHERE week_key = "' . week_key() . '"'),
    'by_mode'   => db()->query('SELECT mode, COUNT(*) c FROM game_history GROUP BY mode')->fetchAll(),
    'live_now'  => $q('SELECT COUNT(*) c FROM sessions WHERE phase <> "ended"'),
    'kiosk_queue' => db()->query('SELECT status, COUNT(*) c FROM kiosk_events GROUP BY status')->fetchAll(),
  ]);
}

// ---------------- antrean kiosk (admin / cron) ----------------
if ($path === '/kiosk/flush') {
  admin_guard();
  send(200, ['ok' => true] + kiosk_flush(min(100, max(1, (int) ($_GET['limit'] ?? 20)))));
}

if ($method === 'GET' && $path === '/kiosk/events') {
  admin_guard();
  $limit = min(200, max(1, (int) ($_GET['limit'] ?? 50)));
  $st = db()->query("SELECT id, event, session_id, status, attempts, http_status,
                            last_error, created_at, sent_at
                       FROM kiosk_events ORDER BY id DESC LIMIT $limit");
  send(200, ['events' => $st->fetchAll()]);
}

// ---------------- cleanup (admin / cron) ----------------
if ($path === '/cleanup') {
  admin_guard();
  send(200, ['ok' => true, 'deleted_sessions' => cleanup()]);
}

fail(404, 'not found');

} catch (Throwable $e) {
  // Jangan bocorkan detail SQL ke klien; tulis ke error_log cPanel.
  error_log('[coke-api] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
  fail(500, 'server error');
}
