/**
 * Synthesizes dynamic scratch audio and celebratory victory chimes using the native Web Audio API.
 * Zero external audio files required.
 */

let audioCtx = null;

function getAudioContext() {
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
}

/**
 * Synthesizes a subtle, crisp metallic scratching noise modulated by brush velocity.
 */
export function playScratchSound(velocity = 1) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const bufferSize = ctx.sampleRate * 0.05; // 50ms burst
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    // Filter to give realistic metallic scraping texture
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800 + Math.min(velocity * 40, 1200);
    filter.Q.value = 3.5;

    const gainNode = ctx.createGain();
    const volume = Math.min(Math.max(velocity * 0.04, 0.02), 0.12);
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    whiteNoise.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);

    whiteNoise.start();
  } catch {
    // Fail quietly if Web Audio is blocked or unsupported
  }
}

/**
 * Plays a bright, uplifting pentatonic major victory chime upon cashback reveal.
 * Notes: C5 (523Hz), E5 (659Hz), G5 (784Hz), A5 (880Hz), C6 (1046Hz)
 */
export function playVictoryChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 880.0, 1046.5];
    notes.forEach((freq, index) => {
      const startTime = ctx.currentTime + index * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      // Soft chime envelope
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.65);
    });
  } catch {
    // Fail quietly
  }
}

/**
 * Trigger subtle haptic vibration on supporting mobile devices.
 */
export function triggerHaptic(pattern = [15, 30, 15]) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore
  }
}

