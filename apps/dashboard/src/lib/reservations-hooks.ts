'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ensureFreshSession } from './api';
import { useAuthStore } from './auth-store';
import { playAlarm } from './alarm';
import type {
  Reservation,
  Table,
  ReservationWindow,
  ReservationBlock,
  ReservationConfig,
} from './reservation-types';

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** tenantId do access token (o socket junta-se à sala desta unidade). */
function tokenTenantId(token: string | null): string | null {
  if (!token) return null;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)).tenantId ?? null;
  } catch {
    return null;
  }
}

/** Reservas de um dia + atualização em tempo real (sala staff). */
export function useLiveReservations(dateISO: string) {
  const activeTenantId = useAuthStore((s) => tokenTenantId(s.token));
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const dateRef = useRef(dateISO);
  dateRef.current = dateISO;

  const query = useQuery({
    queryKey: ['reservations', dateISO],
    queryFn: async () => (await api.get<Reservation[]>('/reservations', { params: { date: dateISO } })).data,
    enabled: !!activeTenantId,
  });

  useEffect(() => {
    if (!activeTenantId) return;
    const socket = io(WS_URL, {
      auth: (cb) => cb({ token: useAuthStore.getState().token }),
      transports: ['websocket'],
    });

    const resync = () => qc.invalidateQueries({ queryKey: ['reservations', dateRef.current] });

    socket.on('connect', () => {
      setConnected(true);
      resync(); // o socket não repõe eventos perdidos num gap
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => void ensureFreshSession());
    socket.on('reservation.created', (r: Reservation) => {
      if (r.startsAt.slice(0, 10) === dateRef.current) playAlarm();
      resync();
    });
    socket.on('reservation.updated', () => resync());

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !socket.connected) {
        void ensureFreshSession().finally(() => socket.connect());
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
    };
  }, [activeTenantId, qc]);

  return { reservations: query.data ?? [], connected, refetch: query.refetch };
}

// ==========================================================================
// Mesas
// ==========================================================================

export function useTables() {
  return useQuery({ queryKey: ['tables'], queryFn: async () => (await api.get<Table[]>('/tables')).data });
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<Table>) => (await api.post<Table>('/tables', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tables'] }),
  });
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<Table> & { id: string }) =>
      (await api.patch<Table>(`/tables/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tables'] }),
  });
}

export function useDeleteTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/tables/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tables'] }),
  });
}

// ==========================================================================
// Reservas (painel)
// ==========================================================================

export function useCreateReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<Reservation> & Record<string, unknown>) =>
      (await api.post<Reservation>('/reservations', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reservations'] }),
  });
}

export function useUpdateReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<Reservation> & Record<string, unknown> & { id: string }) =>
      (await api.patch<Reservation>(`/reservations/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reservations'] }),
  });
}

export function useUpdateReservationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Reservation['status'] }) =>
      (await api.patch<Reservation>(`/reservations/${id}/status`, { status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reservations'] }),
  });
}

// ==========================================================================
// Janelas de reserva
// ==========================================================================

export function useWindows() {
  return useQuery({
    queryKey: ['reservation-windows'],
    queryFn: async () => (await api.get<ReservationWindow[]>('/reservation-windows')).data,
  });
}

export function useSetWindows() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (windows: ReservationWindow[]) =>
      (await api.put<ReservationWindow[]>('/reservation-windows', { windows })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reservation-windows'] }),
  });
}

// ==========================================================================
// Bloqueios de dia
// ==========================================================================

export function useBlocks() {
  return useQuery({
    queryKey: ['reservation-blocks'],
    queryFn: async () => (await api.get<ReservationBlock[]>('/reservation-blocks')).data,
  });
}

export function useCreateBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { date: string; reason?: string }) =>
      (await api.post<ReservationBlock>('/reservation-blocks', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reservation-blocks'] }),
  });
}

export function useDeleteBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/reservation-blocks/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reservation-blocks'] }),
  });
}

// ==========================================================================
// Configuração de reservas (tenant)
// ==========================================================================

export function useTenantConfig() {
  return useQuery({
    queryKey: ['tenant-me'],
    queryFn: async () => (await api.get<ReservationConfig>('/tenants/me')).data,
  });
}

export function useUpdateTenantConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<ReservationConfig>) =>
      (await api.patch<ReservationConfig>('/tenants/me', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-me'] }),
  });
}
