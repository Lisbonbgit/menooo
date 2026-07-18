'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
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

// ---------------------------------------------------------------------------
// Consultar / cancelar por número + email — o caminho paralelo ao token, para
// quem perdeu o email de confirmação. A view (200) tem o MESMO shape do caminho
// do token (`publicReservationView` na API), logo reutiliza o mesmo cartão.
// ---------------------------------------------------------------------------

export type ReservationStatus = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';

/** Shape público de uma reserva — igual ao do GET por token (ver `publicReservationView`). */
export interface PublicReservation {
  code: string;
  status: ReservationStatus;
  /** yyyy-mm-dd JÁ na timezone do restaurante — não voltar a converter no cliente. */
  date: string;
  /** hh:mm, idem. */
  time: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  /** NUNCA renderizar (o R4 usa-os para o dono arrastar reservas entre mesas). Fica no
   *  contrato porque removê-los era breaking; é só não os mostrar. */
  tableNames: string[];
  restaurantName: string;
  restaurantPhone: string | null;
}

/**
 * Consulta pelo número + email. Erros a tratar em quem chama (NUNCA ecoar `data.message`):
 * - 404 → «Reserva não encontrada. Confirma o número e o email.» (igual para código e email
 *   errados — a resposta é neutra, não revela se o código existe).
 * - 429 → mensagem própria (o `ThrottlerException` sai «Too Many Requests», em inglês).
 */
export function useLookupReservation() {
  return useMutation({
    mutationFn: async (v: { code: string; email: string }) =>
      (await api.post<PublicReservation>('/public/reservations/lookup', v)).data,
  });
}

/** Cancela pelo mesmo número + email da consulta. Responde `{ ok: true }` (não a view). */
export function useCancelByEmail() {
  return useMutation({
    mutationFn: async (v: { code: string; email: string }) =>
      (
        await api.post<{ ok: true }>(
          `/public/reservations/${encodeURIComponent(v.code)}/cancel-by-email`,
          { email: v.email },
        )
      ).data,
  });
}
