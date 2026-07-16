/** Minutos de início de slot (passo 30) para janelas de SEATING já ajustadas. */
export function slotMinutes(windows: { openMinute: number; closeMinute: number }[]): number[] {
  const out = new Set<number>();
  for (const w of windows) {
    const first = Math.ceil(w.openMinute / 30) * 30;
    for (let m = first; m <= w.closeMinute; m += 30) out.add(m);
  }
  return [...out].sort((a, b) => a - b);
}
