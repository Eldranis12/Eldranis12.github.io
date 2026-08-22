#!/usr/bin/env bash
# ============================================================
# Deploy ke Hostinger/Niagahoster hPanel lewat SSH.
# ------------------------------------------------------------
# Catatan: hPanel BUKAN cPanel — tidak ada perintah `uapi`, jadi database
# dibuat manual sekali lewat hPanel (Database > Management), lalu skrip ini
# mengurus sisanya.
#
# Prasyarat (sekali saja):
#   1. hPanel > Database > Management: buat database + user, catat nama
#      lengkapnya (berprefix, mis. u601572748_coke). Simpan passwordnya.
#   2. hPanel > Tingkat lanjut > SSH Access: aktifkan + import kunci publik
#      Mac ini (~/.ssh/id_ed25519.pub). Catat host, port, username.
#
# Yang dilakukan skrip ini:
#   - upload isi server-php/ ke document root (rsync, aman diulang)
#   - tulis config.php lengkap KECUALI password database (dibiarkan sebagai
#     placeholder supaya password tidak perlu lewat chat/terminal siapa pun)
#   - pasang cron pembersih + pendorong antrean kiosk
#   - kalau password sudah diisi: jalankan pemasang tabel, hapus install.php,
#     lalu verifikasi /health
#
# Aman dijalankan ulang. config.php yang sudah ada TIDAK ditimpa kecuali
# dipaksa dengan --force-config.
#
# Contoh:
#   ./deploy.sh --host 123.45.67.89 --user u601572748 --port 65002 \
#               --db u601572748_coke --db-user u601572748_coke
# ============================================================
set -euo pipefail

HOST=""; SSH_USER=""; PORT=22
DB_NAME=""; DB_USER=""
REMOTE_PATH="public_html/coke-api"
GAME_ORIGIN="https://eldranis12.github.io"
SITE_URL=""
FORCE_CONFIG=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)         HOST="$2"; shift 2 ;;
    --user)         SSH_USER="$2"; shift 2 ;;
    --port)         PORT="$2"; shift 2 ;;
    --db)           DB_NAME="$2"; shift 2 ;;
    --db-user)      DB_USER="$2"; shift 2 ;;
    --path)         REMOTE_PATH="$2"; shift 2 ;;
    --site-url)     SITE_URL="$2"; shift 2 ;;
    --game-origin)  GAME_ORIGIN="$2"; shift 2 ;;
    --force-config) FORCE_CONFIG=1; shift ;;
    *) echo "opsi tidak dikenal: $1" >&2; exit 1 ;;
  esac
done

for v in HOST SSH_USER DB_NAME DB_USER; do
  [[ -z "${!v}" ]] && { echo "wajib: --host --user --db --db-user" >&2; exit 1; }
done

SSH=(ssh -p "$PORT" -o StrictHostKeyChecking=accept-new "$SSH_USER@$HOST")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLACEHOLDER='ISI_PASSWORD_DATABASE_DI_SINI'

echo "==> 1/5 cek koneksi SSH"
"${SSH[@]}" 'echo "  terhubung sebagai $(whoami)"; php -v | head -1 | sed "s/^/  /"'

echo "==> 2/5 upload berkas ke $REMOTE_PATH"
"${SSH[@]}" "mkdir -p '$REMOTE_PATH'"
rsync -az --delete -e "ssh -p $PORT" \
  --exclude 'config.php' --exclude 'test.php' --exclude 'router-dev.php' \
  --exclude 'deploy.sh' --exclude '.gitignore' \
  "$HERE/" "$SSH_USER@$HOST:$REMOTE_PATH/"
"${SSH[@]}" "ls '$REMOTE_PATH' | tr '\n' ' ' | sed 's/^/  /'; echo"

echo "==> 3/5 config.php"
if [[ $FORCE_CONFIG -eq 0 ]] && "${SSH[@]}" "test -f '$REMOTE_PATH/config.php'"; then
  echo "  sudah ada — tidak ditimpa (pakai --force-config kalau mau)"
else
  # openssl, bukan `tr </dev/urandom | head` — kombinasi pipefail + SIGPIPE
  # dari head membuat pipeline itu keluar 141 dan menggagalkan skrip.
  ADMIN_TOKEN="$(openssl rand -hex 24)"
  "${SSH[@]}" "cat > '$REMOTE_PATH/config.php'" <<EOF
