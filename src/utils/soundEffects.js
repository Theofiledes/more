// BMO Retro Web Audio API Sound Synthesizer

let audioCtx = null;

const getAudioContext = () => {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

export const isSfxEnabled = () => {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem('bmo_sfx_enabled') !== 'false';
};

export const setSfxEnabled = (enabled) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('bmo_sfx_enabled', enabled ? 'true' : 'false');
  }
};

/**
 * Short tactile click blip
 */
export const playClick = () => {
  if (!isSfxEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.04);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.04);
  } catch (e) {
    console.warn("SFX error:", e);
  }
};

/**
 * 8-bit Ascending Chime (C5, E5, G5, C6)
 */
export const playChime = () => {
  if (!isSfxEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    const noteDuration = 0.06;

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const noteTime = now + idx * noteDuration;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.2, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.01, noteTime + noteDuration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + noteDuration);
    });
  } catch (e) {
    console.warn("SFX error:", e);
  }
};

/**
 * BMO Happy Cheer Melody / Victory Arpeggio
 */
export const playCheer = () => {
  if (!isSfxEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98]; // C5 to G6
    const noteDuration = 0.05;

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const noteTime = now + idx * noteDuration;

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, noteTime);
      osc.frequency.linearRampToValueAtTime(freq * 1.05, noteTime + noteDuration); // subtle vibrato shift

      gain.gain.setValueAtTime(0.18, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.01, noteTime + noteDuration + 0.02);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + noteDuration + 0.02);
    });
  } catch (e) {
    console.warn("SFX error:", e);
  }
};

/**
 * Pitch-bending glitch blip
 */
export const playGlitch = () => {
  if (!isSfxEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.setValueAtTime(150, now + 0.03);
    osc.frequency.setValueAtTime(900, now + 0.06);
    osc.frequency.setValueAtTime(80, now + 0.09);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.12);
  } catch (e) {
    console.warn("SFX error:", e);
  }
};

/**
 * Standard retro game unit beep
 */
export const playBeep = () => {
  if (!isSfxEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(600, now);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  } catch (e) {
    console.warn("SFX error:", e);
  }
};

/**
 * Retro Game Cartridge Insertion Sound
 */
export const playCartridge = () => {
  if (!isSfxEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Mechanical Clunk (Thump)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(180, now);
    osc1.frequency.exponentialRampToValueAtTime(40, now + 0.07);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.07);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.07);

    // 2. High-speed slide/sweep
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    const slideTime = now + 0.06;
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(300, slideTime);
    osc2.frequency.exponentialRampToValueAtTime(1200, slideTime + 0.08);
    gain2.gain.setValueAtTime(0.15, slideTime);
    gain2.gain.exponentialRampToValueAtTime(0.01, slideTime + 0.08);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(slideTime);
    osc2.stop(slideTime + 0.08);

    // 3. Crisp lock chime
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    const lockTime = now + 0.14;
    osc3.type = 'square';
    osc3.frequency.setValueAtTime(880, lockTime);
    gain3.gain.setValueAtTime(0.2, lockTime);
    gain3.gain.exponentialRampToValueAtTime(0.01, lockTime + 0.1);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(lockTime);
    osc3.stop(lockTime + 0.1);

  } catch (e) {
    console.warn("SFX error:", e);
  }
};
