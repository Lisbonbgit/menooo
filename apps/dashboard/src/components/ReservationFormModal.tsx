'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CalendarPlus, Pencil, X } from 'lucide-react';
import { useCreateReservation, useUpdateReservation, useTables } from '@/lib/reservations-hooks';
import type { Reservation } from '@/lib/reservation-types';

const inputCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-brand';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** data/hora locais (tz do browser) a partir de um ISO da API. */
function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function minutesBetween(startsAt: string, endsAt: string): number {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
}

/** Nest devolve `message` como string ou array de strings — mostramos sempre a do servidor. */
function serverError(e: any, fallback: string): string {
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg) && msg.length > 0) return msg.join(' ');
  if (typeof msg === 'string' && msg) return msg;
  return fallback;
}

export function ReservationFormModal({
  mode,
  reservation,
  onClose,
}: {
  mode: 'create' | 'edit';
  reservation?: Reservation;
  onClose: () => void;
}): JSX.Element {
  const tables = useTables();
  const createReservation = useCreateReservation();
  const updateReservation = useUpdateReservation();

  const [date, setDate] = useState(reservation ? localDate(reservation.startsAt) : todayISO());
  const [time, setTime] = useState(reservation ? localTime(reservation.startsAt) : nowHHMM());
  const [partySize, setPartySize] = useState(String(reservation?.partySize ?? 2));
  const [durationMin, setDurationMin] = useState(
    reservation ? String(minutesBetween(reservation.startsAt, reservation.endsAt)) : '',
  );
  const [customerName, setCustomerName] = useState(reservation?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(reservation?.customerPhone ?? '');
  const [customerEmail, setCustomerEmail] = useState(reservation?.customerEmail ?? '');
  const [notes, setNotes] = useState(reservation?.notes ?? '');
  const [tableIds, setTableIds] = useState<string[]>(
    reservation ? reservation.tables.map((t) => t.tableId) : [],
  );
  const [saving, setSaving] = useState(false);

  const activeTables = useMemo(() => (tables.data ?? []).filter((t) => t.active), [tables.data]);

  function toggleTable(id: string) {
    setTableIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) {
        toast.info('Só podes forçar até 2 mesas.');
        return prev;
      }
      return [...prev, id];
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerName.trim()) {
      toast.error('O nome do cliente é obrigatório.');
      return;
    }
    const size = Number(partySize);
    if (!size || size < 1) {
      toast.error('Indica o número de pessoas.');
      return;
    }

    const body: Record<string, unknown> = {
      date,
      time,
      partySize: size,
      customerName: customerName.trim(),
    };
    if (durationMin.trim()) body.durationMin = Number(durationMin);
    if (customerPhone.trim()) body.customerPhone = customerPhone.trim();
    if (customerEmail.trim()) body.customerEmail = customerEmail.trim();
    if (notes.trim()) body.notes = notes.trim();
    if (tableIds.length > 0) body.tableIds = tableIds;

    setSaving(true);
    try {
      if (mode === 'edit' && reservation) {
        await updateReservation.mutateAsync({ id: reservation.id, ...body });
        toast.success('Reserva atualizada');
      } else {
        await createReservation.mutateAsync(body);
        toast.success('Reserva criada');
      }
      onClose();
    } catch (err: any) {
      const status = err?.response?.status;
      const fallback =
        status === 409
          ? 'Não há mesas disponíveis para esse horário.'
          : status === 422
            ? 'Hora inválida.'
            : status === 400
              ? 'Dados inválidos — confirma a data e a hora.'
              : 'Não foi possível guardar a reserva.';
      toast.error(serverError(err, fallback));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="animate-fade-up max-h-[88vh] w-full max-w-md overflow-y-auto rounded-3xl bg-paper p-6 shadow-pop"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="flex items-center gap-2.5 font-display text-[19px] font-semibold">
            <span className="text-ink-mute">
              {mode === 'edit' ? <Pencil size={17} /> : <CalendarPlus size={17} />}
            </span>
            {mode === 'edit' ? 'Editar reserva' : 'Nova reserva'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full border border-line bg-white p-2 text-ink-soft transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className={inputCls}
              />
            </Field>
            <Field label="Hora">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Pessoas">
              <input
                type="number"
                min={1}
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
                required
                className={inputCls}
              />
            </Field>
            <Field label="Duração (min)" help="vazio = duração padrão da loja">
              <input
                type="number"
                min={30}
                max={480}
                step={15}
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                placeholder="—"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Nome do cliente">
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefone">
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Notas">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputCls + ' resize-none'}
            />
          </Field>

          <Field label="Mesa" help="forçar mesa ignora lugares e juntabilidade">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setTableIds([])}
                className={
                  'rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ' +
                  (tableIds.length === 0
                    ? 'border-brand bg-brand text-white'
                    : 'border-line bg-white text-ink-soft hover:border-brand/40')
                }
              >
                Automática
              </button>
              {activeTables.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTable(t.id)}
                  className={
                    'rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ' +
                    (tableIds.includes(t.id)
                      ? 'border-brand bg-brand text-white'
                      : 'border-line bg-white text-ink-soft hover:border-brand/40')
                  }
                >
                  {t.name} · {t.seats}p
                </button>
              ))}
            </div>
            {activeTables.length === 0 && (
              <p className="mt-1.5 text-[11.5px] text-ink-mute">
                Ainda não há mesas ativas — a reserva fica sem mesa atribuída.
              </p>
            )}
          </Field>

          {mode === 'edit' && (
            <p className="rounded-lg bg-cream/60 px-3 py-2 text-[11.5px] text-ink-mute">
              Se mudares a hora, a mesa mantém-se se continuar livre.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="mt-5 w-full rounded-xl bg-brand py-3 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          {saving ? 'A guardar…' : mode === 'edit' ? 'Guardar alterações' : 'Criar reserva'}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[12.5px] font-medium text-ink-soft">{label}</label>
      {children}
      {help && <p className="text-[11.5px] text-ink-mute">{help}</p>}
    </div>
  );
}
