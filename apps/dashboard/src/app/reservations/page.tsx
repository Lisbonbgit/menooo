'use client';

import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
// `Map` é aliased: o ícone da lucide tinha o mesmo nome do construtor global `Map` e ensombrava-o,
// partindo o `new Map<…>()` do agrupamento de áreas.
import { Wifi, WifiOff, Plus, CalendarOff, Check, X, UserX, Pencil, List, Map as MapIcon } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { TablesManager } from '@/components/TablesManager';
import { ReservationSettings } from '@/components/ReservationSettings';
import { ReservationFormModal } from '@/components/ReservationFormModal';
import { FloorMap } from '@/components/FloorMap';
import { TimelineCursor } from '@/components/TimelineCursor';
import { ReadinessCard, ShareCard } from './components/ReadinessCard';
import {
  useLiveReservations, useBlocks, useCreateBlock, useDeleteBlock,
  useUpdateReservationStatus, useTables, useServicesForDay,
} from '@/lib/reservations-hooks';
import type { Reservation, ReservationStatus, ServiceForDay } from '@/lib/reservation-types';

const TABS = [
  { key: 'day', label: 'Dia' },
  { key: 'tables', label: 'Mesas' },
  { key: 'settings', label: 'Definições' },
] as const;

const VIEWS = [
  { key: 'lista', label: 'Lista', Icon: List },
  { key: 'mapa', label: 'Mapa', Icon: MapIcon },
] as const;

/** Passo da grelha da timeline (min). O mapa, a faixa e a hora do modal andam todos nele. */
const SLOT_MIN = 30;

const STATUS_CHIP: Record<ReservationStatus, { label: string; dot: string; text: string }> = {
  CONFIRMED: { label: 'Confirmada', dot: 'bg-green-500', text: 'text-green-800' },
  COMPLETED: { label: 'Concluída', dot: 'bg-stone-400', text: 'text-ink-soft' },
  NO_SHOW: { label: 'Não apareceu', dot: 'bg-red-500', text: 'text-red-700' },
  CANCELLED: { label: 'Cancelada', dot: 'bg-stone-300', text: 'text-ink-mute' },
};

/** YYYY-MM-DD de hoje na timezone do browser (o servidor filtra pela tz da loja). */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

/** "HH:MM" a partir de minutos desde a meia-noite. */
function hhmmOfMinute(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Minutos desde a meia-noite de uma Date local. */
function minuteOfDate(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Date local a partir de YYYY-MM-DD + minutos desde a meia-noite (a mesma tz do todayISO). */
function dateAtMinute(dateISO: string, minute: number): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minute / 60), minute % 60, 0, 0);
}

/**
 * A hora do cursor por omissão: agora, se for hoje e dentro do serviço; senão, o início.
 *
 * Encaixada na grelha de 30 min contada a partir do `openMinute` — a mesma que a timeline
 * desenha. Sem o encaixe, um serviço que abrisse às 12:15 dava um cursor às 14:37 que não é
 * slot nenhum, e o servidor ainda o arredondaria para baixo (`minutes - minutes % 15`) ao
 * criar a reserva: o mapa dizia uma hora e a reserva nascia noutra.
 */
function defaultCursorMin(dateISO: string, service?: ServiceForDay): number {
  const open = service?.openMinute ?? 12 * 60;
  const close = service?.closeMinute ?? open;
  if (dateISO !== todayISO()) return open;
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  if (now < open || now > close) return open;
  return open + Math.floor((now - open) / SLOT_MIN) * SLOT_MIN;
}

