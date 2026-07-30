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
const CHANNEL = 1;

const CHANNELS = [
    {   // 0 - Testing
        domain: 'https://stage.grivy.app',
        cinemaMain: 'fanta-horror-testing-main-cinema',
        fantaMain: 'fanta-horror-testing-main-voucher',
        childCampaigns: {
            cinema: [],
            fanta: []
        }
    },
    {   // 1 - Real Campaign
        domain: 'https://fun.fanta.id',
        cinemaMain: 'fanta-horror-196',
        fantaMain: 'fanta-horror-564',
        childCampaigns: {
            cinema: [],
            fanta: []
        }
    }
];

/*
 * Grivy may inject the real child campaign public codes before game.js loads:
 *
 * window.FANTA_HORROR_CONFIG = {
 *   childCampaigns: {
 *     cinema: [
 *       { name: 'CGV', code: 'public-code' },
 *       { name: 'Cinepolis', code: 'public-code' },
 *       { name: 'XXI', code: 'public-code' },
 *       { name: 'Platinum', code: 'public-code' }
 *     ],
 *     fanta: [
 *       { name: 'Alfamart', code: 'public-code' },
 *       { name: 'Indomaret', code: 'public-code' }
 *     ]
 *   },
 *   appOrigin: 'https://grivy.app'
 * };
 */
const RUNTIME_CONFIG = window.FANTA_HORROR_CONFIG || {};
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

