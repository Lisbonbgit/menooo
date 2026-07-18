'use client';

// ⚠️ Esta rota traz um bearer token no fragmento do URL, e o strip só pode acontecer depois da
// hidratação (ver o useLayoutEffect abaixo) — logo existe uma janela curta em que
// location.href ainda tem o token. NENHUM script de terceiros (GA, Meta pixel, GTM) pode
// entrar no layout do storefront: amostraria location.href COM o token no primeiro paint.
// Hoje o storefront não carrega nenhum (zero gtag/GTM/fbq, zero dangerouslySetInnerHTML) —
// está a salvo, mas por acidente. O TTL do token (startsAt+24h, na API) é o que limita o
// estrago se algum dia escapar.

import { useEffect, useLayoutEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CalendarX2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-hooks';
import { StoreTheme } from '@/components/StoreTheme';
import { ContactLine, ReservationCard } from '@/components/ReservationCard';
import type { PublicReservation } from '@/lib/reservation-public-hooks';
import type { Store } from '@/lib/types';

/** O sessionStorage atira em contextos com armazenamento bloqueado (iframe de terceiros,
 *  modos privados antigos). Um erro aqui deixava sem reserva quem tem o link certo na mão. */
function readToken(code: string): string | null {
  try {
    return sessionStorage.getItem(`res-token:${code}`);
  } catch {
    return null;
  }
}

function saveToken(code: string, token: string): void {
  try {
    sessionStorage.setItem(`res-token:${code}`, token);
  } catch {
    // sem persistência o token vive só na memória do componente: aguenta a sessão, não o F5
  }
}

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | undefined)?.response?.status;
}

function errorText(err: unknown, fallback: string): string {
  // NUNCA ecoar a mensagem de um 429: o ThrottlerException sai literalmente
  // «ThrottlerException: Too Many Requests» — em inglês, para um cliente português.
  if (httpStatus(err) === 429) {
    return 'Demasiados pedidos deste dispositivo. Espera um minuto e tenta de novo.';
  }
  const msg = (err as { response?: { data?: { message?: unknown } } } | undefined)?.response?.data
    ?.message;
  return typeof msg === 'string' ? msg : fallback;
}

