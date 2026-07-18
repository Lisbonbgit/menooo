import { BusyLike, dayHasSlot, occupiedAt } from './days.util';
import { AssignableTable } from './assign.util';

const T = (id: string, seats: number, o: Partial<AssignableTable> = {}): AssignableTable => ({
  id,
  seats,
  area: o.area !== undefined ? o.area : 'Sala',
  joinable: o.joinable ?? false,
  bookableOnline: o.bookableOnline ?? true,
  sortOrder: o.sortOrder ?? 0,
});

/** Reserva ocupada: começa em `startMs`, dura `durMin`, nas mesas dadas. */
const R = (startMs: number, durMin: number, tableIds: string[]): BusyLike => ({
  startsAt: new Date(startMs),
  endsAt: new Date(startMs + durMin * 60_000),
  tables: tableIds.map((tableId) => ({ tableId })),
});

const MIN = 60_000;
const T0 = Date.UTC(2026, 6, 20, 19, 0); // 2026-07-20 19:00Z — âncora estável

describe('occupiedAt', () => {
  it('sobreposição direta marca a mesa como ocupada', () => {
    const busy = [R(T0, 120, ['m4'])];
    expect([...occupiedAt(busy, new Date(T0 + 30 * MIN), new Date(T0 + 150 * MIN), 0)]).toEqual(['m4']);
  });

  it('reserva que acaba exatamente quando o slot começa NÃO ocupa (buffer 0)', () => {
    const busy = [R(T0, 120, ['m4'])];
    expect(occupiedAt(busy, new Date(T0 + 120 * MIN), new Date(T0 + 240 * MIN), 0).size).toBe(0);
  });

  it('o buffer estende a ocupação para os dois lados', () => {
    const busy = [R(T0, 120, ['m4'])];
    // slot encostado ao fim da reserva: sem buffer está livre, com 15 min de buffer está ocupado
    const start = new Date(T0 + 120 * MIN);
    const end = new Date(T0 + 240 * MIN);
    expect(occupiedAt(busy, start, end, 0).size).toBe(0);
    expect([...occupiedAt(busy, start, end, 15 * MIN)]).toEqual(['m4']);
    // e do lado de antes: slot que acaba quando a reserva começa
    const before = { start: new Date(T0 - 120 * MIN), end: new Date(T0) };
    expect(occupiedAt(busy, before.start, before.end, 0).size).toBe(0);
    expect([...occupiedAt(busy, before.start, before.end, 15 * MIN)]).toEqual(['m4']);
  });

  it('reserva noutro horário não ocupa nada', () => {
    const busy = [R(T0, 120, ['m4'])];
    expect(occupiedAt(busy, new Date(T0 + 300 * MIN), new Date(T0 + 420 * MIN), 15 * MIN).size).toBe(0);
  });

  it('acumula todas as mesas de todas as reservas sobrepostas', () => {
    const busy = [R(T0, 120, ['a', 'b']), R(T0 + 30 * MIN, 120, ['c'])];
    expect([...occupiedAt(busy, new Date(T0), new Date(T0 + 120 * MIN), 0)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('sem reservas devolve conjunto vazio', () => {
    expect(occupiedAt([], new Date(T0), new Date(T0 + 120 * MIN), 15 * MIN).size).toBe(0);
  });
});

describe('dayHasSlot', () => {
  const tables = [T('m4', 4)];
  const durMs = 120 * MIN;

  it('há mesa livre num dos instantes → true', () => {
    expect(dayHasSlot([new Date(T0)], [], tables, 4, durMs, 0, 0)).toBe(true);
  });

  it('lista de instantes vazia → false', () => {
    expect(dayHasSlot([], [], tables, 2, durMs, 0, 0)).toBe(false);
  });

  it('sem mesas → false', () => {
    expect(dayHasSlot([new Date(T0)], [], [], 2, durMs, 0, 0)).toBe(false);
  });

  it('todos os instantes ocupados → false', () => {
    const busy = [R(T0 - 60 * MIN, 300, ['m4'])];
    const starts = [new Date(T0), new Date(T0 + 30 * MIN), new Date(T0 + 60 * MIN)];
    expect(dayHasSlot(starts, busy, tables, 4, durMs, 0, 0)).toBe(false);
  });

  it('primeiros instantes ocupados mas um mais tarde livre → true', () => {
    const busy = [R(T0, 120, ['m4'])];
    const starts = [new Date(T0), new Date(T0 + 30 * MIN), new Date(T0 + 120 * MIN)];
    expect(dayHasSlot(starts, busy, tables, 4, durMs, 0, 0)).toBe(true);
  });

  it('notBefore (antecedência mínima) descarta os instantes cedo demais', () => {
    const starts = [new Date(T0), new Date(T0 + 30 * MIN)];
    // todos antes do notBefore → false, mesmo com a casa vazia
    expect(dayHasSlot(starts, [], tables, 4, durMs, 0, T0 + 60 * MIN)).toBe(false);
    // notBefore entre os dois → o segundo salva o dia
    expect(dayHasSlot(starts, [], tables, 4, durMs, 0, T0 + 15 * MIN)).toBe(true);
  });

  it('grupo maior que a maior mesa → false (mesma regra do assignTables)', () => {
    expect(dayHasSlot([new Date(T0)], [], tables, 6, durMs, 0, 0)).toBe(false);
  });

  it('canal ONLINE: mesa não reservável online não conta', () => {
    const vip = [T('vip', 6, { bookableOnline: false })];
    expect(dayHasSlot([new Date(T0)], [], vip, 4, durMs, 0, 0)).toBe(false);
  });

  it('o buffer pode esvaziar um dia que sem buffer teria vaga', () => {
    const busy = [R(T0, 120, ['m4'])];
    const starts = [new Date(T0 + 120 * MIN)]; // encostado ao fim da reserva
    expect(dayHasSlot(starts, busy, tables, 4, durMs, 0, 0)).toBe(true);
    expect(dayHasSlot(starts, busy, tables, 4, durMs, 15 * MIN, 0)).toBe(false);
  });
});
