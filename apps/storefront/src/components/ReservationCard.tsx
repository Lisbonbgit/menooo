'use client';

// Cartão de estado de uma reserva + diálogo de cancelamento. Partilhado por:
//  - a página de gestão por TOKEN (`/[slug]/reserva/[code]` — link do email);
//  - o bloco de consultar/cancelar por EMAIL (`ManageReservationBlock`, na página de reservar).
// É puramente apresentacional: depende só de `r`, `phone`, `canCancel`, `confirming` e da mutação
// (via `onCancel`/`cancelPending`). ZERO acoplamento a token/sessionStorage — quem chama é que
// decide como autorizou e como cancela.

import Link from 'next/link';
import { CalendarDays, CheckCircle2, Clock, MapPin, Phone, Users } from 'lucide-react';
import type { PublicReservation, ReservationStatus } from '@/lib/reservation-public-hooks';

const STATUS_META: Record<ReservationStatus, { label: string; className: string }> = {
  CONFIRMED: { label: 'Confirmada', className: 'bg-green-100 text-green-700' },
  CANCELLED: { label: 'Cancelada', className: 'bg-red-50 text-red-700' },
  COMPLETED: { label: 'Concluída', className: 'bg-cream text-ink-soft' },
  NO_SHOW: { label: 'Registada como falta', className: 'bg-cream text-ink-soft' },
};

/** «Sábado, 19 de julho» a partir do yyyy-mm-dd que o servidor já normalizou. */
function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`); // meia-noite LOCAL: só lemos as partes da data
  if (Number.isNaN(d.getTime())) return iso;
  const t = new Intl.DateTimeFormat('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function ReservationCard({
  slug,
  r,
  phone,
  canCancel,
  confirming,
  onConfirmingChange,
  onCancel,
  cancelPending,
  showTitle = true,
  morada,
  graceMin,
  reservationsEnabled,
}: {
  slug: string;
  r: PublicReservation;
  phone: string | null;
  /** O estado permite cancelar? (CONFIRMED e ainda antes de `endsAt`.) */
  canCancel: boolean;
  confirming: boolean;
  onConfirmingChange: (v: boolean) => void;
  onCancel: () => void;
  cancelPending: boolean;
  /** O título «A minha reserva» (a página de token mostra-o; o bloco tem moldura própria). */
  showTitle?: boolean;
  /** Vem da loja — só o caminho do token a tem; o caminho por email passa sem ela. */
  morada?: string;
  graceMin?: number | null;
  reservationsEnabled?: boolean;
}) {
  const meta = STATUS_META[r.status] ?? STATUS_META.CONFIRMED;

  return (
    <>
      {showTitle && (
        <h1 className="mb-5 font-display text-[28px] font-semibold tracking-tight">
          A minha reserva
        </h1>
      )}

      <div className="animate-fade-up overflow-hidden rounded-2xl border border-line bg-white shadow-card">
        <div className="border-b border-line bg-cream/40 px-5 py-4 text-center">
          <span
            className={
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ' +
              meta.className
            }
          >
            {r.status === 'CONFIRMED' && <CheckCircle2 size={13} />}
            {meta.label}
          </span>
          <p className="mt-3 font-mono text-[26px] font-semibold tracking-[0.18em]">{r.code}</p>
          <p className="text-[11.5px] uppercase tracking-[0.16em] text-ink-mute">
            Código da reserva
          </p>
        </div>

        <div className="space-y-3 px-5 py-5">
          <InfoRow icon={<CalendarDays size={15} />} label="Dia" value={dateLabel(r.date)} />
          <InfoRow icon={<Clock size={15} />} label="Hora" value={r.time} />
          <InfoRow
            icon={<Users size={15} />}
            label="Pessoas"
            value={`${r.partySize} ${r.partySize === 1 ? 'pessoa' : 'pessoas'}`}
          />
          <InfoRow
            icon={<MapPin size={15} />}
            label={r.restaurantName}
            // a morada vem da loja, não da reserva: sem ela (caminho por email) fica o beco
            // «vê na página da loja», que é sempre verdade.
            value={morada || 'Vê a morada na página da loja'}
          />
        </div>
      </div>

      {/* Tolerância de atraso. Só sai com valor (o campo é gated por `reservationsEnabled` e o
          dono pode pô-lo a 0). O caminho por email não a tem — e tudo bem. */}
      {r.status === 'CONFIRMED' && !!graceMin && (
        <p className="mt-4 rounded-xl bg-cream/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft">
          A tua mesa fica guardada {graceMin} {graceMin === 1 ? 'minuto' : 'minutos'}.
        </p>
      )}

      {r.status === 'CANCELLED' && (
        <div className="mt-4 rounded-xl bg-cream/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft">
          Esta reserva foi cancelada e a mesa ficou livre.
          {reservationsEnabled && (
            <>
              {' '}
              <Link href={`/${slug}/reservar`} className="font-semibold text-brand hover:underline">
                Marcar outra
              </Link>
              .
            </>
          )}
        </div>
      )}

      <div className="mt-5 rounded-xl border border-line bg-white px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-soft shadow-card">
        <ContactLine slug={slug} phone={phone} prefix="Se não conseguires vir, liga-nos:" flush />
      </div>

      {canCancel &&
        (confirming ? (
          <div className="animate-fade-up mt-5 rounded-xl border border-line bg-white p-4 text-center shadow-card">
            <p className="text-[13.5px] font-medium">Queres mesmo cancelar esta reserva?</p>
            <p className="mt-1 text-[12.5px] text-ink-soft">
              A mesa fica livre para outra pessoa e não dá para desfazer.
            </p>
            <div className="mt-4 flex gap-2.5">
              <button
                onClick={() => onConfirmingChange(false)}
                disabled={cancelPending}
                className="flex-1 rounded-xl border border-line bg-white py-2.5 text-[13.5px] font-medium text-ink-soft transition-colors hover:bg-cream disabled:opacity-50"
              >
                Manter reserva
              </button>
              <button
                onClick={onCancel}
                disabled={cancelPending}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {cancelPending ? 'A cancelar…' : 'Sim, cancelar'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => onConfirmingChange(true)}
            className="mt-5 w-full rounded-xl border border-line bg-white py-3 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-red-200 hover:text-red-700"
          >
            Cancelar reserva
          </button>
        ))}
    </>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-ink-mute">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11.5px] uppercase tracking-[0.12em] text-ink-mute">{label}</p>
        <p className="text-[14px] font-medium">{value}</p>
      </div>
    </div>
  );
}

/** «liga-nos: <telefone>» — com beco de saída quando o restaurante não tem telefone público. */
export function ContactLine({
  slug,
  phone,
  prefix,
  flush,
}: {
  slug: string;
  phone: string | null;
  prefix: string;
  flush?: boolean;
}) {
  return (
    <p className={flush ? '' : 'mt-5 text-[12.5px] leading-relaxed text-ink-soft'}>
      {phone ? (
        <>
          {prefix}{' '}
          <a
            href={`tel:${phone.replace(/\s+/g, '')}`}
            className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
          >
            <Phone size={12} />
            {phone}
          </a>
        </>
      ) : (
        // Sem telefone público o `prefix` deixa de fazer sentido («Se não conseguires vir,
        // liga-nos:» sem número). Texto neutro, que serve os três ramos que usam isto.
        <>
          Os contactos do restaurante estão na{' '}
          <Link href={`/${slug}`} className="font-semibold text-brand hover:underline">
            página da loja
          </Link>
          .
        </>
      )}
    </p>
  );
}
