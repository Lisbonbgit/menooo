'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import { occupancyOfSlot } from '@/lib/occupancy.util';
import { useTenantConfig } from '@/lib/reservations-hooks';
import type { Reservation, Table } from '@/lib/reservation-types';

/** Passo da grelha de horas: o mesmo do motor de slots do servidor (de 30 em 30 minutos). */
const SLOT_MIN = 30;

/**
 * Largura mínima de um slot — 44px é o mínimo tátil (44px HIG / 48dp Material). É por isto que a
 * faixa SCROLLA em vez de encolher: o <main> do AppShell tem px-4 e nenhum max-width, logo a 375px
 * sobram 343px. Um serviço de 12:00–14:30 tem 6 slots e cabe lá; um contínuo de 12:00–23:00 tem 23
 * (≈1100px) e passa a scrollar, com o slot do cursor trazido à vista.
 */
const SLOT_MIN_PX = 44;

/** Altura da barra de lotação, em px. */
const BAR_PX = 40;

/** Distância que o dedo/rato tem de andar para o toque virar scrub (e não um toque simples). */
const DRAG_PX = 6;

/**
 * O serviço em cima do qual a faixa corre — a forma do `GET /reservation-services/day`.
 * Estrutural de propósito: o serviço SINTÉTICO («Horário de abertura» — o dia que corre pelo
 * horário de abertura e não por um serviço) entra aqui como qualquer outro.
 */
export interface TimelineService {
  name?: string;
  openMinute: number;
  /** O último slot COMEÇA aqui: é uma janela de seating, não de estadia. */
  closeMinute: number;
}

const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

const minuteOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Minuto do dia -> instante, no dia dado. Pelo construtor: resolve a hora de verão sozinho. */
function atMinute(day: Date, minute: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute, 0, 0);
}

/**
 * Os slots do serviço. O `closeMinute` é onde o último slot COMEÇA, logo é inclusivo:
 * 12:00–14:30 dá 6 slots (12:00…14:30) e um contínuo 12:00–23:00 dá 23.
 */
function slotsOf(service: TimelineService): number[] {
  const out: number[] = [];
  for (let m = service.openMinute; m <= service.closeMinute; m += SLOT_MIN) out.push(m);
  return out;
}

/** O maior slot que não passa do minuto dado (20:07 -> 20:00: o slot em curso, não o próximo). */
function floorSlot(slots: number[], minute: number): number {
  let out = slots[0];
  for (const m of slots) if (m <= minute) out = m;
  return out;
}

/**
 * Onde a faixa aponta quando o cursor ainda não está pousado num slot deste serviço: *agora*, se
 * for hoje e couber no serviço; senão, a abertura. Exportado para a página poder arrancar já no
 * sítio certo, em vez de piscar no início e só depois saltar.
 */
export function defaultCursorFor(day: Date, service: TimelineService): Date | null {
  const slots = slotsOf(service);
  if (slots.length === 0) return null;
  const agora = new Date();
  const hoje = startOfDay(agora).getTime() === startOfDay(day).getTime();
  const min = minuteOf(agora);
  if (hoje && min >= slots[0] && min <= slots[slots.length - 1]) {
    return atMinute(day, floorSlot(slots, min));
  }
  return atMinute(day, slots[0]);
}

/**
 * A timeline de lotação. NÃO há um seletor de hora à parte — esta faixa É o cursor de tempo: o
 * mapa por baixo mostra a sala à hora que estiver escolhida aqui.
 *
 * A ocupação é calculada no cliente, das reservas que a aba já carrega e o socket mantém vivas
 * (zero endpoints novos — a faixa mexe-se ao vivo quando entra uma reserva).
 */