export function ReservaClient({ slug, code }: { slug: string; code: string }) {
  // Ler o fragmento e guardá-lo SÍNCRONAMENTE, antes de qualquer efeito: o sessionStorage é o
  // que mantém o F5 a funcionar, e é o que torna inócuo o duplo-render do StrictMode (à 2.ª
  // volta o hash pode já não existir e o token vem daqui).
  const [token] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const m = window.location.hash.match(/[#&]t=([a-f0-9]{64})/i);
    if (m) {
      saveToken(code, m[1]);
      return m[1];
    }
    return readToken(code);
  });

  // A limpeza do URL TEM de viver num layout effect, não no initializer acima.
  //
  // Porquê: o Next patcheia o `history.replaceState` («Avoid a loop when Next.js internally
  // calls…») e, durante a hidratação, a chamada não pega — VERIFICADO em browser: com o strip
  // no initializer, o `#t=…` continuava no `location.href` aos 300 ms e aos 1,8 s, embora o
  // sessionStorage já tivesse o token. Ou seja, o código parecia certo e não fazia nada; só um
  // browser o podia apanhar.
  //
  // O useLayoutEffect corre depois da hidratação mas ANTES do primeiro paint, que é o ponto
  // mais cedo em que isto funciona mesmo. Fica uma janela minúscula, entre o parse do HTML e a
  // hidratação, em que `location.href` ainda tem o token — daí o aviso no topo do ficheiro:
  // nenhum script de terceiros no layout do storefront (hoje não há nenhum, confirmado).
  useLayoutEffect(() => {
    if (window.location.hash.includes('t=')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // O servidor NUNCA vê o fragmento, logo renderiza sempre «a carregar». Sem esta porta o
  // HTML do servidor («não encontrada», por não haver token) não bateria certo com o do
  // cliente (que já tem o token) → erro de hidratação e um flash de «não encontrada» a toda
  // a gente que abre o link legítimo. O token é lido na mesma no initializer acima.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const store = useStore(slug);
  const s = store.data;

  const reservation = useQuery({
    queryKey: ['reservation', code],
    queryFn: async () =>
      (
        await api.get<PublicReservation>(`/public/reservations/${code}`, {
          // Token SEMPRE em header: em query string ficava nos logs de acesso do servidor,
          // no Referer e no histórico do browser.
          headers: { 'X-Reservation-Token': token ?? '' },
        })
      ).data,
    enabled: !!token,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const [confirming, setConfirming] = useState(false);

  const cancel = useMutation({
    mutationFn: async () => (await api.post(`/public/reservations/${code}/cancel`, { token })).data,
    onSuccess: async () => {
      setConfirming(false);
      toast.success('Reserva cancelada. O restaurante já foi avisado.');
      await reservation.refetch();
    },
    onError: async (err: unknown) => {
      setConfirming(false);
      toast.error(errorText(err, 'Não foi possível cancelar a reserva.'));
      // o estado pode ter mudado do outro lado (o painel cancelou ou marcou falta): a recusa
      // é informação — voltar a ler para o ecrã passar a dizer a verdade
      await reservation.refetch();
    },
  });

  const r = reservation.data;
  const phone = r?.restaurantPhone ?? s?.phone ?? null;

  if (!mounted || reservation.isLoading) {
    return (
      <Shell s={s} slug={slug}>
        <div className="flex flex-col items-center gap-3 py-20 text-ink-mute">
          <Loader2 size={24} className="animate-spin" />
          <p className="text-[14px]">A carregar a tua reserva…</p>
        </div>
      </Shell>
    );
  }

  // «Sem token válido → 404 neutro» é ESTADO, não um 404 HTTP: o token vive no fragmento e o
  // servidor nunca o vê. Mesma resposta para link sem token, token errado, reserva
  // inexistente e token expirado (24 h depois da hora da reserva) — não confirmamos nada a
  // quem só tem o código.
  if (!token || httpStatus(reservation.error) === 404) {
    return (
      <Shell s={s} slug={slug}>
        <Card>
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cream">
            <CalendarX2 className="text-ink-mute" size={26} strokeWidth={1.5} />
          </span>
          <h1 className="font-display text-[24px] font-semibold tracking-tight">
            Reserva não encontrada
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
            Este link já não é válido. Pode ter expirado, ou ter sido aberto sem o código de
            acesso que vem no email de confirmação.
          </p>
          <ContactLine slug={slug} phone={phone} prefix="Se precisares de ajuda, liga-nos:" />
        </Card>
      </Shell>
    );
  }

  if (reservation.isError || !r) {
    return (
      <Shell s={s} slug={slug}>
        <Card>
          <h1 className="font-display text-[24px] font-semibold tracking-tight">
            Não foi possível abrir a reserva
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
            {errorText(reservation.error, 'Tenta de novo dentro de momentos.')}
          </p>
          <button
            onClick={() => reservation.refetch()}
            className="mt-5 rounded-xl bg-brand px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
          >
            Tentar de novo
          </button>
          <ContactLine slug={slug} phone={phone} prefix="Ou liga-nos:" />
        </Card>
      </Shell>
    );
  }

  // Esconder o botão quando o estado não permite — o servidor recusa na mesma, mas um botão
  // que só serve para dar erro é uma promessa falsa. Cancelar vale até ao FIM da reserva
  // (endsAt): um cancelamento tardio é sempre melhor para o dono que um no-show mudo.
  const canCancel = r.status === 'CONFIRMED' && new Date(r.endsAt).getTime() > Date.now();
  const morada = [s?.address, [s?.zipCode, s?.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');

  return (
    <Shell s={s} slug={slug}>
      <ReservationCard
        slug={slug}
        r={r}
        phone={phone}
        canCancel={canCancel}
        confirming={confirming}
        onConfirmingChange={setConfirming}
        onCancel={() => cancel.mutate()}
        cancelPending={cancel.isPending}
        // enquanto o pedido da loja não chega mostramos «—» em vez do beco «vê na página da
        // loja», que depois saltava para a morada
        morada={morada || (store.isLoading ? '—' : undefined)}
        graceMin={s?.reservationGraceMin ?? null}
        reservationsEnabled={s?.reservationsEnabled}
      />
    </Shell>
  );
}

/**
 * Casca comum a TODOS os ramos: o `StoreTheme` mete as CSS vars num useEffect e remove-as no
 * unmount — não se aplica sozinho, e um ramo sem ele fica em laranja Menooo dentro da loja
 * de outra pessoa. (O primeiro paint é sempre o tema Menooo: o `publicByCode` não traz as
 * cores e a loja só chega no pedido seguinte — FOUC aceite.)
 */
function Shell({
  s,
  slug,
  children,
}: {
  s: Store | undefined;
  slug: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6">
      {s && <StoreTheme brandColor={s.brandColor} heroColor={s.heroColor} />}
      <Link
        href={`/${slug}`}
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} /> {s?.name ?? 'Voltar à loja'}
      </Link>
      {children}
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-fade-up rounded-2xl border border-line bg-white p-8 text-center shadow-card">
      {children}
    </div>
  );
}
