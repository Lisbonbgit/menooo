'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { Armchair, Link2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useTenantConfig } from '@/lib/reservations-hooks';
import { autoLayout, hhmm, tableStateAt } from '@/lib/occupancy.util';
import type { Cell, TableState } from '@/lib/occupancy.util';
import type { Reservation, Table } from '@/lib/reservation-types';

// ==========================================================================
// Geometria — a conta que decide tudo
// ==========================================================================

// O <main> do AppShell tem px-4 e nenhum max-width: a 375px sobram 343px. 12 colunas dariam
// células de 23px — metade do mínimo tátil (44px HIG / 48dp Material) — com o nome da mesa,
// os lugares e o nome do cliente lá dentro. 8 colunas × 56px = 504px, com scroll horizontal
// dentro do cartão em ecrãs estreitos. Um nº de colunas variável tornaria o `x` gravado
// ambíguo: a mesma mesa em sítios diferentes conforme o telemóvel.
const COLS = 8;
const CELL = 56;
const GAP = 8;
const STEP = CELL + GAP;

/** O `y` do LayoutPositionDto é `@Max(49)`: 50 linhas é o teto do que se pode gravar. */
const MAX_ROWS = 50;

/** Distância a partir da qual o gesto deixa de ser um toque e passa a ser um arrasto. */
const MOVE_TOL = 6;
/** Toque longo que arma o arrasto no dedo (o rato arma logo ao mexer). */
const LONG_PRESS_MS = 280;

const SEM_AREA = 'Sem área';

// ==========================================================================
// Tipos
// ==========================================================================

/**
 * A mesa como o mapa precisa dela: o `Table` do painel mais a posição gravada.
 * O `x`/`y`/`shape` entram no `reservation-types` noutra tarefa; aqui ficam opcionais para o
 * mapa compilar antes disso e continuar a compilar depois (a interseção não entra em conflito
 * quando os campos passarem a ser obrigatórios).
 */
export type FloorTable = Table & {
  x?: number | null;
  y?: number | null;
  shape?: string | null;
};

/** `null` = a área «Sem área» — é o que o `Table.area` anulável quer dizer. */
type AreaKey = string | null;

interface DragState {
  id: string;
  pointerId: number;
  el: HTMLElement;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  /** armado = o gesto é um arrasto e o scroll do browser fica travado */
  armed: boolean;
  moved: boolean;
  longPress?: ReturnType<typeof setTimeout>;
}

// ==========================================================================
// Auxiliares
// ==========================================================================

function firstName(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function areaLabel(a: AreaKey): string {
  return a ?? SEM_AREA;
}

function serverError(e: any, fallback: string): string {
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg) && msg.length > 0) return msg.join(' ');
  if (typeof msg === 'string' && msg) return msg;
  return fallback;
}

// ==========================================================================
// FloorMap
// ==========================================================================

