// ============================================================
// Sound effects (brief "Sound" + folder Audio/):
//   start       — tombol Mulai            (mulai.wav)
//   move        — geser kiri/kanan        (button kiri kanan.wav)
//   rotate      — putar balok             (button rotate.wav)
//   clear       — hapus baris             (saat line clear.wav)
//   landNormal  — mendarat normal         (saat mendarat normal.wav)
//   landFast    — mendarat turun cepat    (saat mendarat cepat.wav)
//   landHard    — mendarat jatuh langsung (saat mendarat sangat cepat.wav)
// ============================================================

const FILES = {
  start: 'assets/audio/start.wav',
  move: 'assets/audio/move.wav',
  rotate: 'assets/audio/rotate.wav',
  clear: 'assets/audio/clear.wav',
  landNormal: 'assets/audio/land-normal.wav',
  landFast: 'assets/audio/land-fast.wav',
  landHard: 'assets/audio/land-hard.wav',
};

const AC = window.AudioContext || window.webkitAudioContext;
const actx = AC ? new AC() : null;
const buffers = {};

if (actx) {
  for (const [name, src] of Object.entries(FILES)) {
    fetch(src)
      .then(r => r.arrayBuffer())
      .then(b => actx.decodeAudioData(b))
      .then(d => { buffers[name] = d; })
      .catch(() => console.warn('gagal load audio', src));
  }
  // browser mobile menahan audio sampai ada gesture pertama
  const unlock = () => { if (actx.state === 'suspended') actx.resume(); };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);
}

export function playSfx(name) {
  if (!actx || !buffers[name]) return;
  if (actx.state === 'suspended') actx.resume();
  const s = actx.createBufferSource();
  s.buffer = buffers[name];
  s.connect(actx.destination);
  s.start();
}
