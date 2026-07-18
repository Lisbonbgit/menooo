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
  ReservationService,
  ServiceForDay,
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

/**
 * Grava o layout do mapa de uma área INTEIRA.
 *
 * As `positions` levam TODAS as mesas da área, não só as que se arrastaram: se levassem só as
 * duas de uma troca, o auto-layout das restantes nunca ficaria gravado e dois dispositivos
 * veriam salas diferentes até alguém arrastar. O servidor grava-as numa transação.
 *
 * `area: null` é a área «Sem área» (mesas com `area = null`) — e é um valor a sério, não um
 * «não filtrar»: o servidor recusa com 404 uma mesa que não seja daquela área.
 */
export function useSetLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      area: string | null;
      positions: { id: string; x: number; y: number }[];
    }) => (await api.put<{ saved: number }>('/tables/layout', body)).data,
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
// Sucedidas pelos serviços (ver abaixo). A tabela ainda existe no servidor — a R4 é um
// expand/contract e o DROP fica para um ciclo posterior — mas o painel deixou de as escrever.

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
// Serviços de reserva
// ==========================================================================
// A chave ['reservation-services'] é PREFIXO da chave do dia: invalidar o CRUD refaz também
// os chips e a timeline do dia aberto, que é o que o dono espera depois de gravar um serviço.

export function useServices() {
  return useQuery({
    queryKey: ['reservation-services'],
    queryFn: async () => (await api.get<ReservationService[]>('/reservation-services')).data,
  });
}

/**
 * Os serviços de um dia concreto, com o sintético já resolvido pelo servidor: um dia sem
 * serviços devolve «Horário de abertura» com `synthetic: true` em vez de uma lista vazia.
 */
export function useServicesForDay(dateISO: string) {
  return useQuery({
    queryKey: ['reservation-services', 'day', dateISO],
    queryFn: async () =>
      (await api.get<ServiceForDay[]>('/reservation-services/day', { params: { date: dateISO } })).data,
    enabled: !!dateISO,
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      weekdays: number[];
      openMinute: number;
      closeMinute: number;
      sortOrder?: number;
    }) => (await api.post<ReservationService>('/reservation-services', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reservation-services'] }),
  });
}

/**
 * PATCH parcial: uma chave omitida fica como está no servidor.
 * ⚠️ Cuidado com o `undefined` — o `JSON.stringify` deita a chave fora, logo mandar
 * `{ name: undefined }` não limpa o nome: mantém o antigo e a UI diz «sucesso». Nenhum campo
 * do serviço é anulável, portanto manda só o que mudou mesmo.
 */
export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Partial<Omit<ReservationService, 'id'>>) =>
      (await api.patch<ReservationService>(`/reservation-services/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reservation-services'] }),
  });
}

/**
 * Apagar o último serviço de um weekday NÃO fecha o dia: abre-o de par em par, porque o
 * servidor passa a cair no horário de abertura (−60). Quem chamar isto tem de avisar com a
 * consequência real ANTES — ver o §5 do spec.
 */
export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/reservation-services/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reservation-services'] }),
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
