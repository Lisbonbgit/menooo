'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/**
 * Dados públicos das reservas (loja pública).
 *
 * `cache: 'no-store'` não existe aqui: o `lib/api.ts` é axios, onde a opção é no-op, e um
 * pedido do cliente nunca esteve sob o ISR. O risco real é a cache do react-query — depois
 * de um 409 («esse horário acabou de ficar ocupado») serviria a hora já ocupada outra vez.
 * Daí `staleTime: 0`, `gcTime: 0` e `retry: false` (um erro de gating tem de aparecer já,
 * não depois de 3 tentativas).
 */

export interface ReservationDay {
  date: string;
  hasSlots: boolean;
}

export interface ReservationDaysResponse {
  days: ReservationDay[];
  /** 'party' = grupo acima do máximo da loja; vem com o telefone para o «liga-nos». */
  reason?: string;
  contactPhone?: string | null;
}

export interface ReservationSlotsResponse {
  /** Etiquetas "HH:MM" na hora da loja. */
  slots: string[];
  reason?: string;
  contactPhone?: string | null;
}

/** Que dias do intervalo têm vaga — UM pedido em vez de 30 (ver spec §4). */
export function useReservationDays(
  slug: string,
  from: string,
  to: string,
  party: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['res-days', slug, from, to, party],
    queryFn: async () =>
      (
        await api.get<ReservationDaysResponse>(`/public/stores/${slug}/reservation-days`, {
          params: { from, to, party },
        })
      ).data,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    enabled,
  });
}

/** Horas livres do dia escolhido. */
export function useReservationSlots(slug: string, date: string | null, party: number) {
  return useQuery({
    queryKey: ['res-slots', slug, date, party],
    queryFn: async () =>
      (
        await api.get<ReservationSlotsResponse>(`/public/stores/${slug}/reservation-slots`, {
          params: { date, party },
        })
      ).data,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    enabled: !!date,
  });
}
