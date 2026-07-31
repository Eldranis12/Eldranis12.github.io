/**
 * FANTA Horror Game - Sound Manager
 * Handles background ambiance, stingers, and gameplay sound effects
 */

class SoundManager {
    constructor() {
        this.isMuted = false;
        this.isInitialized = false;

        this.sounds = {
            darkAmbiance: new Audio('assets/sounds/Dark Ambiance.mp3'),
            nightAmbience: new Audio('assets/sounds/Night Ambience.mp3'),
            horrorStinger: new Audio('assets/sounds/LDj_Audio - Horror Stinger (Wav).mp3'),
            rockCracks: new Audio('assets/sounds/Rocks_Cracks_Rock_Cracks_Series_SDGWATT_53937.mp3'),
            punch: new Audio('assets/sounds/Fights_Punches_Beefy_Punch_SDCOLLA_50830.mp3'),
            witchLaugh: new Audio('assets/sounds/Witch Laugh 1.mp3'),
            iceFreeze: new Audio('assets/sounds/Ice.mp3'),
            femaleScream: new Audio('assets/sounds/Female Scream 1.mp3'),
            gameOver: new Audio('assets/sounds/30974 Magic midnight game over-full.mp3'),
            winPiano: new Audio('assets/sounds/dark tragic piano.mp3'),
            countdownClock: new Audio('assets/sounds/Rising Creepy Horror Countdown Clock.mp3'),
            buttonClick: new Audio('assets/sounds/Clicked Button Mystery.mp3')
        };

        // Nothing is fetched on page load -- otherwise every track downloads
        // before the landing page can paint. init() warms them on first tap.
        for (let key in this.sounds) {
            this.sounds[key].preload = 'none';
        }

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
            // First tap is our cue to actually fetch the clips, so an SFX that
            // fires mid-game is already buffered rather than starting cold.
            for (let key in this.sounds) {
                this.sounds[key].preload = 'auto';
                this.sounds[key].load();
            }
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
            // Brief: Dark Ambiance track skips its first 5 seconds.
            // Seeking is a no-op until metadata lands, so defer when it hasn't.
            const track = this.currentBgm;
            const offset = key === 'darkAmbiance' ? 5 : 0;
            if (track.readyState >= 1) {
                track.currentTime = offset;
            } else if (offset) {
                track.addEventListener('loadedmetadata', () => {
                    track.currentTime = offset;
                }, { once: true });
            }
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
