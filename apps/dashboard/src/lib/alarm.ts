'use client';

// Beep via Web Audio, sem ficheiros de áudio. O Android suspende AudioContexts
// criados sem gesto do utilizador (política de autoplay) — por isso mantemos UM
// contexto partilhado, desbloqueado no primeiro toque (unlockAudio) e
// reutilizado por todos os beeps (nunca fechado).
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  return ctx;
}

/** Chamar num gesto do utilizador (toque/clique) para desbloquear o áudio. */
export function unlockAudio() {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume().catch(() => {});
}

export function playAlarm() {
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === 'suspended') void c.resume().catch(() => {});
    const beep = (start: number, freq: number) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(c.destination);
      gain.gain.setValueAtTime(0.001, c.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.3, c.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + 0.25);
      osc.start(c.currentTime + start);
      osc.stop(c.currentTime + start + 0.26);
    };
    // dois bips ascendentes
    beep(0, 880);
    beep(0.3, 1175);
  } catch {
    /* áudio indisponível */
  }
}
