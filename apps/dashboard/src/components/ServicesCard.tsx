'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useHours, type OpeningHour } from '@/lib/settings-hooks';
import type { ReservationService } from '@/lib/reservation-types';

/**
 * Serviços de reserva («Almoço», «Jantar») — o CRUD que sucedeu às janelas por dia da semana.
 *
 * Este módulo é FOLHA de propósito: o `ReservationSettings` importa-o (é ele que o desenha
 * dentro do seu cartão) e o `ReadinessCard` importa-lhe o `effectiveHours`. Se daqui se
 * importasse o `serverError`/`SettingsCard` do ReservationSettings fechava-se um ciclo entre
 * os dois módulos — daí o `serverError` local (o ReservationFormModal já tem o seu, é o
 * padrão do repo).
 */

// ==========================================================================
// Helpers partilhados com o ReadinessCard
// ==========================================================================

export const WEEKDAYS: { value: number; label: string; short: string }[] = [
  { value: 1, label: 'Segunda', short: 'Seg' },
  { value: 2, label: 'Terça', short: 'Ter' },
  { value: 3, label: 'Quarta', short: 'Qua' },
  { value: 4, label: 'Quinta', short: 'Qui' },
  { value: 5, label: 'Sexta', short: 'Sex' },
  { value: 6, label: 'Sábado', short: 'Sáb' },
  { value: 0, label: 'Domingo', short: 'Dom' },
];

export const hhmm = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const toMin = (s: string): number => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

const nomeDoDia = (weekday: number): string =>
  WEEKDAYS.find((w) => w.value === weekday)?.label ?? 'dia';

/** Uma faixa de seating, já com a proveniência: um serviço com nome, ou o horário de abertura. */
interface RawWindow {
  openMinute: number;
  closeMinute: number;
  name: string;
}

/**
 * Espelha o `windowsOf` do servidor (`apps/api/src/modules/reservations/services.util.ts`), e
 * tem de continuar a espelhá-lo: os serviços do dia ou, quando não há nenhum, o horário de
 * abertura com `closeMinute − 60`. Se as duas contas divergirem, o painel mente ao dono sobre
 * as horas que a loja está mesmo a publicar.
 *
 * O nome do sintético é o mesmo que o `listServicesForDay` devolve — «Horário de abertura».
 */
function windowsOfWeekday(
  services: ReservationService[],
  hours: OpeningHour[],
  weekday: number,
): RawWindow[] {
  const own = services
    .filter((s) => s.weekdays.includes(weekday))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.openMinute - b.openMinute);
  if (own.length > 0) {
    return own.map((s) => ({ openMinute: s.openMinute, closeMinute: s.closeMinute, name: s.name }));
  }
  const oh = hours.find((h) => h.weekday === weekday);
  return oh
    ? [{ openMinute: oh.openMinute, closeMinute: oh.closeMinute - 60, name: 'Horário de abertura' }]
    : [];
}

/** Primeira e última hora a que se consegue MESMO reservar numa faixa (grelha de 30 em 30). */
interface Range {
  first: number;
  last: number;
  name: string;
}

/**
 * As faixas efetivas de um weekday — o `windowsOf` do servidor passado pela grelha do
 * `slotMinutes` (slots.util): arranca no múltiplo de 30 a seguir à abertura e vai até ao
 * fecho, inclusive. Faixa curta demais para um slot não conta.
 */
function rangesOfWeekday(
  services: ReservationService[],
  hours: OpeningHour[],
  weekday: number,
): Range[] {
  const out: Range[] = [];
  for (const w of windowsOfWeekday(services, hours, weekday)) {
    const first = Math.ceil(w.openMinute / 30) * 30;
    if (first > w.closeMinute) continue;
    out.push({ first, last: first + Math.floor((w.closeMinute - first) / 30) * 30, name: w.name });
  }
  return out;
}

export interface DayHours {
  weekday: number;
  short: string;
  ranges: Range[];
  /** 'hours' = o dia não tem serviços e corre pelo horário de abertura (o fallback do §5). */
  source: 'service' | 'hours';
}

/** O que o cliente vai mesmo ver, dia a dia, com a proveniência à vista. */
export function effectiveHours(
  services: ReservationService[],
  hours: OpeningHour[],
): DayHours[] {
  const out: DayHours[] = [];
  for (const w of WEEKDAYS) {
    const temServicos = services.some((s) => s.weekdays.includes(w.value));
    const ranges = rangesOfWeekday(services, hours, w.value);
    if (ranges.length === 0) continue;
    out.push({
      weekday: w.value,
      short: w.short,
      ranges,
      source: temServicos ? 'service' : 'hours',
    });
  }
  return out;
}

