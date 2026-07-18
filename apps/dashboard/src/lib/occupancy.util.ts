// Estado das mesas e lotação do mapa de sala — funções puras, sem I/O (testadas em occupancy.util.spec.ts).
//
// A REGRA DE OCUPAÇÃO É A MESMA DO SERVIDOR: `occupiedAt` em
// `apps/api/src/modules/reservations/days.util.ts`. Uma reserva ocupa a mesa quando
//   r.startsAt < fim + buffer   E   r.endsAt + buffer > início
// e SÓ as CONFIRMED contam. Está duplicada de propósito (ver a nota da Task 4 do plano): se as
// duas divergirem, o mapa mente — o servidor continua a recusar, mas o dono toca numa mesa
// «Livre» e leva com um erro. Qualquer mudança aqui tem de ir ao days.util.ts, e vice-versa.

/** Meia hora: o passo da timeline (Task 6). Um slot é o intervalo [início, início+SLOT_MS). */
export const SLOT_MS = 30 * 60_000;

export type TableStateKind = 'free' | 'free-until' | 'reserved' | 'inactive';

/** Forma mínima de uma mesa. Estrutural de propósito: o `Table` do painel encaixa aqui. */
export interface TableLike {
  id: string;
  active: boolean;
  x?: number | null;
  y?: number | null;
}

/** Forma mínima de uma reserva. As datas chegam da API em ISO, mas aceitamos `Date` também. */
export interface ReservationLike {
  id: string;
  status: string;
  partySize: number;
  startsAt: string | Date;
  endsAt: string | Date;
  tables: { tableId: string }[];
}

export interface TableState {
  kind: TableStateKind;
  /** A reserva em curso (`reserved`) ou a que atropela a hora do cursor (`free-until`). */
  reservation?: ReservationLike;
  /** Só em `free-until`: HH:MM a que a mesa deixa de estar livre. */
  freeUntil?: string;
}

export interface Cell {
  x: number;
  y: number;
}

export interface SlotOccupancy {
  /** Mesas ATIVAS ocupadas no slot. O denominador (mesas ativas) é do chamador. */
  tables: number;
  /** Pessoas sentadas no slot. Uma reserva com 2 mesas conta uma vez. */
  people: number;
}

