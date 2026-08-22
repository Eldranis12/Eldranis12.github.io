# Switching FANTA Horror from Testing to Live

How to move the game from the **staging** channel to the **live campaign**.

*(Versi Bahasa Indonesia: [GANTI-KE-LIVE.md](GANTI-KE-LIVE.md))*

The change itself is one number. The rest is verification — plus one trap
(see [Hosting requirement](#hosting-requirement)) that can make every player see
"coupons finished" while the coupons are actually still available.

---

## What the two channels differ on

| | Channel `0` — Testing | Channel `1` — Live |
|---|---|---|
| Domain | `https://stage.grivy.app` | `https://fun.fanta.id` |
| Cinema campaign code | `fanta-horror-testing-main-cinema` | `fanta-horror-196` |
| Fanta campaign code | `fanta-horror-testing-main-voucher` | `fanta-horror-564` |

These codes are used both to check coupon quota **and** to route the player when
they tap "AMBIL VOUCHER DI SINI". On the wrong channel, players are sent to the
wrong campaign.

---

## Step 1 — The channel

**Already done.** [`js/game.js`](js/game.js) **line 13** now ships as:

```js
const DEFAULT_CHANNEL = 1; // 0 = Staging / Testing, 1 = Live / Real Campaign
```

To go back to staging, change the `1` to `0`. That is the whole change — leave
the `CHANNELS` array below it alone, the campaign codes for both channels are
already filled in there.

## Step 2 — Bump the cache version

This is **required**, not optional. Browsers cache `game.js`; without this, a
returning player can keep running the testing build for days.

Open [`index.html`](index.html), **line 193**:

```html
<script src="js/game.js?v=20260813-coupon-fix"></script>
```

Replace the `?v=` value with anything new — the go-live date works well:

```html
<script src="js/game.js?v=20260901-live"></script>
```

## Step 3 — Commit and push

```bash
git add js/game.js index.html && git commit -m "Switch channel to live" && git push
```

---

## Verification

Open the game, then open the **browser console** (on a phone: use Safari/Chrome
remote debugging, or test on desktop first). Look for this log line:

```
[GRIVY DEBUG hh:mm:ss] 🎟️ Init Config & Channel Info
```

Expand it and confirm:

```
channelMode : "1 (Real Campaign)"
domain      : "https://fun.fanta.id"
activeCodes : { cinemaMain: "fanta-horror-196", fantaMain: "fanta-horror-564" }
```

If it still says `0 (Staging / Testing)`, or the domain is `stage.grivy.app`,
then either Step 1 was not saved or the browser is still running the old
`game.js` — redo Step 2 and hard-refresh.

Then check the next log, `API Request: Check Coupon Quota`, and confirm
`endpointUrl` points at `https://fun.fanta.id/api/games/campaigns-check-active`.

---

## Hosting requirement

**The game must be hosted on `fun.fanta.id`** (production lives at
`fun.fanta.id/c/fanta-horror-game-922`).

Here is why: the quota check calls
`https://fun.fanta.id/api/games/campaigns-check-active`. If the game is opened
from any other domain — `eldranis12.github.io`, for instance — that call becomes
cross-origin and will most likely be blocked by the browser.

What happens when it is blocked: the game does **not** error. It falls back to
its fail-closed path and treats coupons as finished. Every player then sees the
"YAKALI GAK MAU FANTA" state even though coupons are still available, and
nothing visible tells them (or you) that anything went wrong.

So `DEFAULT_CHANNEL = 1` on GitHub Pages is **not** a valid test. Only test live
on `fun.fanta.id`.

---

## Alternatives that don't touch the code

Useful for testing live before actually releasing.

### Via URL

Append a parameter:

```
?env=live       (or ?channel=1)   -> force live
?env=test       (or ?channel=0)   -> force testing
```

Example: `https://fun.fanta.id/c/fanta-horror-game-922?env=live`

### Via host config

If the game is embedded and the host decides the channel, define this **before**
`game.js` loads:

```html
<script>window.FANTA_HORROR_CONFIG = { env: 'live' };</script>
```

### Priority order

URL parameter → `window.FANTA_HORROR_CONFIG` → `DEFAULT_CHANNEL`

The URL parameter always wins. If someone shares a link containing `?env=test`,
whoever opens it runs the testing build even though `DEFAULT_CHANNEL` is `1`.

---

## Do not share the QA parameters

These bypass the real quota check and **force** the coupon state:

| Parameter | Effect |
|---|---|
| `?coupon=active` | Force all coupons available |
| `?coupon=out` | Force all coupons finished |
| `?coupon=fanta-out` | Force Fanta coupons finished |
| `?coupon=cinema-out` | Force cinema coupons finished |

They are deliberately left enabled for QA. Just keep them out of any link sent
to the public: `?coupon=active` makes the game offer vouchers even after the
quota is exhausted in Grivy.

---

## Rolling back to testing

Set `DEFAULT_CHANNEL` back to `0`, bump `?v=` in `index.html` again, commit,
push. Or for a quick check without deploying, open the game with `?env=test`.

---

## Troubleshooting

**Every player sees "coupons finished" but quota is still available**
Almost certainly the API call failed and the game fell back to fail-closed.
Check the console for `Coupon Quota API Check Failed / Fallback Active`. Most
common cause: the game is not hosted on `fun.fanta.id`
(see [Hosting requirement](#hosting-requirement)), or the API did not answer
within 3 seconds (there is a timeout).

**Channel is still testing after changing it**
Cache. Make sure `?v=` in `index.html` was changed, then hard-refresh. Also
check the URL has no `?env=test` — the URL parameter beats the code setting.

**Voucher button routes to the wrong campaign**
Wrong channel. Verify via the `Init Config & Channel Info` log as described
under [Verification](#verification).

**Inspecting the raw API response**
Type `lastGrivyResponse` in the console. If it failed, `lastGrivyError` holds
the message.
