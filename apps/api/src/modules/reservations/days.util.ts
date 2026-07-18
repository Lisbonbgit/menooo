// Disponibilidade em lote (funções puras — sem I/O, testadas em days.util.spec.ts).
// Extraído do ciclo de slotsForDayTx para que o LOTE e o DIA-A-DIA partilhem a mesma
// regra de ocupação: se divergirem, o lote mente ao cliente (mostra dias vazios como
// livres, ou o contrário).
import { assignTables } from './assign.util';

export interface BusyLike {
  startsAt: Date;
  endsAt: Date;
  tables: { tableId: string }[];
}

/** Mesas ocupadas no intervalo [start, end) com buffer — extraído do ciclo de slotsForDayTx. */
export function occupiedAt(busy: BusyLike[], start: Date, end: Date, bufMs: number): Set<string> {
  const occupied = new Set<string>();
  for (const r of busy) {
    if (r.startsAt.getTime() < end.getTime() + bufMs && r.endsAt.getTime() + bufMs > start.getTime()) {
      for (const rt of r.tables) occupied.add(rt.tableId);
    }
  }
  return occupied;
}

/** true se ALGUM instante da lista tem mesa para `party`. Pára no primeiro (é só hasSlots). */
export function dayHasSlot(
  starts: Date[],
  busy: BusyLike[],
  tables: Parameters<typeof assignTables>[0],
  party: number,
  durMs: number,
  bufMs: number,
  notBefore: number,
): boolean {
  for (const start of starts) {
    if (start.getTime() < notBefore) continue;
    const end = new Date(start.getTime() + durMs);
    if (assignTables(tables, occupiedAt(busy, start, end, bufMs), party, 'ONLINE')) return true;
  }
  return false;
}