const ms = (v: string | Date): number => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/** HH:MM na hora local — a mesma que o dono lê na grelha. */
export function hhmm(v: string | Date): string {
  const dt = v instanceof Date ? v : new Date(v);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

/** A regra do servidor, à letra: `occupiedAt(busy, start, end, bufMs)` do days.util.ts. */
function conflita(r: ReservationLike, startMs: number, endMs: number, bufMs: number): boolean {
  return ms(r.startsAt) < endMs + bufMs && ms(r.endsAt) + bufMs > startMs;
}

const confirmadasDaMesa = (reservations: ReservationLike[], tableId: string): ReservationLike[] =>
  reservations.filter((r) => r.status === 'CONFIRMED' && r.tables.some((rt) => rt.tableId === tableId));

/**
 * O estado da mesa à hora do cursor, do ponto de vista de QUEM VAI RESERVAR ali.
 *
 * Não é a ocupação no INSTANTE: o servidor decide por INTERVALO. Com duração 120 e slots de 30,
 * a mesa com reserva às 20:00 está desocupada às 18:30 — mas 18:30+120 = 20:30 atropela as 20:00
 * e o servidor recusa. Mostrar «Livre» era o bug do desenho original: o dono tocava e levava um
 * erro. Daí o estado `free-until`, que diz até quando é que ela serve.
 */
export function tableStateAt(
  table: TableLike,
  reservations: ReservationLike[],
  at: Date,
  durMs: number,
  bufMs: number,
): TableState {
  // Inativa manda em tudo: nunca «Livre», que ofereceria uma mesa que o servidor não atribui.
  if (!table.active) return { kind: 'inactive' };
  const T = at.getTime();
  const conflitos = confirmadasDaMesa(reservations, table.id)
    .filter((r) => conflita(r, T, T + durMs, bufMs))
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
  if (conflitos.length === 0) return { kind: 'free' };
  // Já começou (ou está no buffer) à hora do cursor → a mesa está mesmo ocupada.
  const emCurso = conflitos.find((r) => ms(r.startsAt) <= T);
  if (emCurso) return { kind: 'reserved', reservation: emCurso };
  // Vazia agora, mas a próxima reserva não deixa lá caber uma reserva inteira.
  const proxima = conflitos[0];
  return { kind: 'free-until', reservation: proxima, freeUntil: hhmm(proxima.startsAt) };
}

/**
 * Lotação de um slot da timeline: quantas mesas e quantas pessoas lá estão.
 *
 * Conta por INTERSEÇÃO com o slot [início, início+SLOT_MS), não pela hora de início: uma reserva
 * das 20:00 às 22:00 conta às 20:00, 20:30, 21:00 e 21:30, e a que começou antes do serviço e
 * ainda lá está também conta. Contar pela hora de início daria uma barra a zero num serviço cheio.
 *
 * `durMs` está na assinatura por simetria com o `tableStateAt` (o chamador tem os dois à mão) mas
 * NÃO entra na conta: a barra é a lotação REAL do slot, não «cabe aqui uma reserva nova?» — isso
 * é o `tableStateAt`. Somar a duração aqui punha 4 pessoas na barra das 19:30 por causa de uma
 * reserva das 20:00.
 */
export function occupancyOfSlot(
  tables: TableLike[],
  reservations: ReservationLike[],
  slotStart: Date,
  durMs: number,
  bufMs: number,
): SlotOccupancy {
  const inicio = slotStart.getTime();
  const fim = inicio + SLOT_MS;
  const ativas = new Set(tables.filter((t) => t.active).map((t) => t.id));
  const ocupadas = new Set<string>();
  const contadas = new Set<string>();
  let people = 0;
  for (const r of reservations) {
    if (r.status !== 'CONFIRMED') continue;
    if (!conflita(r, inicio, fim, bufMs)) continue;
    // Mesas inativas ficam fora da conta: estão fora do denominador do componente, e contá-las
    // aqui dava barras acima dos 100%.
    const suas = r.tables.map((rt) => rt.tableId).filter((id) => ativas.has(id));
    if (suas.length === 0) continue;
    for (const id of suas) ocupadas.add(id);
    if (contadas.has(r.id)) continue;
    contadas.add(r.id);
    people += r.partySize;
  }
  return { tables: ocupadas.size, people };
}

/**
 * Posições de todas as mesas de uma área. As gravadas ficam onde estão; as órfãs (sem x,y — todas,
 * enquanto o dono não arrastar nada) caem na primeira célula livre, em linha. É isto que faz o mapa
 * nunca nascer vazio, e nunca empilhar duas mesas na mesma célula: uma posição gravada que colida
 * com outra já colocada é tratada como órfã, senão o dono via uma mesa e não a outra.
 */
export function autoLayout(tables: TableLike[], cols: number): Map<string, Cell> {
  const nCols = Math.max(1, Math.floor(cols));
  const out = new Map<string, Cell>();
  const ocupadas = new Set<string>();
  const orfas: TableLike[] = [];
  for (const t of tables) {
    if (t.x == null || t.y == null || t.x < 0 || t.x >= nCols || t.y < 0) {
      orfas.push(t);
      continue;
    }
    const chave = `${t.x},${t.y}`;
    if (ocupadas.has(chave)) {
      orfas.push(t);
      continue;
    }
    ocupadas.add(chave);
    out.set(t.id, { x: t.x, y: t.y });
  }
  let i = 0;
  for (const t of orfas) {
    let x = 0;
    let y = 0;
    do {
      x = i % nCols;
      y = Math.floor(i / nCols);
      i += 1;
    } while (ocupadas.has(`${x},${y}`));
    ocupadas.add(`${x},${y}`);
    out.set(t.id, { x, y });
  }
  return out;
}