export function TimelineCursor({
  service,
  tables,
  reservations,
  cursorAt,
  onCursorChange,
  dateISO,
}: {
  service: TimelineService;
  tables: Table[];
  reservations: Reservation[];
  /** A hora a que o mapa mostra a sala. */
  cursorAt: Date;
  onCursorChange: (at: Date) => void;
  /**
   * O dia que a aba está a mostrar. Opcional: por omissão a faixa corre no dia do PRÓPRIO cursor.
   * Passa-o se o dia e o cursor forem estados separados na página — sem isto, um cursor que ficou
   * no dia anterior desenhava barras a zero em silêncio, com as reservas todas do dia certo.
   */
  dateISO?: string;
}): JSX.Element {
  const config = useTenantConfig();
  // A mesma regra do servidor (`occupiedAt` em apps/api/src/modules/reservations/days.util.ts):
  // a duração e o buffer é que dizem se a mesa está ocupada. Os fallbacks são os do tenant.
  const durMs = (config.data?.reservationDurationMin ?? 90) * 60_000;
  const bufMs = (config.data?.reservationBufferMin ?? 15) * 60_000;

  const slots = useMemo(() => slotsOf(service), [service.openMinute, service.closeMinute]);

  // Em ms para os memos não recalcularem a cada scrub: o dia só muda quando o dia muda.
  const dayMs = useMemo(() => {
    const base = dateISO ? new Date(`${dateISO}T00:00:00`) : cursorAt;
    return startOfDay(Number.isNaN(base.getTime()) ? cursorAt : base).getTime();
  }, [dateISO, cursorAt]);
  const cursorMinute = useMemo(() => minuteOf(cursorAt), [cursorAt]);

  // Denominador da lotação = mesas ATIVAS. Uma mesa desativada não recebe reservas: metê-la no
  // denominador diria «metade cheio» numa sala que está cheia — a lotação mentia para baixo.
  const activeCount = useMemo(() => tables.filter((t) => t.active).length, [tables]);

  const bars = useMemo(() => {
    const day = new Date(dayMs);
    return slots.map((minute) => {
      const at = atMinute(day, minute);
      // Conta por INTERSEÇÃO do intervalo, não por hora de início: uma reserva de 20:00–22:00
      // conta às 20:00, 20:30, 21:00 e 21:30 — e não às 19:30; e uma que começou às 18:00 e
      // ainda lá está às 19:00 conta no slot das 19:00.
      const occ = occupancyOfSlot(tables, reservations, at, durMs, bufMs);
      return {
        minute,
        people: occ.people,
        busy: occ.tables,
        pct: activeCount > 0 ? Math.min(1, occ.tables / activeCount) : 0,
      };
    });
  }, [slots, tables, reservations, dayMs, durMs, bufMs, activeCount]);

  const pick = useCallback(
    (minute: number) => {
      if (minute === cursorMinute) return;
      onCursorChange(atMinute(new Date(dayMs), minute));
    },
    [cursorMinute, dayMs, onCursorChange],
  );

  // ---- o cursor endireita-se sozinho -------------------------------------------------------
  useEffect(() => {
    if (slots.length === 0) return;
    const day = new Date(dayMs);
    const noDia = startOfDay(cursorAt).getTime() === dayMs;
    if (noDia && slots.includes(cursorMinute)) return;
    // O cursor não pousa em nenhuma barra: veio de «agora» (20:07), ou o dia/serviço mudou por
    // baixo dele (o chip saltou do Almoço para o Jantar). Sem isto a faixa ficava sem cursor
    // nenhum e o mapa mostrava uma hora que não está aqui.
    const alvo =
      noDia && cursorMinute >= slots[0] && cursorMinute <= slots[slots.length - 1]
        ? atMinute(day, floorSlot(slots, cursorMinute))
        : defaultCursorFor(day, service);
    if (alvo && alvo.getTime() !== cursorAt.getTime()) onCursorChange(alvo);
  }, [slots, dayMs, cursorAt, cursorMinute, service, onCursorChange]);

  // ---- trazer o slot do cursor à vista ------------------------------------------------------
  const scroller = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const cursorRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const box = scroller.current;
    const el = cursorRef.current;
    if (!box || !el) return;
    // Só o scrollLeft desta faixa: o scrollIntoView num contentor aninhado arrasta a página atrás
    // dele e o dono perdia o mapa de vista a cada scrub.
    const alvo = el.offsetLeft + el.offsetWidth / 2 - box.clientWidth / 2;
    box.scrollTo({ left: Math.max(0, alvo), behavior: 'smooth' });
  }, [cursorMinute, slots]);

  // ---- tocar e arrastar ---------------------------------------------------------------------
  const drag = useRef<{ id: number; x: number; on: boolean } | null>(null);

  /** O slot mais próximo do dedo. Fora das pontas fica agarrado à primeira/última barra. */
  const pickAt = useCallback(
    (clientX: number) => {
      let best = -1;
      let bestDist = Infinity;
      slotRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dist = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      if (best !== -1) pick(slots[best]);
    },
    [pick, slots],
  );

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Não agarra o ponteiro já: um toque tem de continuar a poder virar scroll — da faixa (quando o
    // serviço é contínuo e não cabe) ou vertical, da página. O scrub só arranca depois de o dedo
    // andar; se o browser decidir pan antes disso, manda pointercancel e o scrub nem começa.
    drag.current = { id: e.pointerId, x: e.clientX, on: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.on) {
      if (Math.abs(e.clientX - d.x) < DRAG_PX) return;
      d.on = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    pickAt(e.clientX);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.on && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    drag.current = null;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = slots.indexOf(cursorMinute);
    const next = slots[Math.max(0, (i === -1 ? 0 : i) + (e.key === 'ArrowLeft' ? -1 : 1))];
    if (next === undefined || next === cursorMinute) return;
    e.preventDefault();
    pick(next);
  }

  // ---- ecrã ---------------------------------------------------------------------------------
  if (slots.length === 0) {
    return (
      <div className="mb-4 rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-mute">
        Sem horas para mostrar neste dia.
      </div>
    );
  }

  const noCursor = bars.find((b) => b.minute === cursorMinute);

  return (
    <section className="mb-4 rounded-xl border border-line bg-white p-3.5 shadow-card">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-[17px] font-semibold tabular-nums">{hhmm(cursorMinute)}</span>
        {service.name && <span className="text-[12px] text-ink-mute">{service.name}</span>}
        <span className="ml-auto text-[12.5px] text-ink-soft">
          <strong className="tabular-nums text-ink">{noCursor?.busy ?? 0}</strong> de{' '}
          <span className="tabular-nums">{activeCount}</span> {activeCount === 1 ? 'mesa' : 'mesas'} ·{' '}
          <strong className="tabular-nums text-ink">{noCursor?.people ?? 0}</strong>{' '}
          {noCursor?.people === 1 ? 'pessoa' : 'pessoas'}
        </span>
      </div>

      <div ref={scroller} className="-mx-1 overflow-x-auto px-1 pb-1">
        <div
          role="group"
          aria-label="Lotação por hora — toca ou arrasta para mudar a hora do mapa"
          className="flex w-max min-w-full gap-1"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
        >
          {bars.map((b, i) => {
            const isCursor = b.minute === cursorMinute;
            // A etiqueta só às horas certas (e sempre no cursor): com 23 slots, cinco dígitos em
            // cada um viram ruído — a hora do cursor está em grande, no topo.
            const label = b.minute % 60 === 0 || isCursor ? hhmm(b.minute) : '';
            return (
              <button
                key={b.minute}
                ref={(el) => {
                  slotRefs.current[i] = el;
                  if (isCursor) cursorRef.current = el;
                }}
                type="button"
                onClick={() => pick(b.minute)}
                aria-pressed={isCursor}
                aria-label={`${hhmm(b.minute)} — ${b.busy} de ${activeCount} mesas, ${b.people} ${
                  b.people === 1 ? 'pessoa' : 'pessoas'
                }`}
                style={{ flex: `1 0 ${SLOT_MIN_PX}px` }}
                className={clsx(
                  'flex select-none flex-col items-center gap-1 rounded-lg px-0.5 pb-1 pt-1.5 transition-colors',
                  'outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                  isCursor ? 'bg-brand-soft' : 'hover:bg-cream/60',
                )}
              >
                <span className="flex w-full items-end justify-center" style={{ height: BAR_PX }}>
                  {/* barra = % de mesas ATIVAS ocupadas; 2px de piso para o slot vazio continuar a
                      ser um alvo e a faixa não ficar com buracos */}
                  <span
                    className={clsx(
                      'w-full rounded-t-[3px] transition-[height]',
                      isCursor ? 'bg-brand' : 'bg-brand/35',
                    )}
                    style={{ height: Math.max(2, Math.round(b.pct * BAR_PX)) }}
                  />
                </span>
                {/* número = pessoas sentadas naquele slot */}
                <span
                  className={clsx(
                    'text-[10.5px] font-semibold leading-none tabular-nums',
                    b.people > 0 ? 'text-ink' : 'text-ink-mute',
                  )}
                >
                  {b.people}
                </span>
                <span
                  className={clsx(
                    'h-3 text-[9.5px] leading-3 tabular-nums',
                    isCursor ? 'font-semibold text-brand-ink' : 'text-ink-mute',
                  )}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
