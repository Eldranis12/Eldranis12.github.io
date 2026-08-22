<?php
// ============================================================
// Inti server sesi — port dari server/server.js (Node) ke PHP + MySQL.
// ------------------------------------------------------------
// Penamaan field mengikuti dokumen "Kiosk Vendor Feedback" (lihat schema.sql).
//
// Perbedaan penting dari versi Node: PHP itu stateless (tiap request proses
// baru), jadi seluruh state sesi hidup di MySQL, bukan di RAM. Logikanya
// sendiri tidak berubah karena versi Node pun sudah menghitung transisi fase
// secara "lazy" tiap request (advance()), bukan lewat timer.
//
// Konkurensi: beberapa pemain bisa menekan tombol di kiosk nyaris bersamaan,
// dan tiap request PHP jalan paralel. Karena itu semua penulisan sesi
// dibungkus transaksi + SELECT ... FOR UPDATE pada baris sesi, supaya dua
// request tidak sama-sama membuat sesi baru untuk kiosk yang sama.
// ============================================================

declare(strict_types=1);

// ---------- konfigurasi ----------
function cfg(?string $key = null) {
  static $c = null;
  if ($c === null) {
    $file = __DIR__ . '/config.php';
    if (!is_file($file)) {
      http_response_code(500);
      header('Content-Type: application/json');
      echo json_encode(['error' => 'config.php belum dibuat (salin dari config.example.php)']);
      exit;
    }
    $c = require $file;
    // Environment variable menimpa config.php (dipakai test & staging):
    // COKE_DB_NAME, COKE_JOIN_WINDOW_SECONDS, COKE_CORS_ORIGIN, dst.
    foreach ($c as $k => $v) {
      $env = getenv('COKE_' . strtoupper($k));
      if ($env === false || $env === '') continue;
      $c[$k] = is_int($v) ? (int) $env : (is_array($v) ? explode(',', $env) : $env);
    }
    date_default_timezone_set($c['timezone'] ?? 'Asia/Jakarta');
  }
  return $key === null ? $c : ($c[$key] ?? null);
}

function now_ms(): int { return (int) round(microtime(true) * 1000); }

// ---------- database ----------
function db(): PDO {
  static $pdo = null;
  if ($pdo === null) {
    $c = cfg();
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
      $c['db_host'], (int) ($c['db_port'] ?? 3306), $c['db_name']);
    try {
      $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
      ]);
    } catch (PDOException $e) {
      fail(500, 'database tidak bisa dihubungi');
    }
  }
  return $pdo;
}

// ---------- helper HTTP ----------
function cors_headers(): void {
  $allowed = cfg('cors_origin');
  $allowed = is_array($allowed) ? $allowed : [$allowed];
  $origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
  if (in_array('*', $allowed, true)) {
    header('Access-Control-Allow-Origin: *');
  } elseif ($origin !== '' && in_array($origin, $allowed, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
  }
  header('Access-Control-Allow-Methods: GET,POST,OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type,X-Admin-Token');
  header('Access-Control-Max-Age: 86400');
}

function send(int $status, array $body): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  cors_headers();
  echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function fail(int $status, string $msg): void { send($status, ['error' => $msg]); }

// Body JSON. navigator.sendBeacon mengirim Content-Type text/plain, jadi
// jangan percaya header — langsung decode raw input.
function read_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === false || $raw === '') return [];
  if (strlen($raw) > 10000) fail(400, 'payload too large');
  $data = json_decode($raw, true);
  if (!is_array($data)) {
    parse_str($raw, $form);              // fallback form-encoded
    return is_array($form) ? $form : [];
  }
  return $data;
}

// Ambil field dengan beberapa nama alternatif (nama baru + nama lama), supaya
// link/klien yang belum diperbarui tetap jalan selama masa transisi.
function field(array $b, string ...$names): string {
  foreach ($names as $n) {
    if (isset($b[$n]) && trim((string) $b[$n]) !== '') return trim((string) $b[$n]);
  }
  return '';
}

function clip($s, int $len = 64): string {
  $s = trim((string) ($s ?? ''));
  return mb_substr($s, 0, $len);
}

function new_id(): string { return bin2hex(random_bytes(6)); }

// Kunci grup: kiosk_id (device_id). Tanpa kiosk (uji tanpa device) -> solo per user.
function device_key_of(string $kioskId, string $uid): string {
  $kioskId = trim($kioskId);
  return $kioskId !== '' ? 'dev:' . $kioskId : 'u:' . $uid;
}

