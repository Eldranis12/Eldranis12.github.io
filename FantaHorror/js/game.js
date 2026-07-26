/**
 * FANTA Horror Game Engine
 * Manages game loop, 3x3 grave slots, spawning logic, Suzzanna multi-tap defense, and UI states.
 * Updated to remove rectangular ice overlay box and apply frozen effect directly to targets.
 */

class FantaHorrorGame {
    constructor() {
        this.gameState = 'LP'; // 'LP', 'VOUCHER_SELECT', 'PLAYING', 'WIN', 'LOSE'
        this.entryMode = 'GAME'; // 'GAME', 'UPLOAD_RECEIPT', 'CLAIM_WINNER_VOUCHER'
        this.timer = 30;
        this.timerInterval = null;
        this.spawnerInterval = null;
        this.stingerInterval = null;
        this.health = 5;
        this.maxHealth = 5;
        this.selectedVoucher = null; // 'CGV', 'CINEPOLIS', 'XXI'
        
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
                caraBermain: document.getElementById('modal-cara-bermain'),
                uploadStruk: document.getElementById('modal-upload-struk')
            };

            this.ui = {
                timerText: document.getElementById('timer-display'),
                healthContainer: document.getElementById('health-bar'),
                gravesGrid: document.getElementById('graves-grid'),
                quotaToggleBtn: document.getElementById('quota-toggle-btn'),
                audioToggleBtn: document.getElementById('audio-toggle-btn'),
                selectedVoucherWin: document.getElementById('selected-voucher-win-text'),
                selectedVoucherLose: document.getElementById('selected-voucher-lose-text'),
                uploadVoucherTargetText: document.getElementById('upload-voucher-target-text')
            };