export function FloorMap({
  tables,
  reservations,
  areas,
  area,
  onAreaChange,
  cursorAt,
  onPickTable,
}: {
  tables: FloorTable[];
  reservations: Reservation[];
  /** Opcional: as áreas derivam das mesas. Aceita-se a lista do pai por conveniência. */
  areas?: AreaKey[];
  area: AreaKey;
  onAreaChange: (a: AreaKey) => void;
  /** A hora do cursor da timeline — é ela que decide o estado de cada mesa. */
  cursorAt: Date;
  /** Tocar numa mesa livre. O pai é dono da hora do cursor, logo só o id da mesa viaja. */
  onPickTable: (tableId: string) => void;
}): JSX.Element {
  const config = useTenantConfig();
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ dx: number; dy: number } | null>(null);
  const [dropCell, setDropCell] = useState<Cell | null>(null);

  // --- áreas -------------------------------------------------------------

  const derivedAreas = useMemo<AreaKey[]>(() => {
    const set = new Map<string, AreaKey>();
    for (const t of tables) set.set(t.area ?? '', t.area ?? null);
    return [...set.values()].sort((a, b) => {
      if (a === null) return 1; // «Sem área» fica sempre no fim (como no TablesManager)
      if (b === null) return -1;
      return a.localeCompare(b, 'pt-PT');
    });
  }, [tables]);

  const areaKeys = areas ?? derivedAreas;

  // Uma área que já não existe (mesa apagada, área renomeada) cairia num mapa vazio — o que se
  // mostra é a primeira área que existe mesmo.
  const activeArea = areaKeys.some((a) => a === area) ? area : (areaKeys[0] ?? null);

  const areaTables = useMemo(
    () =>
      tables
        .filter((t) => (t.area ?? null) === activeArea)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-PT')),
    [tables, activeArea],
  );

  // --- posições ----------------------------------------------------------

  // O mapa NUNCA aparece vazio: o autoLayout coloca as mesas sem x/y nas primeiras células
  // livres, nunca por cima de uma já posicionada. O estado misto é o normal — qualquer mesa
  // criada depois de o mapa estar arrumado nasce com x=null.
  const layout = useMemo<Map<string, Cell>>(() => autoLayout(areaTables, COLS), [areaTables]);

  const rows = useMemo(() => {
    let maxY = 0;
    for (const c of layout.values()) maxY = Math.max(maxY, c.y);
    // +1 linha de folga para haver sempre onde largar uma mesa
    const wanted = Math.max(maxY + 2, Math.ceil(areaTables.length / COLS) + 1);
    return clamp(wanted, 1, MAX_ROWS);
  }, [layout, areaTables.length]);

  // --- estados das mesas à hora do cursor --------------------------------

  const durMs = (config.data?.reservationDurationMin ?? 120) * 60_000;
  const bufMs = (config.data?.reservationBufferMin ?? 0) * 60_000;

  const states = useMemo<Map<string, TableState>>(() => {
    const m = new Map<string, TableState>();
    for (const t of areaTables) m.set(t.id, tableStateAt(t, reservations, cursorAt, durMs, bufMs));
    return m;
  }, [areaTables, reservations, cursorAt, durMs, bufMs]);

  // O `TableState.reservation` do occupancy.util é uma forma mínima (sem `customerName`, de
  // propósito, para o util ficar puro): a etiqueta e o toque resolvem a reserva inteira por id.
  const reservaPorId = useMemo(() => {
    const m = new Map<string, Reservation>();
    for (const r of reservations) m.set(r.id, r);
    return m;
  }, [reservations]);

  /** Mesas que partilham a reserva com outra mesa — «juntas». */
  const joinedIds = useMemo(() => {
    const porReserva = new Map<string, string[]>();
    for (const t of areaTables) {
      const st = states.get(t.id);
      const rid = st?.kind === 'reserved' ? st.reservation?.id : undefined;
      if (!rid) continue;
      if (!porReserva.has(rid)) porReserva.set(rid, []);
      porReserva.get(rid)!.push(t.id);
    }
    const out = new Set<string>();
    for (const ids of porReserva.values()) if (ids.length > 1) for (const id of ids) out.add(id);
    return out;
  }, [areaTables, states]);

  /** Barras no gap entre duas mesas contíguas da MESMA reserva — a «borda partilhada». */
  const joinBars = useMemo(() => {
    const porReserva = new Map<string, Cell[]>();
    for (const t of areaTables) {
      const st = states.get(t.id);
      const rid = st?.kind === 'reserved' ? st.reservation?.id : undefined;
      const cell = layout.get(t.id);
      if (!rid || !cell) continue;
      if (!porReserva.has(rid)) porReserva.set(rid, []);
      porReserva.get(rid)!.push(cell);
    }
    const bars: { key: string; style: React.CSSProperties }[] = [];
    for (const [rid, cells] of porReserva) {
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          const a = cells[i];
          const b = cells[j];
          const dx = Math.abs(a.x - b.x);
          const dy = Math.abs(a.y - b.y);
          if (dx + dy !== 1) continue; // só as contíguas se ligam; as afastadas levam o ícone
          const style: React.CSSProperties =
            dx === 1
              ? { left: Math.min(a.x, b.x) * STEP + CELL, top: a.y * STEP + CELL / 2 - 2, width: GAP, height: 4 }
              : { left: a.x * STEP + CELL / 2 - 2, top: Math.min(a.y, b.y) * STEP + CELL, width: 4, height: GAP };
          bars.push({ key: `${rid}-${i}-${j}`, style });
        }
      }
    }
    return bars;
  }, [areaTables, states, layout]);

  // --- gravar ------------------------------------------------------------

  const saveLayout = useMutation({
    mutationFn: async (vars: { area: AreaKey; positions: { id: string; x: number; y: number }[] }) =>
      (await api.put('/tables/layout', { area: vars.area, positions: vars.positions })).data,
    // Otimista na cache das mesas: é a mesma lista que o pai lê, logo a mesa fica onde o dedo
    // a largou sem esperar pelo servidor. O rollback repõe tudo se o PUT falhar.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['tables'] });
      const anterior = qc.getQueryData<FloorTable[]>(['tables']);
      const porId = new Map(vars.positions.map((p) => [p.id, p]));
      qc.setQueryData<FloorTable[]>(['tables'], (old) =>
        (old ?? []).map((t) => {
          const p = porId.get(t.id);
          return p ? { ...t, x: p.x, y: p.y } : t;
        }),
      );
      return { anterior };
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.anterior) qc.setQueryData(['tables'], ctx.anterior);
      toast.error(serverError(e, 'Não foi possível gravar o mapa.'));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tables'] }),
  });

  /** Move (ou troca) e grava a área INTEIRA — ver §6 do spec. */
  const commitDrop = useCallback(
    (id: string, destino: Cell) => {
      const atual = layout.get(id);
      if (!atual) return;
      if (atual.x === destino.x && atual.y === destino.y) return;

      const ocupante = [...layout.entries()].find(
        ([tid, c]) => tid !== id && c.x === destino.x && c.y === destino.y,
      );

      const proximo = new Map(layout);
      proximo.set(id, destino);
      if (ocupante) proximo.set(ocupante[0], atual); // largar em cima de outra mesa troca-as

      // O PUT leva TODAS as mesas da área, não só as que se mexeram: senão o auto-layout das
      // restantes nunca ficaria gravado e dois dispositivos veriam salas diferentes.
      const positions = areaTables.map((t) => {
        const c = proximo.get(t.id) ?? { x: 0, y: 0 };
        return { id: t.id, x: c.x, y: c.y };
      });
      saveLayout.mutate({ area: activeArea, positions });
    },
    [layout, areaTables, activeArea, saveLayout],
  );

  // --- toque numa mesa ---------------------------------------------------

  const pickTable = useCallback(
    (t: FloorTable) => {
      const st = states.get(t.id);
      if (!st) return;
      if (st.kind === 'inactive') {
        toast.info(`A ${t.name} está inativa — ativa-a no separador Mesas para aceitar reservas.`);
        return;
      }
      if (st.kind === 'reserved' && st.reservation) {
        const r = reservaPorId.get(st.reservation.id) ?? st.reservation;
        const nome = 'customerName' in r ? r.customerName : `${r.partySize}p`;
        toast.info(
          `${t.name} · ${nome} · ${r.partySize} ${r.partySize === 1 ? 'pessoa' : 'pessoas'} ` +
            `(${hhmm(r.startsAt)}–${hhmm(r.endsAt)})`,
        );
        return;
      }
      if (st.kind === 'free-until') {
        // Não oferecer o que o servidor vai recusar: às 18:30 a mesa está livre no INSTANTE,
        // mas 18:30+120 atropela a reserva das 20:00.
        toast.info(
          `A ${t.name} está livre às ${hhmm(cursorAt)}, mas só até às ${st.freeUntil} — ` +
            `não dá uma estadia inteira (${Math.round(durMs / 60_000)} min). ` +
            `Escolhe uma hora mais cedo ou outra mesa.`,
        );
        return;
      }
      onPickTable(t.id);
    },
    [states, reservaPorId, cursorAt, durMs, onPickTable],
  );

  // --- arrastar (um só caminho para rato e dedo) -------------------------

  const cellAt = useCallback(
    (clientX: number, clientY: number): Cell | null => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return null;
      const px = clientX - r.left;
      const py = clientY - r.top;
      if (px < 0 || py < 0 || px > r.width || py > r.height) return null; // largar fora = desistir
      return { x: clamp(Math.floor(px / STEP), 0, COLS - 1), y: clamp(Math.floor(py / STEP), 0, rows - 1) };
    },
    [rows],
  );

  const limpar = useCallback((st: DragState) => {
    if (st.longPress) clearTimeout(st.longPress);
    try {
      if (st.el.hasPointerCapture(st.pointerId)) st.el.releasePointerCapture(st.pointerId);
    } catch {
      // o elemento pode já ter saído do DOM — não há captura para libertar
    }
    dragRef.current = null;
    setDragId(null);
    setGhost(null);
    setDropCell(null);
  }, []);

  const armar = useCallback((st: DragState) => {
    st.armed = true;
    setDragId(st.id);
    setGhost({ dx: st.lastX - st.startX, dy: st.lastY - st.startY });
  }, []);

  // O React regista o onTouchMove como PASSIVO no root: um preventDefault lá dentro não faz
  // nada. Só um listener nativo não-passivo trava o scroll do browser durante o arrasto —
  // e, como o dedo tem de estar quieto para armar, o primeiro touchmove chega já armado,
  // antes de o browser se comprometer com um scroll.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (dragRef.current?.armed) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLElement>, t: FloorTable) {
    if (e.button !== 0) return; // só o botão esquerdo / o toque
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // sem captura o arrasto ainda funciona enquanto o ponteiro não sair do elemento
    }
    const st: DragState = {
      id: t.id,
      pointerId: e.pointerId,
      el,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      armed: false,
      moved: false,
    };
    dragRef.current = st;
    if (e.pointerType !== 'mouse') {
      // No dedo, arrastar só depois de um toque longo: senão o mapa roubava o scroll da página.
      st.longPress = setTimeout(() => {
        if (dragRef.current === st && !st.moved) armar(st);
      }, LONG_PRESS_MS);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    st.lastX = e.clientX;
    st.lastY = e.clientY;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;

    if (Math.hypot(dx, dy) > MOVE_TOL) {
      st.moved = true;
      if (!st.armed) {
        if (e.pointerType === 'mouse') {
          armar(st); // o rato não faz scroll a arrastar: arma logo
        } else if (st.longPress) {
          clearTimeout(st.longPress); // o dedo mexeu antes de armar => é um scroll, não um arrasto
          st.longPress = undefined;
        }
      }
    }
    if (st.armed) {
      setGhost({ dx, dy });
      setDropCell(cellAt(e.clientX, e.clientY));
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLElement>, t: FloorTable) {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const { armed, moved } = st;
    const destino = armed ? cellAt(e.clientX, e.clientY) : null;
    limpar(st);
    if (armed) {
      if (destino) commitDrop(t.id, destino);
    } else if (!moved) {
      pickTable(t); // quieto = toque
    }
  }

  function onPointerCancel(e: React.PointerEvent<HTMLElement>) {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    limpar(st); // o browser levou o gesto (scroll) — não mexemos em nada
  }

  // --- render ------------------------------------------------------------

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-16 text-center">
        <Armchair size={30} className="text-ink-mute" strokeWidth={1.5} />
        <p className="font-medium">Ainda não tens mesas.</p>
        <p className="text-[13px] text-ink-mute">Cria-as no separador Mesas para veres a sala aqui.</p>
      </div>
    );
  }

  const canvasW = COLS * CELL + (COLS - 1) * GAP;
  const canvasH = rows * CELL + (rows - 1) * GAP;

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
      {areaKeys.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-line bg-cream/40 px-3 pt-2">
          {areaKeys.map((a) => (
            <button
              key={a ?? ' sem-area'}
              onClick={() => onAreaChange(a)}
              className={clsx(
                '-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                a === activeArea
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink-soft hover:text-ink',
              )}
            >
              {areaLabel(a)}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-3 text-[11px] text-ink-mute">
        <Legenda className="border border-line bg-white" label="Livre" />
        <Legenda className="border border-line bg-white opacity-50" label="Livre até…" />
        <Legenda className="bg-brand" label="Reservada" />
        <Legenda className="border border-dashed border-ink-mute bg-transparent" label="Inativa" />
        <span className="ml-auto tabular-nums">às {hhmm(cursorAt)}</span>
      </div>

      {/* scroll DENTRO do cartão: o canvas tem 504px e a 375px só há 343px */}
      <div className="overflow-x-auto p-4">
        <div
          ref={canvasRef}
          className="relative select-none"
          style={{ width: canvasW, height: canvasH, touchAction: 'manipulation' }}
        >
          {/* células de fundo */}
          {Array.from({ length: rows * COLS }, (_, i) => {
            const x = i % COLS;
            const y = Math.floor(i / COLS);
            const alvo = dropCell?.x === x && dropCell?.y === y;
            return (
              <div
                key={`c-${x}-${y}`}
                aria-hidden
                className={clsx(
                  'absolute rounded-lg transition-colors',
                  alvo ? 'bg-brand-soft ring-2 ring-brand/50' : 'bg-cream/40',
                )}
                style={{ left: x * STEP, top: y * STEP, width: CELL, height: CELL }}
              />
            );
          })}

          {/* mesas juntas: barra no gap entre as contíguas */}
          {joinBars.map((b) => (
            <div key={b.key} aria-hidden className="absolute z-10 rounded-full bg-brand-dark" style={b.style} />
          ))}

          {/* mesas */}
          {areaTables.map((t) => {
            const cell = layout.get(t.id);
            if (!cell) return null;
            const st = states.get(t.id) ?? { kind: 'free' as const };
            const aArrastar = dragId === t.id;
            const junta = joinedIds.has(t.id);
            // O util não guarda o nome do cliente na reserva mínima — resolve-se aqui.
            const nome = st.reservation ? reservaPorId.get(st.reservation.id)?.customerName : undefined;

            return (
              <button
                key={t.id}
                type="button"
                onPointerDown={(e) => onPointerDown(e, t)}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => onPointerUp(e, t)}
                onPointerCancel={onPointerCancel}
                onContextMenu={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pickTable(t);
                  }
                }}
                title={tituloDaMesa(t, st, nome)}
                aria-label={tituloDaMesa(t, st, nome)}
                className={clsx(
                  'absolute flex flex-col items-center justify-center gap-0.5 overflow-hidden px-1 text-center transition-[transform,box-shadow,background-color]',
                  t.shape === 'round' ? 'rounded-full' : 'rounded-xl',
                  st.kind === 'reserved' && 'bg-brand text-white shadow-card',
                  st.kind === 'free' && 'border border-line bg-white hover:border-brand/50',
                  st.kind === 'free-until' && 'border border-line bg-white opacity-60 hover:opacity-90',
                  st.kind === 'inactive' && 'border border-dashed border-ink-mute bg-transparent text-ink-mute',
                  junta && 'ring-2 ring-brand-dark ring-offset-1 ring-offset-white',
                  aArrastar ? 'z-30 scale-105 shadow-lift' : 'z-20',
                )}
                style={{
                  left: cell.x * STEP,
                  top: cell.y * STEP,
                  width: CELL,
                  height: CELL,
                  transform: aArrastar && ghost ? `translate(${ghost.dx}px, ${ghost.dy}px)` : undefined,
                  WebkitTouchCallout: 'none',
                }}
              >
                <span className="max-w-full truncate text-[11px] font-semibold leading-none">{t.name}</span>
                <Etiqueta state={st} table={t} nome={nome} />
                {junta && <Link2 size={9} className="absolute right-1 top-1 opacity-80" aria-hidden />}
              </button>
            );
          })}
        </div>
      </div>

      <p className="border-t border-line px-4 py-2 text-[11px] text-ink-mute">
        Arrasta para arrumar a sala (no telemóvel, toca sem largar). Largar em cima de outra mesa
        troca-as.
      </p>
    </section>
  );
}

