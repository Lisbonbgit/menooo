import { autoLayout, occupancyOfSlot, tableStateAt, TableLike } from './occupancy.util';

/** Instante local do dia-âncora: d('20:00') → 2026-07-20 20:00 na hora local (a que o dono vê). */
const d = (hm: string): Date => {
  const [h, m] = hm.split(':').map(Number);
  return new Date(2026, 6, 20, h, m);
};

const t = (id: string, over: Partial<TableLike> = {}): TableLike => ({
  id,
  active: true,
  x: null,
  y: null,
  ...over,
});

const R = (id: string, start: Date, end: Date, party = 2, tableIds = ['M4']) => ({ id, startsAt: start, endsAt: end,
  partySize: party, status: 'CONFIRMED', tableNames: tableIds, tables: tableIds.map((t) => ({ tableId: t })) });

describe('tableStateAt', () => {
  it('mesa com reserva às 20:00 NÃO é «Livre» às 18:30 (duração 120)', () => {
    // Era o bug do desenho: livre no INSTANTE, mas 18:30+120 = 20:30 atropela as 20:00.
    const s = tableStateAt(t('M4'), [R('r1', d('20:00'), d('22:00'))], d('18:30'), 120 * 60e3, 0);
    expect(s.kind).toBe('free-until');
    expect(s.freeUntil).toBe('20:00');
  });
  it('mesa com reserva às 20:00 é «Livre» às 17:00 (17:00+120 = 19:00, cabe)', () => {
    expect(tableStateAt(t('M4'), [R('r1', d('20:00'), d('22:00'))], d('17:00'), 120 * 60e3, 0).kind).toBe('free');
  });
  it('mesa ocupada no instante é «Reservada»', () => {
    expect(tableStateAt(t('M4'), [R('r1', d('20:00'), d('22:00'))], d('20:30'), 120 * 60e3, 0).kind).toBe('reserved');
  });
  it('mesa inativa é «Inativa», nunca «Livre»', () => {
    expect(tableStateAt(t('M4', { active: false }), [], d('20:00'), 120 * 60e3, 0).kind).toBe('inactive');
  });
  it('CANCELLED não ocupa', () => {
    const r = { ...R('r1', d('20:00'), d('22:00')), status: 'CANCELLED' };
    expect(tableStateAt(t('M4'), [r], d('20:30'), 120 * 60e3, 0).kind).toBe('free');
  });
});

describe('occupancyOfSlot', () => {
  it('a lotação conta por INTERSEÇÃO, não por hora de início', () => {
    // reserva 20:00–22:00 conta em 20:00, 20:30, 21:00, 21:30 — e não em 19:30
    const rs = [R('r1', d('20:00'), d('22:00'), 4)];
    expect(occupancyOfSlot([t('M4')], rs, d('19:30'), 120 * 60e3, 0).people).toBe(0);
    expect(occupancyOfSlot([t('M4')], rs, d('21:30'), 120 * 60e3, 0).people).toBe(4);
  });
  it('a reserva que começou antes do serviço e ainda lá está conta', () => {
    expect(occupancyOfSlot([t('M4')], [R('r1', d('18:00'), d('20:00'), 3)], d('19:00'), 120 * 60e3, 0).people).toBe(3);
  });
  it('mesas inativas ficam FORA do denominador', () => {
    const o = occupancyOfSlot([t('M4'), t('M9', { active: false })], [], d('20:00'), 120 * 60e3, 0);
    expect(o.tables).toBe(0); // e o componente divide por 1, não por 2
  });
});

describe('autoLayout', () => {
  it('auto-layout: as órfãs vão para células livres, nunca por cima', () => {
    const m = autoLayout([t('A', { x: 0, y: 0 }), t('B'), t('C')], 8);
    expect(m.get('A')).toEqual({ x: 0, y: 0 });
    expect([...m.values()].filter((v) => v.x === 0 && v.y === 0)).toHaveLength(1);
  });
});
