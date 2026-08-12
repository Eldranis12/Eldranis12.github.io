/**
 * FANTA Horror Game Engine
 * Manages game loop, 3x3 grave slots, spawning logic, Suzzanna multi-tap defense, and UI states.
 * Updated to remove rectangular ice overlay box and apply frozen effect directly to targets.
 */

/*
 * Grivy campaign config — source: "Fanta Horror Q3_26 - Game URLs - Channels".
 * Set CHANNEL to 0 for the staging/testing channel, 1 for the live campaign.
 * In production the game is served from fun.fanta.id/c/fanta-horror-game-922,
 * so the coupon API call is same-origin.
 */
const DEFAULT_CHANNEL = 0; // 0 = Staging / Testing, 1 = Live / Real Campaign

// Resolve channel from URL param (?env=live | ?channel=1) or window.FANTA_HORROR_CONFIG or default
const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const urlEnv = urlParams?.get('env') || urlParams?.get('channel');
const RUNTIME_CONFIG = window.FANTA_HORROR_CONFIG || {};

let resolvedChannel = DEFAULT_CHANNEL;
if (urlEnv === 'live' || urlEnv === '1' || RUNTIME_CONFIG.channel === 1 || RUNTIME_CONFIG.env === 'live') {
    resolvedChannel = 1;
} else if (urlEnv === 'test' || urlEnv === 'staging' || urlEnv === '0' || RUNTIME_CONFIG.channel === 0 || RUNTIME_CONFIG.env === 'test') {
    resolvedChannel = 0;
}
const CHANNEL = resolvedChannel;

const CHANNELS = [
    {   // 0 - Testing / Staging
        domain: 'https://stage.grivy.app',
        cinemaMain: 'fanta-horror-testing-main-cinema',
        fantaMain: 'fanta-horror-testing-main-voucher',
        childCampaigns: {
            cinema: [],
            fanta: []
        }
    },
    {   // 1 - Real Campaign (Live)
        domain: 'https://fun.fanta.id',
        cinemaMain: 'fanta-horror-196',
        fantaMain: 'fanta-horror-564',
        childCampaigns: {
            cinema: [],
            fanta: []
        }
    }
];

const GRIVY = {
    ...CHANNELS[CHANNEL],
    ...RUNTIME_CONFIG,
    childCampaigns: {
        ...CHANNELS[CHANNEL].childCampaigns,
        ...(RUNTIME_CONFIG.childCampaigns || {})
    }
};
const campaignUrl = code => `${GRIVY.domain}/c/${code}`;
const normalizeCampaigns = campaigns => (campaigns || [])
    .map(campaign => typeof campaign === 'string' ? { code: campaign } : campaign)
    .filter(campaign => campaign && campaign.code);

const GRIVY_ACTIONS = {
    getPrize: 'GET_PRIZE',
    getVoucher: 'GET_VOUCHER'
};

function logGrivyDebug(title, data, isError = false) {
    const time = new Date().toLocaleTimeString();
    const prefix = `[GRIVY DEBUG ${time}]`;
    if (isError) {
        console.error(`${prefix} ❌ ${title}:`, data);
    } else {
        console.group(`${prefix} 🎟️ ${title}`);
        console.log('Data / Payload:', data);
        console.groupEnd();
    }
}

// Human-readable names Grivy listens for on the redirect actions.
const GRIVY_EVENT_NAMES = {
    getPrize: 'Get Prize',
    getVoucher: 'Get Voucher'
};

/*
 * Journey/analytics events for the Grivy host.
 *
 * Shape is the one Grivy asked for -- { eventName } -- with context alongside it, so a
 * listener reading only eventName is unaffected. Unlike triggerGrivyAction these are
 * pure notifications: they never redirect, because they fire during normal play rather
 * than in response to a CTA.
 */
function emitGameEvent(eventName, extra = {}) {
    const payload = { eventName, source: 'fanta-horror-game', ...extra };

    logGrivyDebug(`Event Sent: ${eventName}`, payload);

    window.dispatchEvent(new CustomEvent(`fanta-horror:${eventName}`, { detail: payload }));

    if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, GRIVY.appOrigin || '*');
    }
}

function triggerGrivyAction(action, campaignCode) {
    const payload = {
        eventName: GRIVY_EVENT_NAMES[action],
        source: 'fanta-horror-game',
        type: GRIVY_ACTIONS[action],
        action,
        campaignCode
    };

    logGrivyDebug(`Action Triggered: ${action}`, {
        payload,
        redirectUrl: campaignUrl(campaignCode)
    });

    // Useful for hosts that mount the game in the same document.
    window.dispatchEvent(new CustomEvent(`fanta-horror:${action}`, {
        detail: payload
    }));

    // The Grivy app can listen to this when the game is embedded in an iframe/webview.
    if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, GRIVY.appOrigin || '*');
        return;
    }

    // Standalone/local browser fallback.
    window.location.href = campaignUrl(campaignCode);
}