            this.bindEvents();
            this.renderGraveGrid();
            this.switchScreen('LP');
        });
    }

    bindEvents() {
        // Sound toggle
        this.ui.audioToggleBtn?.addEventListener('click', () => {
            const isMuted = window.soundManager.toggleMute();
            this.ui.audioToggleBtn.classList.toggle('muted', isMuted);
            this.ui.audioToggleBtn.setAttribute('aria-label', isMuted ? 'Unmute Audio' : 'Mute Audio');
        });

        // Quota toggle for testing (Toggles active vs quota out states)
        this.ui.quotaToggleBtn?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            this.voucherQuota.CGV = !this.voucherQuota.CGV;
            this.voucherQuota.CINEPOLIS = !this.voucherQuota.CINEPOLIS;
            this.voucherQuota.XXI = !this.voucherQuota.XXI;
            this.updateVoucherUI();
        });

        // LP Button 1: "MAIN GAME" (Starts 30s Game directly as shown in Slide 3!)
        document.getElementById('btn-main-game')?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            this.entryMode = 'GAME';
            this.startGame();
        });

        // LP Button 2: "UPLOAD STRUK DEMI VOUCHER" (Leads to Prize Options "PILIH VOUCHER DULU YUK" as shown in Slide 2!)
        document.getElementById('btn-upload-struk')?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            this.entryMode = 'UPLOAD_RECEIPT';
            this.switchScreen('VOUCHER_SELECT');
        });

        // LP Bottom Link: "CARA BERMAIN"
        document.getElementById('btn-cara-bermain')?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            this.showModal('caraBermain');
        });

        // Modal close buttons
        document.getElementById('btn-close-cara-bermain')?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            this.hideModal('caraBermain');
        });

        document.getElementById('btn-close-upload-struk')?.addEventListener('click', () => {
            window.soundManager.playSfx('buttonClick');
            this.hideModal('uploadStruk');
        });

        // Form Submission for Upload Receipt
        document.getElementById('form-upload-struk')?.addEventListener('submit', (e) => {
            e.preventDefault();
            window.soundManager.playSfx('buttonClick');
            const receiptAlert = document.getElementById('receipt-status-msg');
            if (receiptAlert) {
                receiptAlert.textContent = `Struk berhasil dikirim! Kupon Voucher ${this.selectedVoucher || 'FANTA'} kamu sedang diproses.`;
                receiptAlert.className = 'status-msg success';
            }
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

                if (this.entryMode === 'UPLOAD_RECEIPT') {
                    // Upload Receipt Flow: Open Receipt Upload Form for this specific voucher
                    if (this.ui.uploadVoucherTargetText) {
                        this.ui.uploadVoucherTargetText.textContent = `Target Voucher: ${voucherType}`;
                    }
                    this.showModal('uploadStruk');
                } else if (this.entryMode === 'CLAIM_WINNER_VOUCHER') {
                    // Winner Voucher Claim Flow
                    alert(`Selamat! Voucher ${this.selectedVoucher} berhasil diklaim untuk menonton bioskop pilihanmu!`);
                } else {
                    // Default Game Flow: Launch 30s Survival Game!
                    this.startGame();
                }
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

        // Winner Screen: "AMBIL VOUCHER DI SINI" -> Leads to Voucher Selection screen to choose prize!
        document.querySelectorAll('.btn-ambil-voucher-win').forEach(btn => {
            btn.addEventListener('click', () => {
                window.soundManager.playSfx('buttonClick');
                this.entryMode = 'CLAIM_WINNER_VOUCHER';
                this.switchScreen('VOUCHER_SELECT');
            });
        });

        // Lose Screen: "AMBIL VOUCHER DI SINI" -> Disabled / inactive as shown in Slide 3
        document.querySelectorAll('.btn-ambil-voucher-lose').forEach(btn => {
            btn.addEventListener('click', () => {
                window.soundManager.playSfx('buttonClick');
                alert('Fantamu habis diambil Suzzanna! Main lagi dan bertahan selama 30 detik untuk mendapatkan voucher.');
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

            targetContainer.appendChild(suzzannaEl);
            targetContainer.appendChild(bottleEl);
            targetContainer.appendChild(stolenEl);

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
            window.soundManager.stopBgm();
            window.soundManager.playSfx('winPiano');
        } else if (screenName === 'LOSE') {
            this.screens.lose?.classList.remove('hidden');
            if (this.ui.selectedVoucherLose) {
                this.ui.selectedVoucherLose.textContent = `HAUSSSS..... YAH FANTANYA UDAH HABIS!!!`;
            }
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
            if (slot.el) {
                slot.el.className = 'grave-slot';
            }
        });
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
        slot.el.className = 'grave-slot active-bottle popping';
        window.soundManager.playSfx('rockCracks');

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
        slot.el.className = 'grave-slot active-suzzanna popping';
        
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
            slot.el.className = 'grave-slot saved';
            window.soundManager.playSfx('punch');

            setTimeout(() => {
                slot.status = 'empty';
                slot.el.className = 'grave-slot';
            }, 350);

        } else if (slot.status === 'suzzanna') {
            // User is multi-tapping Suzzanna's hand to shoo her away!
            slot.tapsLeft--;
            window.soundManager.playSfx('punch');

            if (slot.tapsLeft <= 0) {
                // Successfully shooed Suzzanna away!
                if (slot.stealTimeout) clearTimeout(slot.stealTimeout);
                slot.status = 'saved';
                slot.el.className = 'grave-slot suzzanna-defeated';
                window.soundManager.playSfx('femaleScream');

                setTimeout(() => {
                    slot.status = 'empty';
                    slot.el.className = 'grave-slot';
                }, 450);
            }
        }
    }

    handleSuzzannaSteal(slot) {
        slot.status = 'frozen';
        slot.el.className = 'grave-slot suzzanna-stolen freezing';
        window.soundManager.playSfx('iceFreeze');

        this.health = Math.max(0, this.health - 1);
        this.updateHealthUI();

        setTimeout(() => {
            slot.status = 'empty';
            slot.el.className = 'grave-slot';
        }, 600);

        if (this.health <= 0) {
            this.endGame(false);
        }
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
