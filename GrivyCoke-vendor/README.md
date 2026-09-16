# Coca-Cola ROM Flow 5 — Game Vendor Delivery

This package contains the production web game and PHP/MySQL session backend.
Development files, automated tests, legacy servers, source archives, and local
editor settings have been excluded. The staging integration credentials
provided for this handover are prefilled only in `server-php/config.php`.

## Contents

- `index.html`, `css/`, `js/`, `assets/`: browser game.
- `server-php/`: Flow 5 session API, Grivy Game Connect integration, ROM Game
  Start/Game End callbacks, score storage, and replay lock.
- `server-php/config.php`: staging configuration, intentionally included for
  this private handover.
- `server-php/config.example.php`: clean configuration template.

## Requirements

- PHP 8.1 or newer with PDO MySQL, cURL, and mbstring.
- MySQL or MariaDB using `utf8mb4`.
- HTTPS for both the game and API.
- A cron job running `server-php/cleanup.php` every 1–5 minutes.

## Configuration

Before deployment, edit `server-php/config.php` and fill only:

- `db_name`, `db_user`, and `db_pass`.

The game origin, staging endpoints, Grivy token, ROM API key, and a unique
admin token are already configured. This package must be transferred privately.
Secrets must stay on the PHP server and must never be added to browser
JavaScript or a public repository.

Set `MP_URL_DEFAULT` in `js/config.js` to the deployed PHP API base URL.

## Database installation

1. Upload the contents of `server-php/` to the API document root.
2. Fill `server-php/config.php`.
3. Open `https://API-DOMAIN/install.php?token=ADMIN_TOKEN` once.
4. Confirm that the response is successful, then remove `install.php` from
   the deployed server.
5. Check `https://API-DOMAIN/health`.

Expected health fields include:

```json
{
  "ok": true,
  "grivy_env": "stage",
  "grivy_configured": true,
  "kiosk_configured": true,
  "kiosk_queue_pending": 0,
  "kiosk_queue_failed": 0
}
```

## Required game URL parameters

```text
?wa_session_id=...&user_uid=...&nickname=...&nickname_entered=...&game_session_id=...&device_id=...
```

`game_session_id` and `wa_session_id` are passed through byte-for-byte. A
completed or already-running `game_session_id` cannot start another game when
the same URL is refreshed.

## Callback behavior

- Game Start is sent server-to-server when all expected users are connected
  or the lobby wait window expires.
- Game End is sent server-to-server when all players finish or the result
  grace period expires.
- Failed callback attempts remain visible through the health and protected
  kiosk-event endpoints.