export default function ReservationsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('day');
  const [date, setDate] = useState(todayISO());
  const [modal, setModal] = useState<{
    mode: 'create' | 'edit';
    reservation?: Reservation;
    initial?: { date?: string; time?: string; tableIds?: string[] };
  } | null>(null);

  // ---- estado partilhado pelas duas vistas: trocar de Lista para Mapa não perde o contexto ----
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('lista');
  const [pickedServiceId, setPickedServiceId] = useState<string | null>(null);
  const [pickedArea, setPickedArea] = useState<string | null | undefined>(undefined);
  // O cursor guarda o (dia, serviço) em que foi posto: sem isso, mudar de dia mantinha uma hora
  // que já não quer dizer nada — e mudar de serviço deixava o cursor fora do serviço novo.
  const [cursor, setCursor] = useState<{ key: string; min: number } | null>(null);

  const { reservations, connected } = useLiveReservations(date);
  const tablesQuery = useTables();
  const servicesQuery = useServicesForDay(date);
  const blocks = useBlocks();
  const createBlock = useCreateBlock();
  const deleteBlock = useDeleteBlock();
  const updateStatus = useUpdateReservationStatus();

  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data]);
  const services = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data]);

  // Derivados, não copiados para estado: um serviço apagado (ou um dia novo) faz a escolha cair
  // sozinha no primeiro em vez de ficar a apontar para um id que já não existe.
  const service = services.find((s) => s.id === pickedServiceId) ?? services[0];

  /** As áreas do dono, pela ordem das mesas. `null` é a área «Sem área», não «todas». */
  const areas = useMemo(() => {
    const porChave = new Map<string, string | null>();
    for (const t of tables) porChave.set(t.area ?? '', t.area ?? null);
    return [...porChave.values()];
  }, [tables]);
  const area = pickedArea !== undefined && areas.some((a) => a === pickedArea)
    ? pickedArea
    : (areas[0] ?? null);

  const cursorKey = `${date}|${service?.id ?? '-'}`;
  const cursorMin = cursor?.key === cursorKey ? cursor.min : defaultCursorMin(date, service);
  const cursorAt = useMemo(() => dateAtMinute(date, cursorMin), [date, cursorMin]);

  /** Tocar numa mesa livre: a mesa e a hora do cursor já preenchidas — o §6 do spec. */
  function pickTable(tableId: string) {
    setModal({
      mode: 'create',
      initial: { date, time: hhmmOfMinute(cursorMin), tableIds: [tableId] },
    });
  }

  const todayBlock = (blocks.data ?? []).find((b) => b.date === date);
  const confirmed = reservations.filter((r) => r.status === 'CONFIRMED');
  const covers = confirmed.reduce((sum, r) => sum + r.partySize, 0);

  async function setStatus(r: Reservation, status: ReservationStatus) {
    if (status === 'CANCELLED' && !confirm(`Cancelar a reserva de ${r.customerName}?`)) return;
    try {
      await updateStatus.mutateAsync({ id: r.id, status });
      toast.success('Reserva atualizada');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível atualizar');
    }
  }

  async function toggleTodayBlock() {
    try {
      if (todayBlock) {
        await deleteBlock.mutateAsync(todayBlock.id);
        toast.success('Reservas reabertas neste dia');
      } else {
        await createBlock.mutateAsync({ date, reason: 'Pausado no painel' });
        toast.success('Reservas pausadas neste dia');
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível mudar o bloqueio');
    }
  }

  return (
    <AppShell
      title="Reservas"
      actions={
        tab === 'day' ? (
          <>
            <span
              className={clsx(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold',
                connected ? 'bg-green-100 text-green-800' : 'bg-stone-200 text-stone-500',
              )}
            >
              {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
              {connected ? 'Ao vivo' : 'A ligar…'}
            </span>
            <button
              onClick={toggleTodayBlock}
              className={clsx(
                'flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-medium shadow-card transition-colors',
                todayBlock
                  ? 'border-red-200 bg-red-50 text-red-800 hover:border-red-300'
                  : 'border-line bg-white hover:border-brand/40',
              )}
            >
              <CalendarOff size={15} /> {todayBlock ? 'Reabrir este dia' : 'Pausar este dia'}
            </button>
            <button
              onClick={() => setModal({ mode: 'create' })}
              className="flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-[13px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
            >
              <Plus size={15} /> Reserva
            </button>
          </>
        ) : null
      }
    >
      {/* prontidão + interruptor: fora dos separadores porque o estado de "publicado ao
          público" vale para a aba toda, e é o que o dono vem cá confirmar */}
      <ReadinessCard onGoTables={() => setTab('tables')} onGoSettings={() => setTab('settings')} />

      {/* separadores */}
      <div className="mb-6 flex gap-1.5 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              '-mb-px border-b-2 px-3.5 py-2 text-[13px] font-medium transition-colors',
              tab === t.key
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'day' && (
        <>
          {/* o aviso de "sem mesas" saiu daqui: o bloco de prontidão, logo acima, di-lo
              melhor (mesas RESERVÁVEIS, não mesas) e trava o interruptor */}
          {todayBlock && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
              <strong>Reservas pausadas neste dia.</strong> Os clientes não conseguem reservar
              online; as reservas já confirmadas mantêm-se.
            </div>
          )}

          <div className="mb-5 flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayISO())}
              className="rounded-xl border border-line bg-white px-3.5 py-2 text-[13.5px] shadow-card outline-none focus:border-brand"
            />
            <button
              onClick={() => setDate(todayISO())}
              className="text-[12.5px] font-medium text-brand hover:underline"
            >
              Hoje
            </button>

            {/* o switcher fica ao lado do dia porque o dia é partilhado: é a mesma reserva,
                vista de duas maneiras */}
            <div className="flex gap-0.5 rounded-xl border border-line bg-white p-0.5 shadow-card">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  aria-pressed={view === v.key}
                  className={clsx(
                    'flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                    view === v.key
                      ? 'bg-brand text-white'
                      : 'text-ink-soft hover:text-ink',
                  )}
                >
                  <v.Icon size={14} /> {v.label}
                </button>
              ))}
            </div>

            <span className="ml-auto flex gap-4 text-[12.5px] text-ink-soft">
              <span>
                <strong className="tabular-nums text-ink">{confirmed.length}</strong> reservas
              </span>
              <span>
                <strong className="tabular-nums text-ink">{covers}</strong> pessoas
              </span>
            </span>
          </div>

          {view === 'mapa' ? (
            <div className="space-y-4">
              {/* chips só quando há escolha a fazer: um serviço só não é uma escolha (§8 do spec) */}
              {services.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {services.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setPickedServiceId(s.id)}
                      className={clsx(
                        'rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                        s.id === service?.id
                          ? 'border-brand bg-brand text-white'
                          : 'border-line bg-white text-ink-soft hover:border-brand/40',
                      )}
                    >
                      {s.name}{' '}
                      <span className="tabular-nums opacity-70">
                        {hhmmOfMinute(s.openMinute)}–{hhmmOfMinute(s.closeMinute)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {service ? (
                <TimelineCursor
                  service={service}
                  // Só as mesas da área VISÍVEL (spec §7): a barra é a lotação da sala que estás
                  // a ver. Passar todas dava um denominador de outra área e barras que não batiam
                  // com o mapa por baixo. As reservas ficam todas — o occupancyOfSlot só conta as
                  // que caem nestas mesas.
                  tables={tables.filter((t) => (t.area ?? null) === area)}
                  reservations={reservations}
                  cursorAt={cursorAt}
                  onCursorChange={(d: Date) => setCursor({ key: cursorKey, min: minuteOfDate(d) })}
                  // o dia e o cursor são estados separados aqui: sem o dateISO, um cursor pousado
                  // no dia anterior desenhava barras a zero com as reservas do dia certo
                  dateISO={date}
                />
              ) : (
                // sem serviço E sem horário de abertura: o servidor não devolve sequer o
                // sintético, logo não há slots para desenhar. O mapa fica — as mesas existem.
                <div className="rounded-xl border border-dashed border-line px-4 py-3 text-[12.5px] text-ink-mute">
                  Este dia não tem serviços nem horário de abertura, por isso não há horas para
                  mostrar. O mapa aqui em baixo continua a ser a tua sala.
                </div>
              )}

              <FloorMap
                tables={tables}
                reservations={reservations}
                areas={areas}
                area={area}
                onAreaChange={setPickedArea}
                cursorAt={cursorAt}
                onPickTable={pickTable}
              />
            </div>
          ) : reservations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-12 text-center">
              <p className="text-[13px] text-ink-mute">Sem reservas neste dia.</p>
            </div>
          ) : (
            <ul className="stagger flex flex-col gap-2.5">
              {reservations.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-white px-4 py-3 shadow-card"
                >
                  <span className="font-display text-[17px] font-semibold tabular-nums">
                    {hhmm(r.startsAt)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[13.5px] font-medium">{r.customerName}</span>
                    <span className="ml-2 text-[12px] text-ink-mute">
                      {r.partySize} {r.partySize === 1 ? 'pessoa' : 'pessoas'}
                      {r.tables.length > 0 && ` · ${r.tables.map((t) => t.table.name).join(' + ')}`}
                      {r.customerPhone && ` · ${r.customerPhone}`}
                      {r.source === 'MANUAL' && ' · manual'}
                    </span>
                    {r.notes && (
                      <span className="mt-0.5 block text-[11.5px] italic text-ink-mute">“{r.notes}”</span>
                    )}
                  </span>
                  <span
                    className={clsx(
                      'flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide',
                      STATUS_CHIP[r.status].text,
                    )}
                  >
                    <span className={clsx('h-1.5 w-1.5 rounded-full', STATUS_CHIP[r.status].dot)} />
                    {STATUS_CHIP[r.status].label}
                  </span>
                  {r.status === 'CONFIRMED' && (
                    <span className="flex gap-1.5">
                      <button
                        onClick={() => setModal({ mode: 'edit', reservation: r })}
                        title="Editar"
                        className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-brand/40 hover:text-brand-dark"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setStatus(r, 'COMPLETED')}
                        title="Concluída"
                        className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-green-400 hover:text-green-700"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => setStatus(r, 'NO_SHOW')}
                        title="Não apareceu"
                        className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-amber-400 hover:text-amber-700"
                      >
                        <UserX size={14} />
                      </button>
                      <button
                        onClick={() => setStatus(r, 'CANCELLED')}
                        title="Cancelar"
                        className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-red-400 hover:text-red-700"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === 'tables' && <TablesManager />}
      {tab === 'settings' && (
        <div className="space-y-5">
          <ReservationSettings />
          <ShareCard />
        </div>
      )}

      {modal && (
        <ReservationFormModal
          mode={modal.mode}
          reservation={modal.reservation}
          initial={modal.initial}
          onClose={() => setModal(null)}
        />
      )}
    </AppShell>
  );
}
