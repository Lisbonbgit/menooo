// Atribuição de mesas (função pura — testada em assign.util.spec.ts).
// DECISÃO DE DESIGN (spec §4.2): mesa única SEMPRE antes de par — juntar mesas
// tem custo operacional; o desperdício ocasional é comportamento esperado.
export interface AssignableTable {
  id: string;
  seats: number;
  area: string | null;
  joinable: boolean;
  bookableOnline: boolean;
  sortOrder: number;
}

export function assignTables(
  tables: AssignableTable[],
  occupied: Set<string>,
  partySize: number,
  channel: 'ONLINE' | 'MANUAL',
): string[] | null {
  const free = tables.filter(
    (t) => !occupied.has(t.id) && (channel === 'MANUAL' || t.bookableOnline),
  );

  const single = free
    .filter((t) => t.seats >= partySize)
    .sort((a, b) => a.seats - b.seats || a.sortOrder - b.sortOrder)[0];
  if (single) return [single.id];

  const joinables = free.filter((t) => t.joinable && t.area !== null);
  let best: { ids: [string, string]; waste: number; sum: number } | null = null;
  for (let i = 0; i < joinables.length; i++) {
    for (let j = i + 1; j < joinables.length; j++) {
      const a = joinables[i];
      const b = joinables[j];
      if (a.area !== b.area) continue;
      const sum = a.seats + b.seats;
      if (sum < partySize) continue;
      const waste = sum - partySize;
      if (!best || waste < best.waste || (waste === best.waste && sum < best.sum)) {
        best = { ids: [a.id, b.id], waste, sum };
      }
    }
  }
  return best ? best.ids : null;
}
