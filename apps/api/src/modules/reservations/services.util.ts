/**
 * Serviços de reserva (Almoço/Jantar) — a lógica pura por trás do windowsFor.
 *
 * O windowsOf devolve a MESMA forma que o antigo windowsFor devolvia a partir das
 * ReservationWindow: `{ openMinute, closeMinute }[]`. É isso que mantém o slotMinutes, o
 * slotsForDayTx, o publicDays e os testes de DST intocados — e é a promessa desta fase:
 * a disponibilidade de ninguém muda.
 */

export interface ServiceLike {
  id: string;
  name: string;
  weekdays: number[];
  openMinute: number;
  closeMinute: number;
  sortOrder: number;
}

export interface HourLike {
  weekday: number;
  openMinute: number;
  closeMinute: number;
}

/** Serviços de um weekday, ordenados. Vazio = o chamador cai no fallback. */
export function servicesOfWeekday(services: ServiceLike[], weekday: number): ServiceLike[] {
  return services
    .filter((s) => s.weekdays.includes(weekday))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.openMinute - b.openMinute);
}

/**
 * Janelas de SEATING de um weekday. Mesma forma e mesma semântica do antigo windowsFor:
 * serviços do dia, ou o fallback OpeningHour−60 quando não há nenhum.
 * O fallback MANTÉM-SE: mudá-lo alteraria a disponibilidade de quem já usa isto.
 */
export function windowsOf(
  services: ServiceLike[],
  hours: HourLike[],
  weekday: number,
): { openMinute: number; closeMinute: number }[] {
  const own = servicesOfWeekday(services, weekday);
  if (own.length > 0) {
    return own.map((s) => ({ openMinute: s.openMinute, closeMinute: s.closeMinute }));
  }
  const oh = hours.find((h) => h.weekday === weekday);
  return oh ? [{ openMinute: oh.openMinute, closeMinute: oh.closeMinute - 60 }] : [];
}

/** true quando o dia corre pelo horário de abertura e não por serviços — o painel avisa. */
export function isSynthetic(services: ServiceLike[], weekday: number): boolean {
  return servicesOfWeekday(services, weekday).length === 0;
}
