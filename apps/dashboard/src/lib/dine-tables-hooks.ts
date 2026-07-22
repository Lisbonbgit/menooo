'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { OrderStatus } from './types';

/** Mesa de sala (dine-in QR) — separada das mesas de reservas (Table/reservation-types). */
export interface DineTable {
  id: string;
  name: string;
  qrToken: string;
  active: boolean;
  sortOrder: number;
}

export function useDineTables() {
  return useQuery({
    queryKey: ['dine-tables'],
    queryFn: async () => (await api.get<DineTable[]>('/dine-tables')).data,
  });
}

export function useCreateDineTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => (await api.post<DineTable>('/dine-tables', { name })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dine-tables'] }),
  });
}

export function useBulkDineTables() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ count, prefix }: { count: number; prefix?: string }) =>
      (await api.post<DineTable[]>('/dine-tables/bulk', { count, prefix })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dine-tables'] }),
  });
}

export function useUpdateDineTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; active?: boolean }) =>
      (await api.patch<DineTable>(`/dine-tables/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dine-tables'] }),
  });
}

export function useDeleteDineTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/dine-tables/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dine-tables'] }),
  });
}

// ==========================================================================
// Contas (sessões) abertas das mesas de sala (Fase 2b, Task 4) — a Receção
// usa isto para mostrar "Mesas abertas" + o botão "Fechar mesa".
// ==========================================================================

export interface OpenSessionOrder {
  id: string;
  number: number;
  status: OrderStatus;
  total: number;
  createdAt: string;
}

export interface OpenTableSession {
  id: string;
  table: string;
  openedAt: string;
  orders: OpenSessionOrder[];
  total: number;
}

/**
 * Sessões abertas (contas por fechar) de todas as mesas de sala. Sondagem curta em vez de
 * um evento de socket dedicado — a Receção já atualiza pedidos ao vivo, mas uma mesa pode
 * abrir/fechar sem nenhum pedido novo (ex.: outro membro da equipa fechou-a entretanto).
 */
export function useOpenSessions() {
  return useQuery({
    queryKey: ['open-sessions'],
    queryFn: async () =>
      (await api.get<OpenTableSession[]>('/dine-tables/table-sessions', { params: { status: 'open' } }))
        .data,
    refetchInterval: 15_000,
  });
}

export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch(`/dine-tables/table-sessions/${id}/close`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['open-sessions'] }),
  });
}
