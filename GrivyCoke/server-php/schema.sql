-- ============================================================
-- Skema database — Coke Hangout (Nongkrong) Tetris
-- MySQL / MariaDB (InnoDB, utf8mb4). Import lewat phpMyAdmin cPanel.
-- ------------------------------------------------------------
-- Penamaan field mengikuti dokumen "Kiosk Vendor Feedback" supaya seragam
-- antara Game / Grivy / Kiosk:
--   wa_session_id    -> id sesi WhatsApp milik Grivy (per-user, 1:1)
--   user_uid         -> id pemain dari Grivy (kunci pencocokan pemenang)
--   kiosk_id         -> = device_id (kunci pengelompokan multiplayer)
--   game_session_id  -> id sesi game, DIBUAT server ini (kolom `id`/`session_id`)
--   nickname         -> versi NORMALISASI Grivy (trim, spasi rapat, HURUF BESAR)
--   nickname_entered -> teks asli persis seperti diketik pemain (untuk tampilan)
--
-- 4 tabel:
--   sessions        : sesi kiosk yang sedang berjalan (sementara)
--   session_players : pemain di dalam sesi + skor berjalan (sementara)
--   game_history    : riwayat PERMANEN tiap permainan -> sumber leaderboard
--   kiosk_events    : antrean + jejak panggilan server-to-server ke kiosk (Q4)
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
  id            CHAR(12)      NOT NULL,          -- = game_session_id
  device_key    VARCHAR(191)  NOT NULL,          -- 'dev:<kiosk_id>' atau 'u:<user_uid>'
  phase         ENUM('waiting','playing','ended') NOT NULL DEFAULT 'waiting',
  mode          ENUM('single','multi')           NULL,
  duration_ms   INT           NULL,
  created_at    BIGINT        NOT NULL,          -- epoch ms
  deadline      BIGINT        NOT NULL,          -- batas window tunggu (rolling)
  play_deadline BIGINT        NULL,              -- batas kumpul skor
  ended_at      BIGINT        NULL,
  roster        TEXT          NULL,              -- JSON array user_uid, beku saat mulai
  archived      TINYINT(1)    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_device_phase (device_key, phase, created_at),
  KEY idx_created (created_at),
  KEY idx_archive (archived, phase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_players (
  session_id       CHAR(12)     NOT NULL,
  user_uid         VARCHAR(128) NOT NULL,
  nickname         VARCHAR(64)  NOT NULL DEFAULT 'Player',  -- normalisasi Grivy
  nickname_entered VARCHAR(64)  NOT NULL DEFAULT '',        -- teks asli pemain
  kiosk_id         VARCHAR(128) NOT NULL DEFAULT '',
  wa_session_id    VARCHAR(191) NOT NULL DEFAULT '',
  score            INT          NULL,
  submitted        TINYINT(1)   NOT NULL DEFAULT 0,
  joined_at        BIGINT       NOT NULL,
  submitted_at     BIGINT       NULL,
  PRIMARY KEY (session_id, user_uid),
  KEY idx_session (session_id, joined_at),
  CONSTRAINT fk_players_session FOREIGN KEY (session_id)
    REFERENCES sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Riwayat permanen. TIDAK pernah dihapus oleh cleanup — arsip aktivasi
-- sekaligus sumber leaderboard mingguan.
CREATE TABLE IF NOT EXISTS game_history (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id         CHAR(12)     NOT NULL,      -- = game_session_id
  user_uid           VARCHAR(128) NOT NULL,
  nickname           VARCHAR(64)  NOT NULL,
  nickname_entered   VARCHAR(64)  NOT NULL DEFAULT '',
  kiosk_id           VARCHAR(128) NOT NULL DEFAULT '',
  wa_session_id      VARCHAR(191) NOT NULL DEFAULT '',
  score              INT          NOT NULL DEFAULT 0,
  mode               ENUM('single','multi') NOT NULL DEFAULT 'single',
  rank_in_session    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  players_in_session TINYINT UNSIGNED NOT NULL DEFAULT 1,
  submitted          TINYINT(1)   NOT NULL DEFAULT 1,
  -- Q5: pemain yang putus / tidak menyelesaikan game -> DISKUALIFIKASI.
  -- Barisnya tetap dicatat (untuk audit) tapi skornya 0 dan tidak dihitung
  -- di leaderboard.
  disqualified       TINYINT(1)   NOT NULL DEFAULT 0,
  played_at          DATETIME     NOT NULL,      -- waktu Asia/Jakarta
  week_key           CHAR(8)      NOT NULL,      -- '2026W34' (ISO week, WIB)
  day_key            CHAR(10)     NOT NULL,      -- '2026-08-22'
  PRIMARY KEY (id),
  UNIQUE KEY uq_session_user (session_id, user_uid),
  KEY idx_week_board (week_key, disqualified, user_uid),
  KEY idx_week_score (week_key, score DESC),
  KEY idx_day (day_key),
  KEY idx_user (user_uid),
  KEY idx_played (played_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Antrean panggilan server-to-server ke API kiosk (Q4). Ditulis saat kejadian,
-- dikirim oleh worker (cleanup.php / cron) supaya request pemain tidak ikut
-- menunggu API kiosk, dan supaya kegagalan bisa dicoba ulang.
CREATE TABLE IF NOT EXISTS kiosk_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event        ENUM('game_start','game_end') NOT NULL,
  session_id   CHAR(12)     NOT NULL,
  payload      MEDIUMTEXT   NOT NULL,           -- JSON body yang dikirim
  status       ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_error   VARCHAR(500) NULL,
  http_status  SMALLINT     NULL,
  created_at   DATETIME     NOT NULL,
  sent_at      DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_session (event, session_id),
  KEY idx_status (status, attempts, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
