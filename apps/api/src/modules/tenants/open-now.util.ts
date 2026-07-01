import { OpeningHour, Tenant } from '@prisma/client';

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** "Aberto agora" = toggle manual ligado E (sem horário OU dentro do horário). */
export function computeOpenNow(tenant: Tenant, hours: OpeningHour[]): boolean {
  if (!tenant.isOpen) return false; // pausa manual
  if (hours.length === 0) return true; // sem horário definido => sempre aberto

  const tz = tenant.timezone || 'Europe/Lisbon';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = WEEKDAYS[get('weekday')] ?? -1;
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get('minute'), 10);
  const nowMin = hour * 60 + minute;

  const today = hours.find((h) => h.weekday === weekday);
  if (!today) return false; // dia sem faixa => fechado
  return nowMin >= today.openMinute && nowMin < today.closeMinute;
}