/** Nest devolve `message` como string ou array de strings — mostramos sempre a do servidor. */
function serverError(e: any, fallback: string): string {
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg) && msg.length > 0) return msg.join(' ');
  if (typeof msg === 'string' && msg) return msg;
  return fallback;
}

// ==========================================================================
// Dados
// ==========================================================================

/**
 * Os hooks dos serviços vivem aqui e não no `reservations-hooks.ts` só porque este ficheiro é
 * o dono do CRUD. A queryKey é a mesma família do `/day` (`['reservation-services', …]`), logo
 * a invalidação por prefixo abaixo refresca também a timeline e o mapa.
 */
const SERVICES_KEY = ['reservation-services'];

export function useServices() {
  return useQuery({
    queryKey: SERVICES_KEY,
    queryFn: async () => (await api.get<ReservationService[]>('/reservation-services')).data,
  });
}

/** Corpo do POST/PATCH. Todas as chaves SEMPRE presentes — ver a nota do `submit`. */
interface ServicePayload {
  name: string;
  weekdays: number[];
  openMinute: number;
  closeMinute: number;
}

function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ServicePayload) =>
      (await api.post<ReservationService>('/reservation-services', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVICES_KEY }),
  });
}

function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: ServicePayload & { id: string }) =>
      (await api.patch<ReservationService>(`/reservation-services/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVICES_KEY }),
  });
}

function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/reservation-services/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVICES_KEY }),
  });
}

// ==========================================================================
// A consequência real de apagar
// ==========================================================================

/** Os dias que ficam SEM serviço nenhum se este for apagado. */
export function orphanWeekdays(target: ReservationService, all: ReservationService[]): number[] {
  return target.weekdays.filter(
    (d) => !all.some((s) => s.id !== target.id && s.weekdays.includes(d)),
  );
}

interface Consequencia {
  weekday: number;
  /** As horas que o dia passa a ter. Vazio = o dia fica mesmo sem horas para reservar. */
  fallback: Range[];
}

/**
 * Apagar o último serviço de um dia NÃO fecha o dia: ABRE-O.
 *
 * Sem serviços no weekday, o `windowsOf` cai no `OpeningHour − 60` e um almoço de 12:00–14:30
 * vira 12:00–22:00 — incluindo as 17:00 com a cozinha fechada, que é o próprio problema que os
 * serviços existem para resolver. O aviso tem de dizer isto com as horas concretas, senão
 * «Apagar o Almoço» faz o oposto do que o dono quer, em silêncio.
 *
 * A exceção honesta: um dia sem `OpeningHour` não tem fallback nenhum — aí o dia fecha mesmo,
 * e dizer-lhe que «passa a seguir o horário de abertura» seria a mentira simétrica.
 */
function consequenciasDeApagar(
  target: ReservationService,
  all: ReservationService[],
  hours: OpeningHour[],
): Consequencia[] {
  return orphanWeekdays(target, all).map((weekday) => ({
    weekday,
    // Sem outros serviços neste dia, o fallback é o que o servidor devolveria: só o horário.
    fallback: rangesOfWeekday([], hours, weekday),
  }));
}

// ==========================================================================
// O cartão
// ==========================================================================

interface Draft {
  /** null = serviço novo. */
  id: string | null;
  name: string;
  weekdays: number[];
  open: string;
  close: string;
}

const NOVO = (): Draft => ({ id: null, name: '', weekdays: [], open: '', close: '' });

const inputCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-brand';

/**
 * O corpo do cartão dos serviços. Sem casca própria: quem o desenha (o `ReservationSettings`)
 * é que o embrulha no `SettingsCard`, e assim não é preciso importar nada de lá para aqui.
 */
export function ServicesCard({ onGoBlockedDays }: { onGoBlockedDays: () => void }): JSX.Element {
  const services = useServices();
  const hours = useHours();
  const createService = useCreateService();
  const updateService = useUpdateService();
  const deleteService = useDeleteService();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ReservationService | null>(null);

  const lista = services.data ?? [];

  async function submit() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error('Dá um nome ao serviço (ex.: Almoço).');
      return;
    }
    if (draft.weekdays.length === 0) {
      toast.error('Escolhe pelo menos um dia da semana.');
      return;
    }
    if (!draft.open || !draft.close) {
      toast.error('Preenche a primeira e a última hora de reserva.');
      return;
    }
    const openMinute = toMin(draft.open);
    const closeMinute = toMin(draft.close);
    if (closeMinute <= openMinute) {
      toast.error('A última hora tem de ser depois da primeira.');
      return;
    }
    if (closeMinute > 1380) {
      toast.error('A última hora de reserva não pode passar das 23:00.');
      return;
    }
    // ARMADILHA (3ª vez neste projeto): uma chave a `undefined` some no JSON.stringify, o
    // servidor mantém o valor antigo e a UI diz «guardado». Por isso o corpo leva SEMPRE as
    // quatro chaves, mesmo em edição — o `updateService` do servidor faz o merge campo a campo.
    const body: ServicePayload = {
      name,
      weekdays: [...draft.weekdays].sort((a, b) => a - b),
      openMinute,
      closeMinute,
    };
    setSaving(true);
    try {
      if (draft.id) {
        await updateService.mutateAsync({ id: draft.id, ...body });
        toast.success('Serviço guardado');
      } else {
        await createService.mutateAsync(body);
        toast.success('Serviço criado');
      }
      setDraft(null);
    } catch (err) {
      // A sobreposição no mesmo dia vem daqui com a mensagem do servidor («sobrepõe-se a
      // "Jantar"…») — mostrá-la crua é melhor do que um genérico nosso.
      toast.error(serverError(err, 'Não foi possível guardar o serviço.'));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteService.mutateAsync(pendingDelete.id);
      toast.success('Serviço apagado');
      setPendingDelete(null);
    } catch (err) {
      toast.error(serverError(err, 'Não foi possível apagar o serviço.'));
    }
  }

  return (
    <div className="space-y-3">
      {services.isLoading ? (
        <p className="text-[12.5px] text-ink-mute">A carregar serviços…</p>
      ) : lista.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-mute">
          Sem serviços, todos os dias seguem o teu <strong>horário de abertura</strong> — a última
          reserva 1h antes de fechares. Se fechas a meio da tarde, isso deixa reservar à hora em que
          a cozinha está fechada. Cria o Almoço e o Jantar para mandares nas horas.
        </p>
      ) : (
        <ul className="space-y-2">
          {lista.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium">{s.name}</p>
                <p className="text-[11.5px] text-ink-mute">
                  <span className="tabular-nums">
                    {hhmm(s.openMinute)}–{hhmm(s.closeMinute)}
                  </span>
                  {' · '}
                  {WEEKDAYS.filter((w) => s.weekdays.includes(w.value))
                    .map((w) => w.short)
                    .join(', ')}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      id: s.id,
                      name: s.name,
                      weekdays: [...s.weekdays],
                      open: hhmm(s.openMinute),
                      close: hhmm(s.closeMinute),
                    })
                  }
                  aria-label={`Editar ${s.name}`}
                  className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-brand/40 hover:text-brand-dark"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(s)}
                  aria-label={`Apagar ${s.name}`}
                  className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-red-400 hover:text-red-700"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div className="space-y-3 rounded-xl border border-brand/30 bg-cream/40 p-3.5">
          <div className="space-y-1">
            <label className="block text-[12.5px] font-medium text-ink-soft">Nome</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Ex.: Almoço"
              maxLength={60}
              className={inputCls}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[12.5px] font-medium text-ink-soft">Dias</label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w) => {
                const on = draft.weekdays.includes(w.value);
                return (
                  <button
                    key={w.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        weekdays: on
                          ? draft.weekdays.filter((d) => d !== w.value)
                          : [...draft.weekdays, w.value],
                      })
                    }
                    className={
                      'rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ' +
                      (on
                        ? 'border-brand bg-brand text-white'
                        : 'border-line bg-white text-ink-soft hover:border-brand/40')
                    }
                  >
                    {w.short}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="block text-[12.5px] font-medium text-ink-soft">
                Primeira reserva
              </label>
              <input
                type="time"
                value={draft.open}
                onChange={(e) => setDraft({ ...draft, open: e.target.value })}
                className="rounded-lg border border-line px-2 py-1.5 text-[12.5px]"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[12.5px] font-medium text-ink-soft">
                Última reserva
              </label>
              <input
                type="time"
                max="23:00"
                value={draft.close}
                onChange={(e) => setDraft({ ...draft, close: e.target.value })}
                className="rounded-lg border border-line px-2 py-1.5 text-[12.5px]"
              />
            </div>
          </div>
          <p className="text-[11.5px] text-ink-mute">
            É a janela em que se <strong>senta</strong>, não a da estadia: a última reserva é às{' '}
            {draft.close || '—'}, e essa mesa fica ocupada o tempo da duração que definiste acima.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="rounded-xl bg-brand px-4 py-2 text-[13px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {saving ? 'A guardar…' : draft.id ? 'Guardar serviço' : 'Criar serviço'}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-xl border border-line bg-white px-4 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-brand/40"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDraft(NOVO())}
          className="flex items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 py-2 text-[13px] font-medium text-ink-soft shadow-card transition-colors hover:border-brand/40 hover:text-brand-dark"
        >
          <Plus size={14} /> Adicionar serviço
        </button>
      )}

      {pendingDelete && (
        <DeleteDialog
          service={pendingDelete}
          consequencias={consequenciasDeApagar(pendingDelete, lista, hours.data ?? [])}
          deleting={deleteService.isPending}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
          onGoBlockedDays={() => {
            setPendingDelete(null);
            onGoBlockedDays();
          }}
        />
      )}
    </div>
  );
}

/** O aviso que diz a consequência REAL de apagar, com as horas concretas. */
function DeleteDialog({
  service,
  consequencias,
  deleting,
  onConfirm,
  onCancel,
  onGoBlockedDays,
}: {
  service: ReservationService;
  consequencias: Consequencia[];
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onGoBlockedDays: () => void;
}): JSX.Element {
  // Dias que ficam órfãos MAS têm horário: são os que abrem em vez de fechar — a razão de
  // este diálogo existir e de oferecer o bloqueio do dia.
  const abrem = consequencias.filter((c) => c.fallback.length > 0);
  const fecham = consequencias.filter((c) => c.fallback.length === 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/60 p-4 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Apagar o serviço ${service.name}`}
        className="animate-fade-up max-h-[88vh] w-full max-w-md overflow-y-auto rounded-3xl bg-paper p-6 shadow-pop"
      >
        <div className="flex items-start gap-3">
          <span className={consequencias.length > 0 ? 'mt-0.5 text-amber-600' : 'mt-0.5 text-ink-mute'}>
            <AlertTriangle size={17} />
          </span>
          <div>
            <h3 className="font-display text-[16px] font-semibold leading-tight">
              Apagar «{service.name}»?
            </h3>
            {consequencias.length === 0 && (
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-mute">
                Os dias deste serviço continuam cobertos por outros serviços — as horas de reserva
                não mudam.
              </p>
            )}
          </div>
        </div>

        {abrem.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            <p className="text-[12.5px] font-semibold text-amber-900">
              Atenção: isto não fecha esses dias — abre-os.
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {abrem.map((c) => (
                <li key={c.weekday} className="text-[12px] leading-relaxed text-amber-900">
                  Sem serviços à <strong>{nomeDoDia(c.weekday).toLowerCase()}</strong>, as reservas
                  passam a seguir o teu horário de abertura:{' '}
                  <strong className="tabular-nums">
                    {c.fallback.map((r) => `${hhmm(r.first)}–${hhmm(r.last)}`).join(' · ')}
                  </strong>
                  , incluindo as horas em que a cozinha está fechada.
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] leading-relaxed text-amber-900">
              Queres antes fechar o dia? Os <strong>dias bloqueados</strong> são por data — bloqueia
              lá as datas concretas em que não queres reservas.
            </p>
            <button
              type="button"
              onClick={onGoBlockedDays}
              className="mt-1.5 text-[11.5px] font-semibold text-amber-900 underline"
            >
              Ir a Dias bloqueados
            </button>
          </div>
        )}

        {fecham.length > 0 && (
          <div className="mt-3 rounded-xl border border-line bg-cream/50 px-3.5 py-3">
            <ul className="space-y-1">
              {fecham.map((c) => (
                <li key={c.weekday} className="text-[12px] leading-relaxed text-ink-soft">
                  À <strong>{nomeDoDia(c.weekday).toLowerCase()}</strong> deixa de haver horas para
                  reservar: não tens horário de abertura nesse dia, logo não há nada onde cair.
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-mute">
          As reservas já confirmadas mantêm-se — isto só muda as horas que passam a ser oferecidas.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-xl bg-red-600 px-4 py-2 text-[13px] font-semibold text-white shadow-card transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {deleting ? 'A apagar…' : 'Apagar serviço'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-line bg-white px-4 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-brand/40"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
