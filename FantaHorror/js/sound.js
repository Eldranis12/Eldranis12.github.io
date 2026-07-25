/**
 * FANTA Horror Game - Sound Manager
 * Handles background ambiance, stingers, and gameplay sound effects
 */

class SoundManager {
    constructor() {
        this.isMuted = false;
        this.isInitialized = false;

        this.sounds = {
            darkAmbiance: new Audio('assets/sounds/Dark Ambiance.wav'),
            nightAmbience: new Audio('assets/sounds/Night Ambience.wav'),
            horrorStinger: new Audio('assets/sounds/LDj_Audio - Horror Stinger (Wav).wav'),
            rockCracks: new Audio('assets/sounds/Rocks_Cracks_Rock_Cracks_Series_SDGWATT_53937.wav'),
            punch: new Audio('assets/sounds/Fights_Punches_Beefy_Punch_SDCOLLA_50830.wav'),
            witchLaugh: new Audio('assets/sounds/Witch Laugh 1.wav'),
            iceFreeze: new Audio('assets/sounds/Ice.wav'),
            femaleScream: new Audio('assets/sounds/Female Scream 1.wav'),
            gameOver: new Audio('assets/sounds/30974 Magic midnight game over-full.wav'),
            winPiano: new Audio('assets/sounds/dark tragic piano.wav'),
            countdownClock: new Audio('assets/sounds/Rising Creepy Horror Countdown Clock.wav'),
            buttonClick: new Audio('assets/sounds/Clicked Button Mystery.wav')
        };

        // Configure loops & volumes
        this.sounds.darkAmbiance.loop = true;
        this.sounds.darkAmbiance.volume = 0.45;

        this.sounds.nightAmbience.loop = true;
        this.sounds.nightAmbience.volume = 0.35;

        this.sounds.horrorStinger.volume = 0.5;
        this.sounds.rockCracks.volume = 0.6;
        this.sounds.punch.volume = 0.7;
        this.sounds.witchLaugh.volume = 0.7;
        this.sounds.iceFreeze.volume = 0.8;
        this.sounds.femaleScream.volume = 0.7;
        this.sounds.gameOver.volume = 0.8;
        this.sounds.winPiano.volume = 0.8;
        this.sounds.countdownClock.volume = 0.85;
        this.sounds.buttonClick.volume = 0.6;

        this.currentBgm = null;
    }

    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        const enableAudio = () => {
            if (this.currentBgm) {
                this.currentBgm.play().catch(() => {});
            }
            document.removeEventListener('click', enableAudio);
            document.removeEventListener('touchstart', enableAudio);
        };

        document.addEventListener('click', enableAudio);
        document.addEventListener('touchstart', enableAudio);
    }

    playBgm(key) {
        if (this.isMuted) return;
        
        if (this.currentBgm) {
            this.currentBgm.pause();
            this.currentBgm.currentTime = 0;
        }

        if (this.sounds[key]) {
            this.currentBgm = this.sounds[key];
            this.currentBgm.currentTime = 0;
            this.currentBgm.play().catch(e => {
                console.log('BGM playback pending user interaction:', e);
            });
        }
    }

    stopBgm() {
        if (this.currentBgm) {
            this.currentBgm.pause();
            this.currentBgm.currentTime = 0;
            this.currentBgm = null;
        }
        this.stopSfx('countdownClock');
    }

    playSfx(key, restart = true) {
        if (this.isMuted) return;
        const sound = this.sounds[key];
        if (sound) {
            try {
                if (restart) {
                    sound.currentTime = 0;
                }
                sound.play().catch(e => console.log('SFX play error:', e));
            } catch (err) {
                console.error(err);
            }
        }
    }

    stopSfx(key) {
        const sound = this.sounds[key];
        if (sound) {
            sound.pause();
            sound.currentTime = 0;
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        for (let key in this.sounds) {
            this.sounds[key].muted = this.isMuted;
        }
        return this.isMuted;
    }
}

window.soundManager = new SoundManager();
