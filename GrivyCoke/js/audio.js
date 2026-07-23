// ============================================================
// Sound effects (brief "Sound" + folder Audio/):
//   start       — tombol Mulai            (mulai.wav)
//   move        — geser kiri/kanan        (button kiri kanan.wav)
//   rotate      — putar balok             (button rotate.wav)
//   clear       — hapus baris             (saat line clear.wav)
//   landNormal  — mendarat normal         (saat mendarat normal.wav)
//   landFast    — mendarat turun cepat    (saat mendarat cepat.wav)
//   landHard    — mendarat jatuh langsung (saat mendarat sangat cepat.wav)
//   success     — game selesai + confetti (Big Band Celebration.wav)
//
// feedback 13 Jul: sound utk tiap kata popup (mantap/keren/gokil/sempurna/
// perfect) + clock tick 10 detik terakhir — file "sound menyusul", belum
// ada di assets/audio/. playSfx() no-op kalau file belum ada (fetch gagal
// -> buffers[name] tetap undefined), jadi aman ditambah sekarang; tinggal
// taruh file-nya di path di bawah begitu tersedia.
// ============================================================

const FILES = {
  start: 'assets/audio/start.wav',
  move: 'assets/audio/move.wav',
  rotate: 'assets/audio/rotate.wav',
  clear: 'assets/audio/clear.wav',
  landNormal: 'assets/audio/land-normal.wav',
  landFast: 'assets/audio/land-fast.wav',
  landHard: 'assets/audio/land-hard.wav',
  success: 'assets/audio/success.wav',
  mantap: 'assets/audio/mantap.wav',
  keren: 'assets/audio/keren.wav',
  gokil: 'assets/audio/gokil.wav',
  sempurna: 'assets/audio/sempurna.wav',
  perfect: 'assets/audio/perfect.wav',
  tick: 'assets/audio/tick.wav',
};

const AC = window.AudioContext || window.webkitAudioContext;
const actx = AC ? new AC() : null;
const buffers = {};

// Master bus: gain (headroom) -> limiter (kompresor) -> output.
// Di iOS beberapa efek bisa bunyi bersamaan (tick + kata + mendarat + clear);
// tanpa limiter jumlahnya bisa melewati 0dB -> clipping/"biso". Limiter menjaga
// puncak tetap di bawah 0dB tanpa memotong kasar.
let master = null;
if (actx) {
  const limiter = actx.createDynamicsCompressor();
  limiter.threshold.value = -3;   // mulai menahan mendekati puncak
  limiter.knee.value = 0;         // keras (limiter, bukan kompresor lembut)
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  master = actx.createGain();
  master.gain.value = 0.8;        // headroom supaya tumpukan suara tak clip
  master.connect(limiter);
  limiter.connect(actx.destination);

  for (const [name, src] of Object.entries(FILES)) {
    fetch(src)
      .then(r => r.arrayBuffer())
      .then(b => actx.decodeAudioData(b))
      .then(d => { buffers[name] = d; })
      .catch(() => console.warn('gagal load audio', src));
  }
  // browser mobile menahan audio sampai ada gesture pertama; iOS juga bisa
  // menaruh context ke 'suspended'/'interrupted' setelah kunci layar / balik
  // dari app lain — resume tiap ada gesture & saat halaman kembali terlihat.
  const resume = () => { if (actx.state !== 'running') actx.resume().catch(() => {}); };
  addEventListener('pointerdown', resume);
  addEventListener('keydown', resume);
  addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
}

export function playSfx(name) {
  if (!actx || !buffers[name]) return;
  if (actx.state !== 'running') actx.resume().catch(() => {});
  const s = actx.createBufferSource();
  s.buffer = buffers[name];
  s.connect(master);          // lewat master bus (limiter) — cegah clipping
  s.start();
  s.onended = () => { try { s.disconnect(); } catch {} };
}
