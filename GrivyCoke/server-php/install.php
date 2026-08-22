<?php
// ============================================================
// Pemasang tabel — buka SEKALI di browser:
//   https://domain-anda/coke-api/install.php?token=ADMIN_TOKEN
// Membaca schema.sql dan menjalankannya (CREATE TABLE IF NOT EXISTS,
// jadi aman dijalankan ulang). Hapus/rename file ini setelah dipakai.
// ============================================================

declare(strict_types=1);
require __DIR__ . '/lib.php';

$token = cfg('admin_token');
if (!$token) fail(403, 'isi admin_token di config.php dulu');
if (!hash_equals((string) $token, (string) ($_GET['token'] ?? ''))) fail(401, 'token salah');

$done = run_schema();

$tables = db()->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
send(200, ['ok' => true, 'dibuat' => $done, 'tabel_di_database' => $tables,
           'catatan' => 'Hapus install.php setelah selesai.']);