// ==========================================================================
// Peças
// ==========================================================================

function tituloDaMesa(t: FloorTable, st: TableState, nome?: string): string {
  const base = `${t.name} · ${t.seats} ${t.seats === 1 ? 'lugar' : 'lugares'}`;
  if (st.kind === 'inactive') return `${base} · inativa`;
  if (st.kind === 'reserved' && st.reservation) {
    return `${base} · ${nome ?? `${st.reservation.partySize}p`} (${st.reservation.partySize})`;
  }
  if (st.kind === 'free-until') return `${base} · livre até às ${st.freeUntil}`;
  return `${base} · livre`;
}

function Etiqueta({
  state,
  table,
  nome,
}: {
  state: TableState;
  table: FloorTable;
  nome?: string;
}): JSX.Element {
  if (state.kind === 'reserved' && state.reservation) {
    return (
      <>
        <span className="max-w-full truncate text-[9.5px] font-medium leading-tight">
          {nome ? firstName(nome) : `${state.reservation.partySize} pax`}
        </span>
        <span className="text-[9px] tabular-nums leading-none opacity-90">{state.reservation.partySize}p</span>
      </>
    );
  }
  if (state.kind === 'free-until') {
    return (
      <span className="text-[9px] tabular-nums leading-tight text-ink-soft">até {state.freeUntil}</span>
    );
  }
  return <span className="text-[9px] tabular-nums leading-none text-ink-mute">{table.seats}p</span>;
}

function Legenda({ className, label }: { className: string; label: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      <span className={clsx('h-3 w-3 rounded', className)} />
      {label}
    </span>
  );
}