<?php
// Dibuat otomatis oleh deploy.sh. JANGAN di-commit ke git.
return [
  'db_host' => 'localhost',
  'db_name' => '$DB_NAME',
  'db_user' => '$DB_USER',
  'db_pass' => '$PLACEHOLDER',
  'db_port' => 3306,

  'join_window_seconds'  => 15,
  'max_players'          => 4,
  'game_seconds'         => 180,
  'result_grace_seconds' => 25,
  'session_ttl_seconds'  => 300,

  'cors_origin' => ['$GAME_ORIGIN'],
  'max_score'   => 100000,
  'admin_token' => '$ADMIN_TOKEN',

  'leaderboard_scoring' => 'cumulative',

  // Isi begitu kiosk vendor mengirim endpoint + auth (Q4, server-to-server).
  'kiosk_start_url'       => '',
  'kiosk_end_url'         => '',
  'kiosk_api_key'         => '',
  'kiosk_api_key_header'  => 'Authorization',
  'kiosk_timeout_seconds' => 10,
  'kiosk_max_attempts'    => 5,

  'timezone' => 'Asia/Jakarta',
];
EOF
  "${SSH[@]}" "chmod 600 '$REMOTE_PATH/config.php'"
  echo "  ditulis (chmod 600); admin_token: $ADMIN_TOKEN"
fi

echo "==> 4/5 cron"
PHP_BIN="$("${SSH[@]}" 'command -v php || echo /usr/bin/php' | tr -d '\r')"
CRON_CMD="$PHP_BIN \$HOME/$REMOTE_PATH/cleanup.php"
if "${SSH[@]}" 'command -v crontab >/dev/null 2>&1'; then
  "${SSH[@]}" "(crontab -l 2>/dev/null | grep -v 'coke-api/cleanup.php'; \
                echo '*/2 * * * * $CRON_CMD >/dev/null 2>&1') | crontab -" \
    && echo "  cron tiap 2 menit dipasang ($PHP_BIN)"
else
  # Shared hosting hPanel tidak mengizinkan crontab lewat SSH — cron diatur
  # dari panel. Bukan error; cukup dipasang sekali lewat UI.
  cat <<EOF
  crontab tidak tersedia lewat SSH (normal di hPanel).
  Pasang sekali lewat hPanel > Tingkat lanjut > Cron Jobs, mode PHP:
      jadwal          : */2 * * * *
      kolom perintah  : $REMOTE_PATH/cleanup.php

  Perhatikan: di mode PHP, hPanel SUDAH menambahkan prefix
  "/usr/bin/php \$HOME/" sendiri — isi kolom perintah dengan path RELATIF
  saja. Kalau perintah lengkap ikut ditempel, prefiksnya jadi dobel dan cron
  gagal diam-diam. Hasil akhir di daftar harus terbaca:
      $CRON_CMD
EOF
fi

echo "==> 5/5 pasang tabel"
if "${SSH[@]}" "grep -q '$PLACEHOLDER' '$REMOTE_PATH/config.php'"; then
  cat <<EOF
  DILEWATI — password database belum diisi.

  Buka hPanel > File manager > $REMOTE_PATH/config.php, ganti baris
      'db_pass' => '$PLACEHOLDER',
  dengan password database yang kamu simpan, lalu simpan.
  Setelah itu jalankan ulang perintah deploy yang sama.
EOF
  exit 0
fi

"${SSH[@]}" "cd '$REMOTE_PATH' && php -r '
  \$c = require \"config.php\";
  \$_GET[\"token\"] = \$c[\"admin_token\"];
  require \"install.php\";
'" | sed 's/^/  /'
"${SSH[@]}" "rm -f '$REMOTE_PATH/install.php'" && echo "  install.php dihapus"

API_URL="${SITE_URL:-https://$HOST}/${REMOTE_PATH##*public_html/}"
echo "  verifikasi: $API_URL/health"
curl -fsS "$API_URL/health" | sed 's/^/  /' && echo

ADMIN_TOKEN="$("${SSH[@]}" "php -r '\$c=require \"$REMOTE_PATH/config.php\"; echo \$c[\"admin_token\"];'")"
cat <<EOF

Selesai.
  URL API     : $API_URL
  Admin token : $ADMIN_TOKEN
  Database    : $DB_NAME

Langkah terakhir: di js/config.js set MP_URL_DEFAULT = '$API_URL'
EOF