// Pacing: bottles arrive one wave ("sesi") at a time. Only SESSION_THREATS of each wave
// is ever grabbed by Suzzanna; the rest wait to be tapped. Lower SESSION_SIZE or raise
// SESSION_GAP_MS to slow the game down further.
// Poster handed to the OS share sheet when the player taps SHARE.
// (The source file really is double-extensioned: "...Share.jpg.jpeg".)
const SHARE_IMAGE_URL = 'assets/fanta_horror_poster_share.jpg';
const SHARE_IMAGE_FILENAME = 'fanta-horror-enak-rebutan.jpg';
const SHARE_LINK_URL = 'https://fantaurl.com/q/REF26';

// Warning banners for the closing lives; anything not listed shows nothing.
const LIFE_NOTIF_ART = {
    3: 'assets/notif_3_nyawa.webp',
    2: 'assets/notif_2_nyawa.webp',
    1: 'assets/notif_1_nyawa.webp',
    0: 'assets/notif_nyawa_habis.webp'
};
const LIFE_NOTIF_MS = 1600;

const SESSION_SIZE = 5;
const SESSION_THREATS = 1;
const SESSION_GAP_MS = 700;
const ATTACK_DELAY_MS = 1000;
const BOTTLE_FLAVORS = ['orange', 'strawberry', 'fruit-punch', 'grape'];

class FantaHorrorGame {
    constructor() {
        this.gameState = 'LP'; // 'LP', 'VOUCHER_SELECT', 'PLAYING', 'WIN', 'LOSE'
        this.entryMode = 'GAME'; // 'GAME', 'CLAIM_WINNER_VOUCHER'
        this.timer = 30;
        this.timerInterval = null;
        this.spawnerInterval = null;
        this.ambientInterval = null;
        this.lifeNotifTimeout = null;
        this.sessionPending = false;
        this.sessionTimeout = null;
        this.health = 5;
        this.maxHealth = 5;
        this.selectedVoucher = null; // 'CGV', 'CINEPOLIS', 'XXI'

        // Coupon availability per campaign, resolved from the Grivy API on load.
        // Default true = fail open: a live campaign is never hidden because the check failed;
        // the Grivy landing page is the real source of truth if coupons ran out mid-session.
        this.cinemaAvailable = true;
        this.fantaAvailable = true;

        // Quota state for testing (true = active 'PILIH', false = habis 'HABIS')
        this.voucherQuota = {
            CGV: true,
            CINEPOLIS: true,
            XXI: true
        };

        // 9 grave slots state
        this.slots = Array.from({ length: 9 }, (_, i) => ({
            id: i,
            status: 'empty', // 'empty', 'bottle', 'suzzanna', 'saved', 'frozen'
            tapsLeft: 0,
            timeoutId: null,
            flavor: null,
            el: null
        }));

        this.initDOM();
    }

    initDOM() {
        document.addEventListener('DOMContentLoaded', () => {
            window.soundManager.init();

            // Store DOM elements
            this.screens = {
                lp: document.getElementById('screen-lp'),
                voucherSelect: document.getElementById('screen-voucher-select'),
                game: document.getElementById('screen-game'),
                win: document.getElementById('screen-win'),
                lose: document.getElementById('screen-lose')
            };

            this.modals = {
                caraBermain: document.getElementById('modal-cara-bermain')
            };

            this.ui = {
                timerText: document.getElementById('timer-display'),
                healthContainer: document.getElementById('health-bar'),
                gravesGrid: document.getElementById('graves-grid'),
                lifeNotif: document.getElementById('life-notif'),
                audioToggleBtn: document.getElementById('audio-toggle-btn'),
                selectedVoucherWin: document.getElementById('selected-voucher-win-text'),
                selectedVoucherLose: document.getElementById('selected-voucher-lose-text')
            };

            this.bindEvents();
            this.renderGraveGrid();
            this.applyLandingVariant();
            this.preloadShareImage();
            this.switchScreen('LP');
            this.checkCouponQuota();
        });
    }

