'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowUp, CalendarClock, Clock, CalendarOff, Trash2 } from 'lucide-react';
import {
  useTenantConfig,
  useUpdateTenantConfig,
  useWindows,
  useSetWindows,
  useBlocks,
  useCreateBlock,
  useDeleteBlock,
} from '@/lib/reservations-hooks';
import type { ReservationConfig, ReservationWindow } from '@/lib/reservation-types';

const inputCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-brand';

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
];

const toHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/** Nest devolve `message` como string ou array de strings — mostramos sempre a do servidor. */
export function serverError(e: any, fallback: string): string {
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg) && msg.length > 0) return msg.join(' ');
  if (typeof msg === 'string' && msg) return msg;
  return fallback;
}

interface WindowSlot {
  open: string;
  close: string;
}
const EMPTY_SLOTS = (): [WindowSlot, WindowSlot] => [
  { open: '', close: '' },
  { open: '', close: '' },
];

/** Definições de reservas: online (regras gerais), janelas por dia da semana, dias bloqueados. */
export function ReservationSettings(): JSX.Element {
  return (
    <div className="stagger space-y-5">
      <OnlineConfigCard />
      <WindowsCard />
      <BlockedDaysCard />
    </div>
  );
}

// ==========================================================================
// Bloco 1 — Reservas online
// ==========================================================================

/**
 * O interruptor NÃO entra neste form. Este cartão copia a config para estado local e o
 * `save` só envia o que mudou: com o toggle aqui dentro, ligar as reservas no topo da
 * página deixava este `form` obsoleto e o próximo «Guardar» voltava a desligá-las em
 * silêncio. Fonte única = o bloco de prontidão (ReadinessCard).
 */
interface ConfigForm {
  reservationDurationMin: string;
  reservationBufferMin: string;
  reservationMinNoticeMin: string;
  reservationMaxAdvanceDays: string;
  reservationMaxPartySize: string;
}

const CONFIG_DEFAULTS: ConfigForm = {
  reservationDurationMin: '90',
  reservationBufferMin: '15',
  reservationMinNoticeMin: '0',
  reservationMaxAdvanceDays: '30',
  reservationMaxPartySize: '12',
};

