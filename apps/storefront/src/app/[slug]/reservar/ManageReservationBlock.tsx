'use client';

// Bloco de consultar/cancelar uma reserva pelo NÚMERO + EMAIL — para quem perdeu o email de
// confirmação (o link com o token). Autónomo: só precisa do `slug`, NÃO do store — por isso
// pode viver em qualquer ramo da página de reservar, incluindo o `gated` (reservas desligadas),
// que é justamente um dos momentos em que o cliente quer cancelar.

import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarDays, ChevronDown, Loader2, Search } from 'lucide-react';
import { ReservationCard } from '@/components/ReservationCard';
import {
  useCancelByEmail,
  useLookupReservation,
  type PublicReservation,
} from '@/lib/reservation-public-hooks';

const inputCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] shadow-card outline-none transition-colors focus:border-brand';

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | undefined)?.response?.status;
}

/** Resposta NEUTRA: código inexistente e email errado dão a MESMA mensagem (não revelar nada). */
function lookupErrorText(err: unknown): string {
  const s = httpStatus(err);
  // NUNCA ecoar `data.message`: o 429 sai «Too Many Requests» e um 400 do class-validator sai
  // «email must be an email» — ambos em inglês.
  if (s === 429) return 'Demasiados pedidos. Espera um minuto e tenta de novo.';
  if (s === 404 || s === 400) return 'Reserva não encontrada. Confirma o número e o email.';
  return 'Não foi possível consultar a reserva. Verifica a ligação e tenta de novo.';
}

function cancelErrorText(err: unknown): string {
  const s = httpStatus(err);
  if (s === 429) return 'Demasiados pedidos. Espera um minuto e tenta de novo.';
  if (s === 404) return 'Reserva não encontrada. Confirma o número e o email.';
  // Um 400 aqui é «Esta reserva já não pode ser cancelada.» — vem em PT do servidor, seguro.
  const msg = (err as { response?: { data?: { message?: unknown } } } | undefined)?.response?.data
    ?.message;
  return typeof msg === 'string' ? msg : 'Não foi possível cancelar a reserva.';
}

export function ManageReservationBlock({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Guardamos o código+email que a consulta ACEITOU: o cancelar usa exatamente os mesmos, mesmo
  // que o cliente edite os campos entretanto.
  const [result, setResult] = useState<{ r: PublicReservation; code: string; email: string } | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);

  const lookup = useLookupReservation();
  const cancelM = useCancelByEmail();

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim();
    const em = email.trim();
    setError(null);
    if (!c || !em) {
      setError('Indica o número da reserva e o email.');
      return;
    }
    if (!em.includes('@')) {
      setError('Indica um email válido.');
      return;
    }
    setConfirming(false);
    try {
      const r = await lookup.mutateAsync({ code: c, email: em });
      setResult({ r, code: c, email: em });
    } catch (err) {
      setResult(null);
      setError(lookupErrorText(err));
    }
  }

  async function onCancel() {
    if (!result) return;
    try {
      await cancelM.mutateAsync({ code: result.code, email: result.email });
      setConfirming(false);
      // O cancel-by-email responde `{ ok: true }` (não a view). Marcamos CANCELLED localmente: um
      // 200 só chega se a reserva estava CONFIRMED, logo passar a «Cancelada» é sempre verdade.
      setResult({ ...result, r: { ...result.r, status: 'CANCELLED' } });
      toast.success('Reserva cancelada. O restaurante já foi avisado.');
    } catch (err) {
      setConfirming(false);
      toast.error(cancelErrorText(err));
    }
  }

  function searchAnother() {
    setResult(null);
    setError(null);
    setConfirming(false);
  }

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-line bg-white shadow-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-[13.5px] font-medium text-ink-soft">
          <CalendarDays size={15} className="text-brand" />
          Já tens uma reserva? Consultar ou cancelar
        </span>
        <ChevronDown
          size={16}
          className={'shrink-0 text-ink-mute transition-transform ' + (open ? 'rotate-180' : '')}
        />
      </button>

      {open && (
        <div className="border-t border-line px-5 py-5">
          {result ? (
            <>
              <ReservationCard
                slug={slug}
                r={result.r}
                phone={result.r.restaurantPhone}
                canCancel={
                  result.r.status === 'CONFIRMED' &&
                  new Date(result.r.endsAt).getTime() > Date.now()
                }
                confirming={confirming}
                onConfirmingChange={setConfirming}
                onCancel={onCancel}
                cancelPending={cancelM.isPending}
                showTitle={false}
              />
              <button
                type="button"
                onClick={searchAnother}
                className="mt-5 block w-full text-center text-[13px] font-medium text-ink-mute transition-colors hover:text-ink"
              >
                Consultar outra reserva
              </button>
            </>
          ) : (
            <form onSubmit={onSearch} className="space-y-3.5">
              <p className="text-[12.5px] leading-relaxed text-ink-soft">
                Escreve o número da reserva e o email com que a fizeste — mostramos-te o estado e,
                se quiseres, cancelas.
              </p>
              <div className="space-y-1.5">
                <label className="block text-[12.5px] font-medium text-ink-soft">
                  Número da reserva
                </label>
                <input
                  value={code}
                  maxLength={20}
                  autoCapitalize="characters"
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Ex.: A1B2C3"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[12.5px] font-medium text-ink-soft">Email</label>
                <input
                  type="email"
                  value={email}
                  maxLength={200}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="o email da confirmação"
                  className={inputCls}
                />
              </div>

              {error && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={lookup.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[14px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:opacity-50"
              >
                {lookup.isPending ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> A procurar…
                  </>
                ) : (
                  <>
                    <Search size={15} /> Procurar reserva
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
