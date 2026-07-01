'use client';

// Beep gerado via Web Audio API — sem necessidade de ficheiros de áudio.
export function playAlarm() {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const beep = (start: number, freq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.25);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.26);
    };
    // dois bips ascendentes
    beep(0, 880);
    beep(0.3, 1175);
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* áudio indisponível */
  }
}
