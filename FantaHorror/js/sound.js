/**
 * FANTA Horror Game - Sound Manager
 *
 * Clips come from the "Sound v.02" delivery (assets/Sound v.02/*.wav), transcoded to
 * mp3 in assets/sounds/ -- the raw wavs are up to 17 MB, far too heavy to stream.
 */

class SoundManager {
    constructor() {
        this.isMuted = false;
        this.isInitialized = false;

        const clip = file => new Audio('assets/sounds/' + file + '.mp3');

        this.sounds = {
            // Background: one track from the landing page through the round.
            // Deliberately NOT played on win/lose -- those screens get their own cue.
            bgm: clip('awesome_music_funny-halloween-monsters-skeletons-dance_main'),

            buttonClick: clip('Clicked Button Mystery'),
            tapBottlePlain: clip('pop-01'),
            heartbeat: clip('Heartbeat 2'),
            rockCracks: clip('Rocks_Cracks_Rock_Cracks_Series_SDGWATT_53937'),
            handAppears: clip('18677 spooky cartoon ghost-full'),

            // Suzzanna gets the bottle: freeze + her giggle, layered.
            steal: clip('Ice'),
            stealGiggle: clip('Female Giggle 1 1'),

            // Punching her hand: impact + her hurt vocal, layered.
            punch: clip('slap punch'),
            punchHurt: clip('female voice hurt (edit 3)'),

            /* TODO(sound): the brief's "after tap 3x" cue, 65 HUMAN-SCREAM_GEN-HDF-15265.wav,
               was not in the Sound v.02 folder. Still the previous delivery's clip. */
            suzzannaReaction: clip('Reaksi Suzzana'),

            // Result screens: each is two clips back to back (see playSequence).
            loseA: clip('sad-trombone'),
            loseB: clip('Witch Evil Cackle Laugh Voice'),
            winA: clip('Scary Fun Halloween Ending'),
            winB: clip('Female Mixed Age Crying Long Whine Cough Multiple')
        };

        // Nothing is fetched on page load -- otherwise every track downloads
        // before the landing page can paint. init() warms them on first tap.
        for (let key in this.sounds) {
            this.sounds[key].preload = 'none';
        }

        this.sounds.bgm.loop = true;
        this.sounds.bgm.volume = 0.4;

        this.sounds.buttonClick.volume = 0.6;
        this.sounds.tapBottlePlain.volume = 0.7;
        this.sounds.heartbeat.volume = 0.85;
        this.sounds.rockCracks.volume = 0.6;
        this.sounds.handAppears.volume = 0.7;
        this.sounds.steal.volume = 0.8;
        this.sounds.stealGiggle.volume = 0.7;
        this.sounds.punch.volume = 0.7;
        this.sounds.punchHurt.volume = 0.7;
        this.sounds.suzzannaReaction.volume = 0.7;
        this.sounds.loseA.volume = 0.8;
        this.sounds.loseB.volume = 0.8;
        this.sounds.winA.volume = 0.8;
        this.sounds.winB.volume = 0.8;

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

        // Brief: one continuous track from the landing page into the round. Screen
        // switches must not restart it -- only stopBgm (win/lose) ends it.
        if (this.currentBgm === this.sounds[key] && !this.currentBgm.paused) return;

        if (this.currentBgm) {
            this.currentBgm.pause();
            this.currentBgm.currentTime = 0;
        }

        if (this.sounds[key]) {
            this.currentBgm = this.sounds[key];
            // Brief: the halloween track starts at 0:10.
            // Seeking is a no-op until metadata lands, so defer when it hasn't.
            const track = this.currentBgm;
            const offset = key === 'bgm' ? 10 : 0;
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
        // Long in-game clips (rockCracks runs 11s) otherwise bleed into the result screen
        // and fight its cue. Ending the round silences the arena outright.
        ['heartbeat', 'rockCracks', 'handAppears', 'steal', 'stealGiggle'].forEach(k => this.stopSfx(k));
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

    /*
     * Win/lose cue: two clips back to back. Both first clips trail off into near-silence,
     * so waiting for 'ended' left an audible dead gap -- the hand-off happens at
     * cutoffSec instead, and the first clip is faded out rather than cut hard.
     */
    playSequence(firstKey, secondKey, cutoffSec) {
        const first = this.sounds[firstKey];
        if (!first) return;

        clearTimeout(this.sequenceTimeout);
        clearInterval(this.fadeInterval);
        const fullVolume = first.volume;
        this.playSfx(firstKey);

        this.sequenceTimeout = setTimeout(() => {
            this.playSfx(secondKey);
            this.fadeInterval = setInterval(() => {
                first.volume = Math.max(0, first.volume - fullVolume / 8);
                if (first.volume === 0) {
                    clearInterval(this.fadeInterval);
                    first.pause();
                    first.currentTime = 0;
                    first.volume = fullVolume;
                }
            }, 50);
        }, cutoffSec * 1000);
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
