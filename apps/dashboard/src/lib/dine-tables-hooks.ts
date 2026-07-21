'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

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