    /*
     * Grivy "campaigns-check-active" API.
     * Evaluates campaign availability. If API returns [] or code is missing,
     * it treats coupons as RUN OUT (State B).
     */
    async checkCouponQuota() {
        const params = new URLSearchParams(window.location.search);
        const couponPreview = params.get('coupon');

        logGrivyDebug('Init Config & Channel Info', {
            channelMode: CHANNEL === 1 ? '1 (Real Campaign)' : '0 (Staging / Testing)',
            domain: GRIVY.domain,
            activeCodes: {
                cinemaMain: GRIVY.cinemaMain,
                fantaMain: GRIVY.fantaMain
            },
            childCampaigns: GRIVY.childCampaigns
        });

        // QA previews remain active for testing safeguards.
        if (couponPreview === 'out') {
            this.cinemaAvailable = false;
            this.fantaAvailable = false;
            logGrivyDebug('QA Coupon Preview Override', { couponPreview: 'out', cinemaAvailable: false, fantaAvailable: false });
        } else if (couponPreview === 'active') {
            this.cinemaAvailable = true;
            this.fantaAvailable = true;
            logGrivyDebug('QA Coupon Preview Override', { couponPreview: 'active', cinemaAvailable: true, fantaAvailable: true });
        } else {
            const requestController = new AbortController();
            const requestTimeout = setTimeout(() => requestController.abort(), 3000);

            try {
                const cinemaChildren = normalizeCampaigns(GRIVY.childCampaigns.cinema);
                const fantaChildren = normalizeCampaigns(GRIVY.childCampaigns.fanta);
                const cinemaCodes = cinemaChildren.length
                    ? cinemaChildren.map(campaign => campaign.code)
                    : [GRIVY.cinemaMain];
                const fantaCodes = fantaChildren.length
                    ? fantaChildren.map(campaign => campaign.code)
                    : [GRIVY.fantaMain];
                const campaignCodes = [...new Set([...cinemaCodes, ...fantaCodes])];

                const apiUrl = `${GRIVY.domain}/api/games/campaigns-check-active`;
                const requestBody = { campaign_public_codes: campaignCodes };

                logGrivyDebug('API Request: Check Coupon Quota', {
                    endpointUrl: apiUrl,
                    publicCodesSent: campaignCodes,
                    requestPayload: requestBody
                });

                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: requestController.signal,
                    body: JSON.stringify(requestBody)
                });

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const data = await res.json();
                if (!Array.isArray(data)) throw new Error('unexpected response shape');

                window.lastGrivyResponse = data;
                window.lastGrivyError = null;

                logGrivyDebug('API Response: Check Coupon Quota', {
                    httpStatus: `${res.status} OK`,
                    responseData: data,
                    tip: 'Type "lastGrivyResponse" in console to view raw data'
                });

                // Treat [] empty array or unlisted public code as COUPON RUNS OUT (false)
                const available = code => {
                    const c = data.find(item => item && item.public_code === code);
                    if (!c) return false; // [] or not found = coupon runs out
                    return !!(c.campaign_active && !c.coupons_finished);
                };

                this.cinemaAvailable = cinemaCodes.some(available);
                this.fantaAvailable = fantaCodes.some(available);

                const cinemaAvailability = Object.fromEntries(
                    cinemaChildren.map(campaign => [
                        String(campaign.name || '').toUpperCase(),
                        available(campaign.code)
                    ])
                );
                ['CGV', 'CINEPOLIS', 'XXI'].forEach(voucher => {
                    if (voucher in cinemaAvailability) {
                        this.voucherQuota[voucher] = cinemaAvailability[voucher];
                    }
                });

                logGrivyDebug('Resolved Quota Status', {
                    cinemaAvailable: this.cinemaAvailable,
                    fantaAvailable: this.fantaAvailable,
                    voucherQuota: this.voucherQuota
                });
            } catch (err) {
                window.lastGrivyResponse = null;
                window.lastGrivyError = err.message || String(err);
                /*
                 * Fail closed, same stance as an unlisted public_code: nothing is offered
                 * until the API actually confirms it. A network error, a CORS block or a
                 * timeout is not a "yes" -- it is simply no answer yet. Use ?coupon=active
                 * to force the CTAs on while testing without a reachable API.
                 */
                this.cinemaAvailable = false;
                this.fantaAvailable = false;
                logGrivyDebug('Coupon Quota API Check Failed / Fallback Active', {
                    error: err.message || err,
                    fallbackState: 'Kupon Habis until the API answers (Fail Closed)',
                    tip: 'Append ?coupon=active to override while testing locally'
                }, true);
            } finally {
                clearTimeout(requestTimeout);
            }
        }

        this.applyQuotaUI();

        document.getElementById('app-container')?.classList.remove('quota-loading');

        /*
         * QA shortcut: jump straight to one screen instead of playing a round to reach it.
         * Runs after the quota resolves so the screen lands in whichever CTA state
         * ?coupon= asked for. Aliases are accepted because the internal names are not
         * what anyone types -- ?screen=voucher is friendlier than VOUCHER_SELECT.
         */
        const SCREEN_ALIASES = {
            lp: 'LP',
            voucher: 'VOUCHER_SELECT', voucher_select: 'VOUCHER_SELECT',
            game: 'PLAYING', playing: 'PLAYING',
            win: 'WIN',
            lose: 'LOSE'
        };
        const screenPreview = SCREEN_ALIASES[String(params.get('screen') || '').toLowerCase()];
        if (screenPreview) {
            logGrivyDebug('QA Screen Preview', { requested: params.get('screen'), screen: screenPreview });
            this.switchScreen(screenPreview);
        }

        // Fired here, not on DOMContentLoaded: until the quota resolves the landing page
        // is still behind the loading veil, so this is the first moment it is really up.
        emitGameEvent('game_loaded', {
            cinemaAvailable: this.cinemaAvailable,
            fantaAvailable: this.fantaAvailable
        });
    }

    /*
     * Landing variant (brief "Landing Page"): the upload-struk offer is a desktop-only,
     * once-per-session view. Phones always get the compact CARA BERMAIN + MAIN GAME row,
     * and so does any desktop reload -- the sessionStorage flag is what makes the second
     * view "compact", so it survives reloads but resets for a genuinely new visit.
     */
    applyLandingVariant() {
        const SEEN_KEY = 'fanta-lp-offer-seen';
        const isMobile = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        let seen = false;
        try {
            seen = sessionStorage.getItem(SEEN_KEY) === '1';
            if (!isMobile) sessionStorage.setItem(SEEN_KEY, '1');
        } catch (err) {
            // Private mode / storage disabled: fall back to always showing the offer.
        }

        const compact = isMobile || seen;
        this.screens.lp?.classList.toggle('lp-compact-mode', compact);
    }

    /*
     * Share sheet carries the campaign poster image, not just a link.
     */
    preloadShareImage() {
        this.shareFilePromise = fetch(SHARE_IMAGE_URL)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.blob();
            })
            .then(blob => new File([blob], SHARE_IMAGE_FILENAME, { type: blob.type || 'image/png' }))
            .catch(err => {
                console.warn('Share image unavailable, will share the link only:', err);
                return null;
            });
        this.shareFilePromise.then(file => { this.shareFile = file; });
    }

    shareGame() {
        const payload = {
            title: 'FANTA Horror Game',
            text: 'Berani coba??? Amankan Fanta dari gentayangan Suzzanna!',
            url: SHARE_LINK_URL
        };

        if (this.shareFile && navigator.canShare?.({ files: [this.shareFile] })) {
            navigator.share({ ...payload, files: [this.shareFile] }).catch(() => {});
            return;
        }

        if (navigator.share) {
            navigator.share(payload).catch(() => {});
            return;
        }

        if (this.shareFile) {
            const href = URL.createObjectURL(this.shareFile);
            const a = document.createElement('a');
            a.href = href;
            a.download = SHARE_IMAGE_FILENAME;
            a.click();
            URL.revokeObjectURL(href);
            return;
        }

        alert('Salin Link Game: ' + SHARE_LINK_URL);
    }

    // Re-applies coupon-dependent CTA visibility:
    // State A (hasCoupons = true): 3 buttons on LP, Win, and Lose
    // State B (hasCoupons = false): 2 buttons on LP, Win, and Lose
    applyQuotaUI() {
        const lpScreen = document.getElementById('screen-lp');
        const winScreen = document.getElementById('screen-win');
        const loseScreen = document.getElementById('screen-lose');

        /*
         * normal      : voucher Fanta tersedia.
         * voucher-out : voucher Fanta habis, tetapi kupon cinema masih tersedia.
         * coupon-out  : semua kupon habis; CTA hilang dan SHARE / MAIN LAGI turun.
         */
        const couponOut = !this.fantaAvailable && !this.cinemaAvailable;
        const voucherOut = !this.fantaAvailable && !couponOut;

        lpScreen?.classList.toggle('coupon-out', !this.cinemaAvailable);

        [winScreen, loseScreen].forEach(screen => {
            screen?.classList.toggle('coupon-out', couponOut);
            screen?.classList.toggle('voucher-out', voucherOut);
        });

        document.getElementById('btn-upload-struk')?.classList.toggle('hidden', !this.cinemaAvailable);
        document.querySelector('.btn-ambil-voucher-win')?.classList.toggle('hidden', couponOut);
        document.querySelector('.btn-ambil-voucher-lose')?.classList.toggle('hidden', couponOut);
    }

    bindEvents() {
        // Sound toggle
        this.ui.audioToggleBtn?.addEventListener('click', () => {
            const isMuted = window.soundManager.toggleMute();
            this.ui.audioToggleBtn.classList.toggle('muted', isMuted);
            this.ui.audioToggleBtn.setAttribute('aria-label', isMuted ? 'Unmute Audio' : 'Mute Audio');
        });

        // LP "MAIN GAME" -- the same hotspot in both landing variants, only re-placed by CSS.
        document.getElementById('btn-main-game')?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            this.entryMode = 'GAME';
            this.startGame();
        });

        // LP Button 2: "UPLOAD STRUK & AMBIL VOUCHERNYA" -> Grivy cinema-voucher campaign page
        document.getElementById('btn-upload-struk')?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            emitGameEvent('upload_receipt', { campaignCode: GRIVY.cinemaMain });
            triggerGrivyAction('getVoucher', GRIVY.cinemaMain);
        });

        // LP "CARA BERMAIN" -- likewise one hotspot, re-placed per variant.
        document.getElementById('btn-cara-bermain')?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            this.showModal('caraBermain');
        });

        // Modal close button
        document.getElementById('btn-close-cara-bermain')?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            this.hideModal('caraBermain');
        });

        // Voucher Cards Selection Logic ("PILIH VOUCHER DULU YUK")
        document.querySelectorAll('.voucher-card').forEach(card => {
            card.addEventListener('click', () => {
                const voucherType = card.dataset.voucher;
                
                // If quota runs out (HABIS), option can't be clicked
                if (!this.voucherQuota[voucherType]) {
                    window.soundManager.playSfx('buttonClick');
                    return;
                }

                window.soundManager.playSfx('buttonClick');
                this.selectedVoucher = voucherType;

                // This screen is now only reached via the winner's "AMBIL VOUCHER DI SINI" claim flow
                // ("Upload Struk" redirects off-app to Grivy instead, per brief "Kupon Habis" v2)
                alert(`Selamat! Voucher ${this.selectedVoucher} berhasil diklaim untuk menonton bioskop pilihanmu!`);
            });
        });

        // Win / Lose Screen buttons
        document.querySelectorAll('.btn-main-lagi').forEach(btn => {
            btn.addEventListener('click', () => {
                window.soundManager.playSfx('buttonClick');
                this.entryMode = 'GAME';
                this.startGame(); // Restarts game directly
            });
        });

        document.querySelectorAll('.btn-share').forEach(btn => {
            btn.addEventListener('click', () => {
                window.soundManager.playSfx('buttonClick');
                this.shareGame();
            });
        });

        // Win & Lose Screens: "YAKALI GAK MAU FANTA" -> Grivy Fanta-voucher campaign page.
        // Hidden entirely when that campaign's coupons are finished (brief "Kupon Habis").
        document.querySelectorAll('.btn-ambil-voucher').forEach(btn => {
            btn.addEventListener('click', () => {
                window.soundManager.playSfx('buttonClick');
                emitGameEvent('get_voucher', { campaignCode: GRIVY.fantaMain });
                triggerGrivyAction('getPrize', GRIVY.fantaMain);
            });
        });
    }

    renderGraveGrid() {
        if (!this.ui.gravesGrid) return;
        this.ui.gravesGrid.innerHTML = '';
        this.slots.forEach(slot => {
            const slotEl = document.createElement('div');
            slotEl.className = 'grave-slot';
            slotEl.dataset.id = slot.id;

            const targetContainer = document.createElement('div');
            targetContainer.className = 'slot-target-container';

            const suzzannaEl = document.createElement('div');
            suzzannaEl.className = 'target-element suzzanna-hand';

            const bottleEl = document.createElement('div');
            bottleEl.className = 'target-element fanta-bottle';

            const stolenEl = document.createElement('div');
            stolenEl.className = 'target-element suzzanna-stolen';

            const tapBadge = document.createElement('div');
            tapBadge.className = 'tap-counter-badge';
            tapBadge.textContent = 'TAP 3X!';

            targetContainer.appendChild(suzzannaEl);
            targetContainer.appendChild(bottleEl);
            targetContainer.appendChild(stolenEl);
            targetContainer.appendChild(tapBadge);

            slotEl.appendChild(targetContainer);
            this.ui.gravesGrid.appendChild(slotEl);

            slot.el = slotEl;

            // Slot click/tap handler
            slotEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleSlotTap(slot);
            });
            slotEl.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.handleSlotTap(slot);
            }, { passive: false });
        });
    }

    switchScreen(screenName) {
        this.gameState = screenName;
        const appContainer = document.getElementById('app-container');
        const normalWinner = screenName === 'WIN'
            && !this.screens.win?.classList.contains('voucher-out');
        // iOS 14 has no :has(), so expose the active clean winner state explicitly.
        // CSS uses it only to let the viewport-wide win plate escape the 6:13 UI clip.
        appContainer?.classList.toggle('win-fullbleed', normalWinner);
        Object.keys(this.screens).forEach(key => {
            if (this.screens[key]) {
                this.screens[key].classList.add('hidden');
            }
        });

        if (screenName === 'LP') {
            this.screens.lp?.classList.remove('hidden');
        } else if (screenName === 'VOUCHER_SELECT') {
            this.updateVoucherUI();
            this.screens.voucherSelect?.classList.remove('hidden');
        } else if (screenName === 'PLAYING') {
            this.screens.game?.classList.remove('hidden');
            window.soundManager.playBgm('bgm');
        } else if (screenName === 'WIN') {
            this.screens.win?.classList.remove('hidden');
            if (this.ui.selectedVoucherWin) {
                this.ui.selectedVoucherWin.textContent = `EMANG PALING GERCEP, FANTA AMAN!`;
            }
            this.applyQuotaUI();
            window.soundManager.stopBgm();
            window.soundManager.playSequence('winA', 'winB', 2);
        } else if (screenName === 'LOSE') {
            this.screens.lose?.classList.remove('hidden');
            if (this.ui.selectedVoucherLose) {
                this.ui.selectedVoucherLose.textContent = `HAUSSSS..... YAH FANTANYA UDAH HABIS!!!`;
            }
            this.applyQuotaUI();
            window.soundManager.stopBgm();
            window.soundManager.playSequence('loseA', 'loseB', 5);
        }
    }

    updateVoucherUI() {
        document.querySelectorAll('.voucher-card').forEach(card => {
            const vType = card.dataset.voucher;
            const isAvailable = this.voucherQuota[vType];
            const imgEl = card.querySelector('img');
            
            card.classList.toggle('quota-out', !isAvailable);

            if (imgEl) {
                const lowerType = vType.toLowerCase();
                imgEl.src = isAvailable ? `assets/crop_voucher_${lowerType}_active.webp` : `assets/crop_voucher_${lowerType}_habis.webp`;
            }
        });
    }

    showModal(modalName) {
        if (this.modals[modalName]) {
            this.modals[modalName].classList.remove('hidden');
        }
    }

    hideModal(modalName) {
        if (this.modals[modalName]) {
            this.modals[modalName].classList.add('hidden');
        }
    }

    /*
     * A screen's background art is only fetched once its section un-hides, so the win/lose
     * artwork used to download *after* the switch -- one blank frame at game over. Warming
     * it during the 30s round removes that gap. Keep this list in sync with the
     * #screen-win / #screen-lose background-image rules in index.css.
     */
    preloadResultArt() {
        [
            'Fanta-Horor-Winner_full.webp',
            'coupon_out_winner_full.webp?v=20260731-clean',
            'voucher_out_winner_full.webp',
            'lose_psd_normal.webp?v=20260809-psd3',
            'lose_psd_voucher_out.webp?v=20260809-psd3'
        ].forEach(file => { new Image().src = 'assets/' + file; });

        // Mobile connections may not finish loading the final warning during its short
        // game-over hand-off, so warm every life banner during the round as well.
        Object.values(LIFE_NOTIF_ART).forEach(file => { new Image().src = file; });
    }

    startGame() {
        emitGameEvent('game_started', { entryMode: this.entryMode });

        this.health = 5;
        this.timer = 30;
        // A wave scheduled by a previous round must not fire into this one.
        clearTimeout(this.sessionTimeout);
        this.sessionPending = false;
        this.clearAllSlots();
        this.hideLifeNotif();
        this.updateHealthUI();
        this.updateTimerUI();

        this.switchScreen('PLAYING');
        this.preloadResultArt();

        // Start countdown loop
        this.timerInterval = setInterval(() => {
            this.timer--;
            this.updateTimerUI();

            if (this.timer === 5) {
                window.soundManager.playSfx('heartbeat');
            }

            if (this.timer <= 0) {
                this.endGame(true);
            }
        }, 1000);

        // Start spawner loop
        // Waves, not a drip feed: a new one only forms once the board has room again,
        // so clearing bottles is what drives the pace rather than a fixed timer.
        this.spawnSession();
        this.spawnerInterval = setInterval(() => {
            if (this.gameState !== 'PLAYING') return;
            // Runs regardless of whether a wave is due -- a board too full to spawn a
            // wave is exactly the case that used to leave the player with nothing to do.
            this.ensureThreat();

            if (this.sessionPending) return;
            const free = this.slots.filter(s => s.status === 'empty').length;
            if (free < SESSION_SIZE) return;

            this.sessionPending = true;
            this.sessionTimeout = setTimeout(() => {
                this.sessionPending = false;
                if (this.gameState === 'PLAYING') this.spawnSession();
            }, SESSION_GAP_MS);
        }, 250);

        // Ambient ghost cue, not a per-hand jump-scare: brief asked for it "taken out"
        // of every hand spawn and moved to a background loop so it plays less often.
        this.ambientInterval = setInterval(() => {
            if (this.gameState === 'PLAYING') window.soundManager.playSfx('handAppears');
        }, 7000);

    }

    clearAllSlots() {
        this.slots.forEach(slot => {
            // Null the handles too, not just cancel them: a stale id left behind still
            // reads as "this bottle has Suzzanna's hand coming" to anything inspecting it.
            clearTimeout(slot.attackTimeout);
            clearTimeout(slot.stealTimeout);
            clearTimeout(slot.timeoutId);
            slot.attackTimeout = null;
            slot.stealTimeout = null;
            slot.timeoutId = null;
            slot.status = 'empty';
            slot.tapsLeft = 0;
            slot.flavor = null;
            if (slot.el) {
                slot.el.className = 'grave-slot';
            }
        });
    }

    setSlotClass(slot, ...stateClasses) {
        const flavorClass = slot.flavor ? `flavor-${slot.flavor}` : '';
        slot.el.className = ['grave-slot', flavorClass, ...stateClasses]
            .filter(Boolean)
            .join(' ');
    }

    updateHealthUI() {
        if (!this.ui.healthContainer) return;
        this.ui.healthContainer.innerHTML = '';
        for (let i = 0; i < this.maxHealth; i++) {
            const bottleIcon = document.createElement('div');
            bottleIcon.className = `health-bottle ${i < this.health ? 'full' : 'empty'}`;
            this.ui.healthContainer.appendChild(bottleIcon);
        }
    }

    /*
     * Warning banner for the last three lives. Keyed off the life count rather than a
     * "lost a life" event so it cannot fire twice for the same threshold, and so a
     * banner is never shown for a count the player never actually sat on.
     */
    showLifeNotif(lives) {
        const art = LIFE_NOTIF_ART[lives];
        if (!art) return;

        const box = this.ui.lifeNotif;
        if (!box) return;

        clearTimeout(this.lifeNotifTimeout);
        box.querySelector('img').src = art;
        box.classList.toggle('life-empty', lives === 0);
        box.classList.remove('hidden');
        // Reflow between the two class writes so a banner that is already up replays its
        // pop instead of sitting still. A rAF would read better but never fires while the
        // tab is hidden, which would leave the banner stuck invisible.
        box.classList.remove('showing');
        void box.offsetWidth;
        box.classList.add('showing');

        // The final banner rides out the game-over switch instead of self-hiding.
        if (lives === 0) return;

        this.lifeNotifTimeout = setTimeout(() => {
            box.classList.remove('showing');
            this.lifeNotifTimeout = setTimeout(() => box.classList.add('hidden'), 250);
        }, LIFE_NOTIF_MS);
    }

    hideLifeNotif() {
        clearTimeout(this.lifeNotifTimeout);
        this.lifeNotifTimeout = null;
        if (!this.ui.lifeNotif) return;
        this.ui.lifeNotif.classList.remove('showing');
        this.ui.lifeNotif.classList.remove('life-empty');
        this.ui.lifeNotif.classList.add('hidden');
    }

    updateTimerUI() {
        if (this.ui.timerText) {
            this.ui.timerText.textContent = `${this.timer}s`;
            if (this.timer <= 7) {
                this.ui.timerText.classList.add('urgent');
            } else {
                this.ui.timerText.classList.remove('urgent');
            }
        }
    }

    /*
     * Bottles arrive in waves instead of a constant drip (brief: "buatkan seperti per sesi,
     * misalnya satu sesi keluarnya 5, hanya ada 1 tangan suzzanna yang keluar"). Each wave
     * puts SESSION_SIZE bottles on the board and only SESSION_THREATS of them are ever
     * grabbed; the rest simply wait to be tapped, which is what keeps the pace calm.
     */
    spawnSession() {
        const emptySlots = this.slots.filter(s => s.status === 'empty');
        if (emptySlots.length < SESSION_SIZE) return;

        // Fisher-Yates over a copy, so each wave lands on a different set of graves.
        for (let i = emptySlots.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [emptySlots[i], emptySlots[j]] = [emptySlots[j], emptySlots[i]];
        }

        const wave = emptySlots.slice(0, SESSION_SIZE);
        wave.forEach((slot, i) => this.spawnBottle(slot, i < SESSION_THREATS));
    }

    // `isThreat` is decided by the wave, not per bottle: only that one gets Suzzanna's hand.
    // Every other bottle just stands there until tapped, so the player still has to clear
    // the whole wave, but without being punished for the ones they reach last.
    spawnBottle(slot, isThreat = false) {
        clearTimeout(slot.attackTimeout);
        clearTimeout(slot.stealTimeout);
        slot.attackTimeout = null;
        slot.stealTimeout = null;

        slot.status = 'bottle';
        slot.flavor = BOTTLE_FLAVORS[Math.floor(Math.random() * BOTTLE_FLAVORS.length)];
        this.setSlotClass(slot, 'active-bottle', 'popping');
        window.soundManager.playSfx('rockCracks');

        if (!isThreat) return;

        this.armThreat(slot);
    }

    /*
     * Schedules Suzzanna's hand for one bottle. The handle is nulled as it fires so
     * `attackTimeout` only ever reads truthy while an attack is genuinely pending --
     * ensureThreat() relies on that to tell "armed" from "already spent".
     */
    armThreat(slot) {
        clearTimeout(slot.attackTimeout);
        slot.attackTimeout = setTimeout(() => {
            slot.attackTimeout = null;
            if (slot.status === 'bottle' && this.gameState === 'PLAYING') {
                this.transitionToSuzzannaAttack(slot);
            }
        }, ATTACK_DELAY_MS);
    }

    /*
     * Keeps the game from stalling. Threats used to be handed out only when a wave
     * spawned, and a wave needs SESSION_SIZE free graves -- so once enough untapped
     * bottles piled up, no wave could form, no hand could appear, and an idle player
     * ran the clock out untouched. The hand is now owned by the board rather than by
     * the wave: whenever no attack is live, any bottle already standing can be picked.
     */
    /*
     * Returns a slot to the pool. Cancelling a timer leaves its handle behind, and a
     * leftover handle still reads as "an attack is pending here" -- which would make
     * ensureThreat() skip arming a new one and stall the board all over again.
     */
    releaseSlot(slot) {
        clearTimeout(slot.attackTimeout);
        clearTimeout(slot.stealTimeout);
        clearTimeout(slot.timeoutId);
        slot.attackTimeout = null;
        slot.stealTimeout = null;
        slot.timeoutId = null;
        slot.status = 'empty';
        slot.tapsLeft = 0;
        slot.flavor = null;
        if (slot.el) slot.el.className = 'grave-slot';
    }

    ensureThreat() {
        if (this.gameState !== 'PLAYING') return;
        const threatLive = this.slots.some(s => s.status === 'suzzanna' || s.attackTimeout);
        if (threatLive) return;

        const candidates = this.slots.filter(s => s.status === 'bottle');
        if (!candidates.length) return;

        this.armThreat(candidates[Math.floor(Math.random() * candidates.length)]);
    }

    transitionToSuzzannaAttack(slot) {
        clearTimeout(slot.attackTimeout);
        slot.attackTimeout = null;
        slot.status = 'suzzanna';
        slot.tapsLeft = 3;
        this.setSlotClass(slot, 'active-suzzanna', 'popping');

        const tapBadge = slot.el.querySelector('.tap-counter-badge');
        if (tapBadge) {
            tapBadge.textContent = 'TAP 3X!';
        }

        // Gives player 3 seconds to tap Suzzanna's hand 3 times to shoo her away!
        slot.stealTimeout = setTimeout(() => {
            if (slot.status === 'suzzanna' && this.gameState === 'PLAYING') {
                this.handleSuzzannaSteal(slot);
            }
        }, 3000);
    }

    handleSlotTap(slot) {
        if (this.gameState !== 'PLAYING') return;

        if (slot.status === 'bottle') {
            // User saved the standard bottle before Suzzanna appeared!
            clearTimeout(slot.attackTimeout);
            slot.attackTimeout = null;
            slot.status = 'saved';
            this.setSlotClass(slot, 'saved');
            window.soundManager.playSfx('tapBottlePlain');

            setTimeout(() => this.releaseSlot(slot), 350);

        } else if (slot.status === 'suzzanna') {
            // User is multi-tapping Suzzanna's hand to shoo her away!
            slot.tapsLeft--;
            window.soundManager.playSfx('punch'); window.soundManager.playSfx('punchHurt');

            const tapBadge = slot.el.querySelector('.tap-counter-badge');
            if (tapBadge) {
                tapBadge.textContent = slot.tapsLeft > 0 ? `TAP ${slot.tapsLeft}X!` : `FANTA AMAN!`;
                tapBadge.classList.add('hit-shake');
                setTimeout(() => tapBadge.classList.remove('hit-shake'), 150);
            }

            if (slot.tapsLeft <= 0) {
                // Successfully shooed Suzzanna away!
                clearTimeout(slot.stealTimeout);
                slot.stealTimeout = null;
                slot.status = 'saved';
                // Keep active-suzzanna a beat longer so "FANTA AMAN!" -- which only
                // paints while that class is on -- has time to read before the bottle
                // rescue animation (tied to suzzanna-defeated) takes over.
                this.setSlotClass(slot, 'active-suzzanna', 'suzzanna-defeated');
                window.soundManager.playSfx('suzzannaReaction');

                setTimeout(() => {
                    this.setSlotClass(slot, 'suzzanna-defeated');
                    this.releaseSlot(slot);
                }, 500);
            }
        }
    }

    handleSuzzannaSteal(slot) {
        // The grab and the drag are one motion: the grip composite cross-fades in over the
        // loose bottle as it is pulled under, so the bottle freezes on the way down rather
        // than sitting frozen in place first.
        slot.stealTimeout = null;   // this runs from that timer; the handle is spent
        slot.status = 'frozen';
        this.setSlotClass(slot, 'stolen', 'freezing');
        window.soundManager.playSfx('steal'); window.soundManager.playSfx('stealGiggle');

        this.health = Math.max(0, this.health - 1);
        this.updateHealthUI();
        this.showLifeNotif(this.health);

        slot.timeoutId = setTimeout(() => {
            if (this.health <= 0) {
                this.endGame(false);
                return;
            }

            this.releaseSlot(slot);
        }, 720);
    }

    endGame(isWin) {
        clearInterval(this.timerInterval);
        // The "nyawa habis" banner is left on screen for the hand-off, then cleared
        // as the result screen takes over so a replay never starts with it showing.
        clearTimeout(this.lifeNotifTimeout);
        clearInterval(this.spawnerInterval);
        clearInterval(this.ambientInterval);
        clearTimeout(this.sessionTimeout);
        this.sessionPending = false;
        this.clearAllSlots();

        setTimeout(() => {
            this.hideLifeNotif();
            if (isWin && this.health > 0) {
                emitGameEvent('game_completed', {
                    livesLeft: this.health,
                    selectedVoucher: this.selectedVoucher
                });
                this.switchScreen('WIN');
            } else {
                this.switchScreen('LOSE');
            }
        }, 500);
    }
}

window.fantaGame = new FantaHorrorGame();