function triggerGrivyAction(action, campaignCode) {
    const payload = {
        source: 'fanta-horror-game',
        type: GRIVY_ACTIONS[action],
        action,
        campaignCode
    };

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

// Difficulty tuning: share of bottles Suzzanna never grabs (they just sit there
// until tapped). Raise the chance to make the game more forgiving.
const SAFE_BOTTLE_CHANCE = 0.25;
const BOTTLE_FLAVORS = ['orange', 'strawberry', 'fruit-punch', 'grape'];

class FantaHorrorGame {
    constructor() {
        this.gameState = 'LP'; // 'LP', 'VOUCHER_SELECT', 'PLAYING', 'WIN', 'LOSE'
        this.entryMode = 'GAME'; // 'GAME', 'CLAIM_WINNER_VOUCHER'
        this.timer = 30;
        this.timerInterval = null;
        this.spawnerInterval = null;
        this.stingerInterval = null;
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
                quotaToggleBtn: document.getElementById('quota-toggle-btn'),
                audioToggleBtn: document.getElementById('audio-toggle-btn'),
                selectedVoucherWin: document.getElementById('selected-voucher-win-text'),
                selectedVoucherLose: document.getElementById('selected-voucher-lose-text')
            };

            this.bindEvents();
            this.renderGraveGrid();
            this.switchScreen('LP');
            this.checkCouponQuota();
        });
    }

    /*
     * Grivy "campaigns-check-active" API. Availability for each main page is aggregated
     * from its child campaigns. A main page stays available when at least one child is
     * active and still has coupons. Until child public codes are injected, this falls
     * back to the main campaign code so existing environments remain testable.
     */
    async checkCouponQuota() {
        const params = new URLSearchParams(window.location.search);
        const couponPreview = params.get('coupon');

        // QA previews are deterministic and must not wait for the remote API.
        if (couponPreview === 'out') {
            this.cinemaAvailable = false;
            this.fantaAvailable = false;
        } else if (couponPreview === 'active') {
            this.cinemaAvailable = true;
            this.fantaAvailable = true;
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

            const res = await fetch(`${GRIVY.domain}/api/games/campaigns-check-active`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: requestController.signal,
                body: JSON.stringify({
                    campaign_public_codes: campaignCodes
                })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            if (!Array.isArray(data)) throw new Error('unexpected response shape');

            const available = code => {
                const c = data.find(item => item && item.public_code === code);
                return !!(c && c.campaign_active && !c.coupons_finished);
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
            } catch (err) {
                console.warn('Coupon quota check failed, keeping CTAs visible:', err);
            } finally {
                clearTimeout(requestTimeout);
            }
        }

        this.applyQuotaUI();

        const screenPreview = params.get('screen');
        if (screenPreview === 'win') this.switchScreen('WIN');
        if (screenPreview === 'lose') this.switchScreen('LOSE');

        document.getElementById('app-container')?.classList.remove('quota-loading');
    }

    // Re-applies coupon-dependent CTA visibility to whichever screen is showing.
    applyQuotaUI() {
        const lpScreen = document.getElementById('screen-lp');
        const winScreen = document.getElementById('screen-win');
        const loseScreen = document.getElementById('screen-lose');

        lpScreen?.classList.toggle('coupon-out', !this.cinemaAvailable);
        winScreen?.classList.toggle('coupon-out', !this.fantaAvailable);
        loseScreen?.classList.toggle('coupon-out', !this.fantaAvailable);

        document.getElementById('btn-upload-struk')?.classList.toggle('hidden', !this.cinemaAvailable);
        document.querySelector('.btn-ambil-voucher-win')?.classList.toggle('hidden', !this.fantaAvailable);
        document.querySelector('.btn-ambil-voucher-lose')?.classList.toggle('hidden', !this.fantaAvailable);
    }

    bindEvents() {
        // Sound toggle
        this.ui.audioToggleBtn?.addEventListener('click', () => {
            const isMuted = window.soundManager.toggleMute();
            this.ui.audioToggleBtn.classList.toggle('muted', isMuted);
            this.ui.audioToggleBtn.setAttribute('aria-label', isMuted ? 'Unmute Audio' : 'Mute Audio');
        });

        // Quota toggle for testing: simulates the "Kupon Habis" state without touching the API
        this.ui.quotaToggleBtn?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            this.cinemaAvailable = !this.cinemaAvailable;
            this.fantaAvailable = !this.fantaAvailable;
            this.applyQuotaUI();
        });

        // LP Button 1: "MAIN GAME" (Starts 30s Game directly as shown in Slide 3!)
        document.getElementById('btn-main-game')?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            this.entryMode = 'GAME';
            this.startGame();
        });

        // LP Button 2: "UPLOAD STRUK & AMBIL VOUCHERNYA" -> Grivy cinema-voucher campaign page
        document.getElementById('btn-upload-struk')?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            triggerGrivyAction('getVoucher', GRIVY.cinemaMain);
        });

        // LP Bottom Link: "CARA BERMAIN"
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
                if (navigator.share) {
                    navigator.share({
                        title: 'FANTA Horror Game',
                        text: 'Aku baru saja menyelamatkan stok FANTA dari gentayangan Suzzanna! Cobain gamenya yuk!',
                        url: window.location.href
                    }).catch(() => {});
                } else {
                    alert('Salin Link Game: ' + window.location.href);
                }
            });
        });

        // Win & Lose Screens: "YAKALI GAK MAU FANTA" -> Grivy Fanta-voucher campaign page.
        // Hidden entirely when that campaign's coupons are finished (brief "Kupon Habis").
        document.querySelectorAll('.btn-ambil-voucher').forEach(btn => {
            btn.addEventListener('click', () => {
                window.soundManager.playSfx('buttonClick');
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
        Object.keys(this.screens).forEach(key => {
            if (this.screens[key]) {
                this.screens[key].classList.add('hidden');
            }
        });

        if (screenName === 'LP') {
            this.screens.lp?.classList.remove('hidden');
            window.soundManager.playBgm('darkAmbiance');
        } else if (screenName === 'VOUCHER_SELECT') {
            this.updateVoucherUI();
            this.screens.voucherSelect?.classList.remove('hidden');
            window.soundManager.playBgm('darkAmbiance');
        } else if (screenName === 'PLAYING') {
            this.screens.game?.classList.remove('hidden');
            window.soundManager.playBgm('nightAmbience');
        } else if (screenName === 'WIN') {
            this.screens.win?.classList.remove('hidden');
            if (this.ui.selectedVoucherWin) {
                this.ui.selectedVoucherWin.textContent = `EMANG PALING GERCEP, FANTA AMAN!`;
            }
            this.applyQuotaUI();
            window.soundManager.stopBgm();
            window.soundManager.playSfx('winPiano');
        } else if (screenName === 'LOSE') {
            this.screens.lose?.classList.remove('hidden');
            if (this.ui.selectedVoucherLose) {
                this.ui.selectedVoucherLose.textContent = `HAUSSSS..... YAH FANTANYA UDAH HABIS!!!`;
            }
            this.applyQuotaUI();
            window.soundManager.stopBgm();
            window.soundManager.playSfx('gameOver');
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
                imgEl.src = isAvailable ? `assets/crop_voucher_${lowerType}_active.png` : `assets/crop_voucher_${lowerType}_habis.png`;
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

    startGame() {
        this.health = 5;
        this.timer = 30;
        this.clearAllSlots();
        this.updateHealthUI();
        this.updateTimerUI();

        this.switchScreen('PLAYING');

        // Start countdown loop
        this.timerInterval = setInterval(() => {
            this.timer--;
            this.updateTimerUI();

            if (this.timer === 7) {
                window.soundManager.playSfx('countdownClock');
            }

            if (this.timer <= 0) {
                this.endGame(true);
            }
        }, 1000);

        // Start spawner loop
        this.spawnerInterval = setInterval(() => {
            if (this.gameState === 'PLAYING') {
                this.spawnRandomTargets();
            }
        }, 900);

        // Ambient horror stinger overlay
        this.stingerInterval = setInterval(() => {
            if (this.gameState === 'PLAYING' && Math.random() < 0.4) {
                window.soundManager.playSfx('horrorStinger');
            }
        }, 6000);
    }

    clearAllSlots() {
        this.slots.forEach(slot => {
            if (slot.attackTimeout) clearTimeout(slot.attackTimeout);
            if (slot.stealTimeout) clearTimeout(slot.stealTimeout);
            if (slot.timeoutId) clearTimeout(slot.timeoutId);
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

    spawnRandomTargets() {
        const emptySlots = this.slots.filter(s => s.status === 'empty');
        if (emptySlots.length === 0) return;

        // Randomly spawn 1 to 4 bottles at once (bisa langsung 3 atau 4)
        const maxSpawn = Math.min(emptySlots.length, 4);
        const spawnCount = Math.floor(Math.random() * maxSpawn) + 1;
        
        for (let i = 0; i < spawnCount; i++) {
            const randomIndex = Math.floor(Math.random() * emptySlots.length);
            const slot = emptySlots.splice(randomIndex, 1)[0];
            this.spawnBottle(slot);
        }
    }

    spawnBottle(slot) {
        if (slot.attackTimeout) clearTimeout(slot.attackTimeout);
        if (slot.stealTimeout) clearTimeout(slot.stealTimeout);

        slot.status = 'bottle';
        slot.flavor = BOTTLE_FLAVORS[Math.floor(Math.random() * BOTTLE_FLAVORS.length)];
        this.setSlotClass(slot, 'active-bottle', 'popping');
        window.soundManager.playSfx('rockCracks');

        // A share of bottles are "safe": Suzzanna never grabs them, so missing one costs
        // nothing. No attack timeout is scheduled at all, so it just sits there (tappable,
        // occupying its slot) until the player gets to it -- easier, not disappearing.
        // Looks identical to a normal bottle, so the player still reacts to everything.
        if (Math.random() < SAFE_BOTTLE_CHANCE) {
            return;
        }

        // If bottle is not tapped after 1 second, Suzzanna's hand appears to try to grab it!
        slot.attackTimeout = setTimeout(() => {
            if (slot.status === 'bottle' && this.gameState === 'PLAYING') {
                this.transitionToSuzzannaAttack(slot);
            }
        }, 1000);
    }

    transitionToSuzzannaAttack(slot) {
        slot.status = 'suzzanna';
        slot.tapsLeft = 3;
        this.setSlotClass(slot, 'active-suzzanna', 'popping');

        const tapBadge = slot.el.querySelector('.tap-counter-badge');
        if (tapBadge) {
            tapBadge.textContent = 'TAP 3X!';
        }
        
        window.soundManager.playSfx('witchLaugh');

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
            if (slot.attackTimeout) clearTimeout(slot.attackTimeout);
            slot.status = 'saved';
            this.setSlotClass(slot, 'saved');
            window.soundManager.playSfx('punch');

            setTimeout(() => {
                slot.status = 'empty';
                slot.flavor = null;
                slot.el.className = 'grave-slot';
            }, 350);

        } else if (slot.status === 'suzzanna') {
            // User is multi-tapping Suzzanna's hand to shoo her away!
            slot.tapsLeft--;
            window.soundManager.playSfx('punch');

            const tapBadge = slot.el.querySelector('.tap-counter-badge');
            if (tapBadge) {
                tapBadge.textContent = slot.tapsLeft > 0 ? `TAP ${slot.tapsLeft}X!` : `DEFENDED!`;
                tapBadge.classList.add('hit-shake');
                setTimeout(() => tapBadge.classList.remove('hit-shake'), 150);
            }

            if (slot.tapsLeft <= 0) {
                // Successfully shooed Suzzanna away!
                if (slot.stealTimeout) clearTimeout(slot.stealTimeout);
                slot.status = 'saved';
                this.setSlotClass(slot, 'suzzanna-defeated');
                window.soundManager.playSfx('femaleScream');

                setTimeout(() => {
                    slot.status = 'empty';
                    slot.flavor = null;
                    slot.el.className = 'grave-slot';
                }, 450);
            }
        }
    }

    handleSuzzannaSteal(slot) {
        // The grab and the drag are one motion: the grip composite cross-fades in over the
        // loose bottle as it is pulled under, so the bottle freezes on the way down rather
        // than sitting frozen in place first.
        slot.status = 'frozen';
        this.setSlotClass(slot, 'stolen', 'freezing');
        window.soundManager.playSfx('iceFreeze');

        this.health = Math.max(0, this.health - 1);
        this.updateHealthUI();

        slot.timeoutId = setTimeout(() => {
            if (this.health <= 0) {
                this.endGame(false);
                return;
            }

            slot.status = 'empty';
            slot.flavor = null;
            slot.el.className = 'grave-slot';
        }, 720);
    }

    endGame(isWin) {
        clearInterval(this.timerInterval);
        clearInterval(this.spawnerInterval);
        clearInterval(this.stingerInterval);
        this.clearAllSlots();

        setTimeout(() => {
            if (isWin && this.health > 0) {
                this.switchScreen('WIN');
            } else {
                this.switchScreen('LOSE');
            }
        }, 500);
    }
}

window.fantaGame = new FantaHorrorGame();
