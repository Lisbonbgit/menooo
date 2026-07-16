// Conversões hora-local ↔ UTC por timezone, só com Intl (sem libs de datas).
// NOTA: é a operação INVERSA da de open-now.util.ts (que converte instante→partes
// locais); a inversa exige sondagem de offset em duas passagens (DST).

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function partsInTz(date: Date, tz: string): Parts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const h = get('hour');
  return { y: get('year'), mo: get('month'), d: get('day'), h: h === 24 ? 0 : h, mi: get('minute'), s: get('second') };
}

/** Offset (ms) da timezone nesse instante: local − UTC. */
function offsetAt(date: Date, tz: string): number {
  const p = partsInTz(date, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - date.getTime();
}

/**
 * Hora de parede local (dateISO YYYY-MM-DD + minutos do dia) → instante UTC.
 * Hora ambígua (fim do verão): PRIMEIRA ocorrência (offset anterior — sonda-se o
 * offset 6h antes). Hora inexistente (início do verão): offset seguinte.
 */
export function localDateTimeToUtc(dateISO: string, minutes: number, tz: string): Date {
  const [y, mo, d] = dateISO.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, 0, minutes);
  // sonda o offset ANTES da hora (garante 1.ª ocorrência em horas ambíguas)
  const probe = offsetAt(new Date(wallAsUtc - 6 * 3_600_000), tz);
  const candidate = wallAsUtc - probe;
  const check = offsetAt(new Date(candidate), tz);
  if (check === probe) return new Date(candidate);
  // transição entre a sonda e a hora (inexistente/ambígua tardia): offset do destino
  return new Date(wallAsUtc - check);
}

/** Dia local (YYYY-MM-DD) de um instante nessa timezone. */
export function localDateISO(date: Date, tz: string): string {
  const p = partsInTz(date, tz);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Weekday (0=domingo…6=sábado — convenção do OpeningHour) de um dia de calendário. */
export function weekdayOf(dateISO: string): number {
  return new Date(`${dateISO}T12:00:00Z`).getUTCDay();
}

/** Minutos do dia LOCAL de um instante nessa timezone. */
export function minutesOfDayInTz(date: Date, tz: string): number {
  const p = partsInTz(date, tz);
  return p.h * 60 + p.mi;
}
