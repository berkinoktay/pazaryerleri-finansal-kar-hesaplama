// Synthesized two-note "ding" via Web Audio -- no binary asset, no library
// (matches the no-dependency preference). SSR-safe: the AudioContext is created
// lazily inside these functions, never at module scope or during render.

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor === undefined) return null;
  if (audioContext === null) audioContext = new Ctor();
  return audioContext;
}

/**
 * Resume the audio context after a user gesture (browsers start it suspended).
 * Safe to call repeatedly; swallows rejections so a blocked resume never
 * surfaces an unhandled rejection.
 */
export function resumeNotificationAudio(): void {
  const ctx = getContext();
  if (ctx === null) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }
}

function tone(ctx: AudioContext, freq: number, startAt: number, duration: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.12, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);
}

/**
 * Play the two-note ding. No-ops if the context is unavailable or still
 * suspended (gesture not yet given). Never throws.
 */
export function playNotificationDing(): void {
  const ctx = getContext();
  if (ctx === null || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  tone(ctx, 880, now, 0.18);
  tone(ctx, 1174.66, now + 0.12, 0.22);
}