function OnlineConfigCard() {
  const config = useTenantConfig();
  const updateConfig = useUpdateTenantConfig();
  const [form, setForm] = useState<ConfigForm>(CONFIG_DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!config.data) return;
    setForm({
      reservationDurationMin: String(config.data.reservationDurationMin),
      reservationBufferMin: String(config.data.reservationBufferMin),
      reservationMinNoticeMin: String(config.data.reservationMinNoticeMin),
      reservationMaxAdvanceDays: String(config.data.reservationMaxAdvanceDays),
      reservationMaxPartySize: String(config.data.reservationMaxPartySize),
    });
  }, [config.data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!config.data) return;
    const patch: Partial<ReservationConfig> = {};
    const numFields: Exclude<keyof ReservationConfig, 'reservationsEnabled'>[] = [
      'reservationDurationMin',
      'reservationBufferMin',
      'reservationMinNoticeMin',
      'reservationMaxAdvanceDays',
      'reservationMaxPartySize',
    ];
    for (const key of numFields) {
      const value = Number(form[key]);
      if (value !== config.data[key]) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      toast.info('Sem alterações a guardar.');
      return;
    }
    setSaving(true);
    try {
      await updateConfig.mutateAsync(patch);
      toast.success('Definições de reservas guardadas');
    } catch (err: any) {
      toast.error(serverError(err, 'Não foi possível guardar as definições.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      icon={<CalendarClock size={17} />}
      kicker="Reservas"
      title="Reservas online"
      desc="Regras gerais que os clientes seguem ao reservar na tua loja."
    >
      <form onSubmit={save} className="space-y-4">
        {/* Estado lido diretamente da query (nunca do `form`): sem estado local, não há
            nada que possa ficar obsoleto e desligar as reservas no próximo «Guardar». */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-cream/40 px-3.5 py-3">
          <div>
            <p className="flex items-center gap-2 text-[13.5px] font-medium">
              Aceitar reservas online
              <span
                className={
                  'rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ' +
                  (config.data?.reservationsEnabled
                    ? 'bg-green-100 text-green-800'
                    : 'bg-stone-200 text-stone-600')
                }
              >
                {config.data?.reservationsEnabled ? 'Ligadas' : 'Desligadas'}
              </span>
            </p>
            <p className="text-[11.5px] text-ink-mute">
              O interruptor está no bloco de prontidão, no topo desta página.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] font-medium text-ink-soft shadow-card transition-colors hover:border-brand/40 hover:text-brand-dark"
          >
            <ArrowUp size={13} /> Ir ao interruptor
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumField
            label="Duração (min)"
            min={30}
            max={480}
            value={form.reservationDurationMin}
            onChange={(v) => setForm((f) => ({ ...f, reservationDurationMin: v }))}
          />
          <NumField
            label="Buffer entre reservas (min)"
            min={0}
            max={120}
            help="tempo para limpar e voltar a pôr a mesa"
            value={form.reservationBufferMin}
            onChange={(v) => setForm((f) => ({ ...f, reservationBufferMin: v }))}
          />
          <NumField
            label="Antecedência mínima (min)"
            min={0}
            max={2880}
            value={form.reservationMinNoticeMin}
            onChange={(v) => setForm((f) => ({ ...f, reservationMinNoticeMin: v }))}
          />
          <NumField
            label="Antecedência máxima (dias)"
            min={1}
            max={90}
            value={form.reservationMaxAdvanceDays}
            onChange={(v) => setForm((f) => ({ ...f, reservationMaxAdvanceDays: v }))}
          />
          <NumField
            label="Grupo máximo online"
            min={1}
            max={50}
            help="grupos maiores são encaminhados para o telefone"
            value={form.reservationMaxPartySize}
            onChange={(v) => setForm((f) => ({ ...f, reservationMaxPartySize: v }))}
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-brand px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          {saving ? 'A guardar…' : 'Guardar'}
        </button>
      </form>
    </SettingsCard>
  );
}

// ==========================================================================
// Bloco 2 — Janelas de reserva
// ==========================================================================

function WindowsCard() {
  const windows = useWindows();
  const setWindows = useSetWindows();
  const [rows, setRows] = useState<Record<number, [WindowSlot, WindowSlot]>>(() => {
    const init: Record<number, [WindowSlot, WindowSlot]> = {};
    for (const w of WEEKDAYS) init[w.value] = EMPTY_SLOTS();
    return init;
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!windows.data) return;
    const next: Record<number, [WindowSlot, WindowSlot]> = {};
    for (const w of WEEKDAYS) next[w.value] = EMPTY_SLOTS();
    for (const win of windows.data) {
      const slots = next[win.weekday] ?? (next[win.weekday] = EMPTY_SLOTS());
      const idx = slots.findIndex((s) => !s.open && !s.close);
      if (idx !== -1) slots[idx] = { open: toHHMM(win.openMinute), close: toHHMM(win.closeMinute) };
    }
    setRows(next);
  }, [windows.data]);

  function setSlot(weekday: number, idx: 0 | 1, field: 'open' | 'close', value: string) {
    setRows((prev) => {
      const slots: [WindowSlot, WindowSlot] = [...(prev[weekday] ?? EMPTY_SLOTS())] as [
        WindowSlot,
        WindowSlot,
      ];
      slots[idx] = { ...slots[idx], [field]: value };
      return { ...prev, [weekday]: slots };
    });
  }

  async function save() {
    const payload: ReservationWindow[] = [];
    for (const w of WEEKDAYS) {
      for (const slot of rows[w.value] ?? []) {
        const hasOpen = slot.open.trim() !== '';
        const hasClose = slot.close.trim() !== '';
        if (!hasOpen && !hasClose) continue;
        if (!hasOpen || !hasClose) {
          toast.error(`${w.label}: preenche a abertura e o fecho da janela.`);
          return;
        }
        const openMinute = toMin(slot.open);
        const closeMinute = toMin(slot.close);
        if (closeMinute <= openMinute) {
          toast.error(`${w.label}: o fecho tem de ser depois da abertura.`);
          return;
        }
        payload.push({ weekday: w.value, openMinute, closeMinute });
      }
    }
    setSaving(true);
    try {
      await setWindows.mutateAsync(payload);
      toast.success('Janelas guardadas');
    } catch (err: any) {
      toast.error(serverError(err, 'Não foi possível guardar as janelas.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      icon={<Clock size={17} />}
      kicker="Reservas"
      title="Janelas de reserva"
      desc="Vazio usa o teu horário de abertura (última reserva 1h antes de fechar). Até 2 janelas por dia — fecho no máximo às 23:00."
    >
      <div className="space-y-2">
        {WEEKDAYS.map((w) => (
          <div
            key={w.value}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2.5"
          >
            <span className="w-20 shrink-0 text-[12.5px] font-medium">{w.label}</span>
            {[0, 1].map((idx) => {
              const slot = (rows[w.value] ?? EMPTY_SLOTS())[idx];
              return (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    type="time"
                    value={slot.open}
                    onChange={(e) => setSlot(w.value, idx as 0 | 1, 'open', e.target.value)}
                    className="rounded-lg border border-line px-2 py-1 text-[12.5px]"
                  />
                  <span className="text-ink-mute">—</span>
                  <input
                    type="time"
                    max="23:00"
                    value={slot.close}
                    onChange={(e) => setSlot(w.value, idx as 0 | 1, 'close', e.target.value)}
                    className="rounded-lg border border-line px-2 py-1 text-[12.5px]"
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="mt-4 rounded-xl bg-brand px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:opacity-60"
      >
        {saving ? 'A guardar…' : 'Guardar janelas'}
      </button>
    </SettingsCard>
  );
}

// ==========================================================================
// Bloco 3 — Dias bloqueados
// ==========================================================================

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function BlockedDaysCard() {
  const blocks = useBlocks();
  const createBlock = useCreateBlock();
  const deleteBlock = useDeleteBlock();
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const sorted = [...(blocks.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  async function addBlock() {
    if (!date) return;
    setSaving(true);
    try {
      await createBlock.mutateAsync({ date, reason: reason.trim() || undefined });
      toast.success('Dia bloqueado');
      setReason('');
    } catch (err: any) {
      const status = (err as any)?.response?.status;
      toast.error(
        serverError(err, status === 409 ? 'Esse dia já está bloqueado.' : 'Não foi possível bloquear o dia.'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeBlock(id: string) {
    try {
      await deleteBlock.mutateAsync(id);
      toast.success('Dia reaberto');
    } catch (err: any) {
      toast.error(serverError(err, 'Não foi possível desbloquear o dia.'));
    }
  }

  return (
    <SettingsCard
      icon={<CalendarOff size={17} />}
      kicker="Reservas"
      title="Dias bloqueados"
      desc="Nesses dias os clientes não conseguem reservar online; as reservas já confirmadas mantêm-se."
    >
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="block text-[12.5px] font-medium text-ink-soft">Data</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-brand"
          />
        </div>
        <div className="min-w-40 flex-1 space-y-1">
          <label className="block text-[12.5px] font-medium text-ink-soft">Motivo (opcional)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: feriado, evento privado"
            className={inputCls}
          />
        </div>
        <button
          onClick={addBlock}
          disabled={saving}
          className="rounded-xl bg-brand px-4 py-2.5 text-[13px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          Bloquear dia
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-[12.5px] text-ink-mute">Sem dias bloqueados.</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5"
            >
              <span className="text-[13px]">
                <strong className="font-semibold">
                  {new Date(`${b.date}T00:00:00`).toLocaleDateString('pt-PT')}
                </strong>
                {b.reason && <span className="ml-2 text-ink-mute">{b.reason}</span>}
              </span>
              <button
                onClick={() => removeBlock(b.id)}
                aria-label="Desbloquear dia"
                className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-red-400 hover:text-red-700"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

// ==========================================================================
// Componentes partilhados do ficheiro
// ==========================================================================

function SettingsCard({
  icon,
  kicker,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  kicker: string;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-white p-5 shadow-card">
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 text-ink-mute">{icon}</span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-mute">
            {kicker}
          </p>
          <h2 className="font-display text-[16px] font-semibold leading-tight">{title}</h2>
          {desc && <p className="mt-0.5 text-[12px] text-ink-mute">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function NumField({
  label,
  help,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  min: number;
  max: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[12.5px] font-medium text-ink-soft">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
      {help && <p className="text-[11.5px] text-ink-mute">{help}</p>}
    </div>
  );
}

// O interruptor de reservas vive no ReadinessCard (topo da aba Reservas) — ver a nota em
// ConfigForm. Não repor um Toggle aqui sem repor também o problema que isso trazia.