// ---------- muat / simpan sesi ----------
function load_session(string $id, bool $forUpdate = false): ?array {
  if ($id === '') return null;
  $sql = 'SELECT * FROM sessions WHERE id = ?' . ($forUpdate ? ' FOR UPDATE' : '');
  $st = db()->prepare($sql);
  $st->execute([$id]);
  $s = $st->fetch();
  if (!$s) return null;
  $s['players'] = load_players($id);
  $s['roster']  = $s['roster'] ? (json_decode($s['roster'], true) ?: []) : null;
  return $s;
}

function load_players(string $sessionId): array {
  $st = db()->prepare('SELECT * FROM session_players WHERE session_id = ? ORDER BY joined_at ASC');
  $st->execute([$sessionId]);
  $out = [];
  foreach ($st->fetchAll() as $p) $out[$p['user_uid']] = $p;
  return $out;
}

function create_session(string $deviceKey, ?int $durationSec): array {
  $now = now_ms();
  $s = [
    'id'            => new_id(),
    'device_key'    => $deviceKey,
    'phase'         => 'waiting',
    'mode'          => null,
    'duration_ms'   => $durationSec ? $durationSec * 1000 : null,
    'created_at'    => $now,
    'deadline'      => $now + cfg('join_window_seconds') * 1000,
    'play_deadline' => null,
    'ended_at'      => null,
    'roster'        => null,
    'archived'      => 0,
    'players'       => [],
  ];
  $st = db()->prepare(
    'INSERT INTO sessions (id, device_key, phase, duration_ms, created_at, deadline)
     VALUES (?,?,?,?,?,?)');
  $st->execute([$s['id'], $deviceKey, 'waiting', $s['duration_ms'], $now, $s['deadline']]);
  return $s;
}

// Tulis kolom sesi yang berubah setelah advance()/join.
function save_session(array $s): void {
  $st = db()->prepare(
    'UPDATE sessions SET phase=?, mode=?, duration_ms=?, deadline=?, play_deadline=?,
            ended_at=?, roster=? WHERE id=?');
  $st->execute([
    $s['phase'], $s['mode'], $s['duration_ms'], $s['deadline'], $s['play_deadline'],
    $s['ended_at'], $s['roster'] === null ? null : json_encode(array_values($s['roster'])),
    $s['id'],
  ]);
}

// ---------- transisi fase (identik dgn advance() di server.js) ----------
function advance(array &$s): void {
  $now = now_ms();
  $started = false;
  $ended   = false;

  if ($s['phase'] === 'waiting' && $now >= (int) $s['deadline']) {
    $s['phase']  = 'playing';
    $s['roster'] = array_keys($s['players']);
    $s['mode']   = count($s['roster']) > 1 ? 'multi' : 'single';
    $duration    = (int) ($s['duration_ms'] ?: cfg('game_seconds') * 1000);
    $s['play_deadline'] = $now + $duration + cfg('result_grace_seconds') * 1000;
    $started = true;
  }

  if ($s['phase'] === 'playing') {
    $roster = $s['roster'] ?: [];
    $allIn  = count($roster) > 0;
    foreach ($roster as $uid) {
      if (empty($s['players'][$uid]['submitted'])) { $allIn = false; break; }
    }
    if ($allIn || $now >= (int) $s['play_deadline']) {
      $s['phase']    = 'ended';
      $s['ended_at'] = $now;
      $ended = true;
    }
  }

  if ($started || $ended) {
    save_session($s);
    if ($started) queue_kiosk_event('game_start', $s);
    if ($ended) {
      archive_session($s);
      queue_kiosk_event('game_end', $s);
    }
  }
}

// Q5: pemain yang tidak mengirim skor akhir sampai sesi ditutup dianggap
// putus di tengah jalan -> DISKUALIFIKASI. Skor berjalannya tidak dipakai.
function is_disqualified(array $p): bool { return empty($p['submitted']); }

// ---------- snapshot untuk klien ----------
function public_state(array $s): array {
  $now  = now_ms();
  $ids  = $s['phase'] === 'waiting' ? array_keys($s['players']) : ($s['roster'] ?: []);
  $list = [];
  foreach ($ids as $uid) {
    $p = $s['players'][$uid] ?? null;
    $list[] = [
      'user_uid'         => $uid,
      'nickname'         => $p['nickname_entered'] ?: ($p['nickname'] ?? 'Player'),
      'nickname_entered' => $p['nickname_entered'] ?? '',
    ];
  }
  return [
    'session_id'      => $s['id'],
    'game_session_id' => $s['id'],     // nama eksplisit untuk lintas-vendor
    'phase'           => $s['phase'],
    // saat waiting, mode belum final (masih bisa ada yang join) -> provisional
    'mode'            => $s['mode'] ?: (count($s['players']) > 1 ? 'multi' : 'single'),
    'final_mode'      => $s['mode'],
    'count'           => count($list),
    'max'             => (int) cfg('max_players'),
    'players'         => $list,
    'ms_left'         => $s['phase'] === 'waiting' ? max(0, (int) $s['deadline'] - $now) : 0,
    'window_ms'       => (int) cfg('join_window_seconds') * 1000,
  ];
}

function results_payload(array $s): array {
  $isEnded = $s['phase'] === 'ended';
  $ids     = $s['roster'] ?: array_keys($s['players']);
  $rows    = [];
  foreach ($ids as $uid) {
    $p = $s['players'][$uid] ?? null;
    if (!$p) continue;
    $dq = $isEnded && is_disqualified($p);
    $rows[] = [
      'user_uid'         => $uid,
      'nickname'         => $p['nickname'],
      'nickname_entered' => $p['nickname_entered'] ?: $p['nickname'],
      'wa_session_id'    => $p['wa_session_id'] ?: '',
      'score'            => $dq ? 0 : (int) ($p['score'] ?? 0),
      'submitted'        => (bool) $p['submitted'],
      'disqualified'     => $dq,
    ];
  }
  // yang didiskualifikasi selalu di bawah, sisanya skor menurun
  usort($rows, function ($a, $b) {
    if ($a['disqualified'] !== $b['disqualified']) return $a['disqualified'] ? 1 : -1;
    return $b['score'] <=> $a['score'];
  });
  return [
    'session_id'      => $s['id'],
    'game_session_id' => $s['id'],
    'mode'            => $s['mode'],
    'ready'           => $isEnded,
    'results'         => $rows,
  ];
}

// ---------- arsip permanen ----------
// Dipanggil sekali saat sesi masuk fase 'ended'. Menulis tiap pemain ke
// game_history (sumber riwayat + leaderboard). Idempoten lewat UNIQUE KEY
// (session_id, user_uid) -> aman kalau dua request bersamaan memicu 'ended'.
function archive_session(array $s): void {
  if (!empty($s['archived'])) return;
  $ids = $s['roster'] ?: array_keys($s['players']);
  if (!$ids) return;

  $rows = [];
  foreach ($ids as $uid) {
    if (isset($s['players'][$uid])) $rows[] = $s['players'][$uid];
  }
  usort($rows, function ($a, $b) {
    $da = is_disqualified($a); $db = is_disqualified($b);
    if ($da !== $db) return $da ? 1 : -1;
    return ((int) $b['score']) <=> ((int) $a['score']);
  });

  $playedAt = date('Y-m-d H:i:s');
  $weekKey  = week_key();
  $dayKey   = date('Y-m-d');
  $mode     = $s['mode'] ?: (count($rows) > 1 ? 'multi' : 'single');

  $st = db()->prepare(
    'INSERT IGNORE INTO game_history
       (session_id, user_uid, nickname, nickname_entered, kiosk_id, wa_session_id, score,
        mode, rank_in_session, players_in_session, submitted, disqualified,
        played_at, week_key, day_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  foreach ($rows as $i => $p) {
    $dq = is_disqualified($p);
    $st->execute([
      $s['id'], $p['user_uid'], $p['nickname'], $p['nickname_entered'], $p['kiosk_id'],
      $p['wa_session_id'], $dq ? 0 : (int) ($p['score'] ?? 0), $mode,
      $i + 1, count($rows), (int) $p['submitted'], $dq ? 1 : 0,
      $playedAt, $weekKey, $dayKey,
    ]);
  }
  db()->prepare('UPDATE sessions SET archived = 1 WHERE id = ?')->execute([$s['id']]);
}

// ---------- minggu leaderboard ----------
// Q6: leaderboard reset tiap Senin pagi -> ISO week (Senin = hari pertama),
// dihitung pada timezone WIB.
function week_key(?int $ts = null): string {
  $ts = $ts ?? time();
  return date('o', $ts) . 'W' . date('W', $ts);
}

// Rentang tanggal sebuah week_key, untuk ditampilkan di respons.
function week_range(string $weekKey): array {
  if (!preg_match('/^(\d{4})W(\d{2})$/', $weekKey, $m)) return ['', ''];
  $d = new DateTime();
  $d->setISODate((int) $m[1], (int) $m[2]);
  $start = $d->format('Y-m-d');
  $d->modify('+6 days');
  return [$start, $d->format('Y-m-d')];
}

// ---------- antrean kiosk (server-to-server, Q4) ----------
// Payload disiapkan saat kejadian, pengirimannya dilakukan worker terpisah
// (kiosk.php) supaya request pemain tidak menunggu API kiosk dan kegagalan
// bisa dicoba ulang.
function queue_kiosk_event(string $event, array $s): void {
  if (!cfg('kiosk_' . ($event === 'game_start' ? 'start' : 'end') . '_url')) return;

  $ids     = $s['roster'] ?: array_keys($s['players']);
  $players = [];
  foreach ($ids as $uid) {
    $p = $s['players'][$uid] ?? null;
    if (!$p) continue;
    $dq  = $event === 'game_end' && is_disqualified($p);
    $row = [
      'user_uid'         => $uid,
      'wa_session_id'    => $p['wa_session_id'] ?: '',
      'nickname'         => $p['nickname'],
      'nickname_entered' => $p['nickname_entered'] ?: $p['nickname'],
    ];
    if ($event === 'game_end') {
      $row['score']        = $dq ? 0 : (int) ($p['score'] ?? 0);
      $row['disqualified'] = $dq;
    }
    $players[] = $row;
  }
  if ($event === 'game_end') {
    usort($players, fn($a, $b) => $b['score'] <=> $a['score']);
    foreach ($players as $i => &$r) $r['rank'] = $i + 1;
    unset($r);
  }

  $payload = [
    'event'           => $event,
    'game_session_id' => $s['id'],
    'kiosk_id'        => kiosk_id_of($s),
    'mode'            => $s['mode'] ?: 'single',
    'players'         => $players,
    'timestamp'       => date('c'),
  ];

  db()->prepare(
    'INSERT IGNORE INTO kiosk_events (event, session_id, payload, created_at)
     VALUES (?,?,?,?)')
    ->execute([$event, $s['id'], json_encode($payload, JSON_UNESCAPED_UNICODE), date('Y-m-d H:i:s')]);
}

function kiosk_id_of(array $s): string {
  foreach ($s['players'] as $p) { if ($p['kiosk_id'] !== '') return $p['kiosk_id']; }
  return str_starts_with($s['device_key'], 'dev:') ? substr($s['device_key'], 4) : '';
}

// ---------- pembersihan ----------
// Baris sesi hanya sementara (data hidupnya sudah pindah ke game_history).
// Dipanggil oleh cron (cleanup.php) dan sesekali secara acak dari request
// biasa, supaya tabel tetap kecil walau cron belum dipasang.
function cleanup(): int {
  $ttl    = (int) cfg('session_ttl_seconds') * 1000;
  $window = (int) cfg('join_window_seconds') * 1000;
  $game   = (int) cfg('game_seconds') * 1000;
  $now    = now_ms();

  // Tutup + arsipkan sesi yang sudah lewat batas tapi belum sempat ditutup
  // (mis. SEMUA pemain menutup HP -> tak ada request yang memicu advance).
  // Di sinilah diskualifikasi pemain yang hilang benar-benar tercatat.
  $st = db()->prepare(
    'SELECT id FROM sessions WHERE archived = 0 AND created_at < ? LIMIT 50');
  $st->execute([$now - ($window + $game + $ttl)]);
  foreach ($st->fetchAll() as $row) {
    $s = load_session($row['id'], false);
    if (!$s) continue;
    if ($s['phase'] !== 'ended') {
      $s['phase'] = 'ended'; $s['ended_at'] = $now;
      if (!$s['roster']) $s['roster'] = array_keys($s['players']);
      if (!$s['mode'])   $s['mode']   = count($s['roster']) > 1 ? 'multi' : 'single';
      save_session($s);
    }
    archive_session($s);
    queue_kiosk_event('game_end', $s);
  }

  // hapus sesi lama yang SUDAH diarsipkan (session_players ikut via CASCADE)
  $st = db()->prepare(
    'DELETE FROM sessions
      WHERE archived = 1
        AND ((phase = "ended" AND ended_at IS NOT NULL AND ended_at < ?)
             OR created_at < ?)');
  $st->execute([$now - $ttl, $now - ($window + $game + $ttl * 2)]);
  return $st->rowCount();
}

// ---------- pemasang skema ----------
// Menjalankan schema.sql. Komentar dibuang DULU baru dipecah per statement —
// kalau tidak, potongan yang diawali blok komentar ikut terbuang bersama
// CREATE TABLE-nya (dan tabel anak gagal karena foreign key-nya menggantung).
function run_schema(): array {
  $sql = file_get_contents(__DIR__ . '/schema.sql');
  if ($sql === false) throw new RuntimeException('schema.sql tidak terbaca');
  $sql = preg_replace('/^\s*--.*$/m', '', $sql);      // buang baris komentar
  $made = [];
  foreach (explode(';', $sql) as $stmt) {
    $stmt = trim($stmt);
    if ($stmt === '') continue;
    db()->exec($stmt);
    if (preg_match('/CREATE TABLE IF NOT EXISTS\s+(\w+)/i', $stmt, $m)) $made[] = $m[1];
  }
  return $made;
}
