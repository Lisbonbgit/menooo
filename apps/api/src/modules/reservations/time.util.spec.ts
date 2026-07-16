import { localDateTimeToUtc, localDateISO, weekdayOf, minutesOfDayInTz } from './time.util';

describe('localDateTimeToUtc (Europe/Lisbon)', () => {
  const TZ = 'Europe/Lisbon';
  it('verão (WEST, UTC+1): 20:00 locais = 19:00Z', () => {
    expect(localDateTimeToUtc('2026-07-20', 20 * 60, TZ).toISOString()).toBe(
      '2026-07-20T19:00:00.000Z',
    );
  });
  it('inverno (WET, UTC+0): 20:00 locais = 20:00Z', () => {
    expect(localDateTimeToUtc('2026-01-20', 20 * 60, TZ).toISOString()).toBe(
      '2026-01-20T20:00:00.000Z',
    );
  });
  it('hora AMBÍGUA (fim do verão 2026-10-25 01:30 ocorre 2x): primeira ocorrência (WEST)', () => {
    expect(localDateTimeToUtc('2026-10-25', 90, TZ).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });
  it('hora INEXISTENTE (início do verão 2026-03-29 01:30): resolve para o offset seguinte', () => {
    expect(localDateTimeToUtc('2026-03-29', 90, TZ).toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
  });
  it('meia-noite exata', () => {
    expect(localDateTimeToUtc('2026-07-20', 0, TZ).toISOString()).toBe(
      '2026-07-19T23:00:00.000Z',
    );
  });
});

describe('helpers', () => {
  it('localDateISO devolve o dia local do instante', () => {
    expect(localDateISO(new Date('2026-07-19T23:30:00Z'), 'Europe/Lisbon')).toBe('2026-07-20');
  });
  it('weekdayOf: 2026-07-20 é segunda (1)', () => {
    expect(weekdayOf('2026-07-20')).toBe(1);
  });
  it('minutesOfDayInTz: 19:00Z de verão são 20:00 locais', () => {
    expect(minutesOfDayInTz(new Date('2026-07-20T19:00:00Z'), 'Europe/Lisbon')).toBe(20 * 60);
  });
});
