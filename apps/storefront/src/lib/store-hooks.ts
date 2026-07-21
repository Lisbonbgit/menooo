'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { isTerminal } from './order-status';
import type { MenuCategory, OrderTracking, Store, TableInfo } from './types';

export function useStore(slug: string) {
  return useQuery({
    queryKey: ['store', slug],
    queryFn: async () => (await api.get<Store>(`/public/stores/${slug}`)).data,
    retry: false,
  });
}

// `type` opcional e retrocompatível: sem tipo continua a servir o menu de Delivery (StoreClient
// não muda), 'dine_in' é o menu de Sala consumido pela rota da mesa.
export function useMenu(slug: string, type?: 'delivery' | 'dine_in') {
  return useQuery({
    queryKey: ['menu', slug, type ?? 'delivery'],
    queryFn: async () =>
      (await api.get<MenuCategory[]>(`/public/stores/${slug}/menu${type ? `?type=${type}` : ''}`))
        .data,
    retry: false,
  });
}

export function useTable(slug: string, qrToken: string) {
  return useQuery({
    queryKey: ['table', slug, qrToken],
    queryFn: async () => (await api.get<TableInfo>(`/public/stores/${slug}/mesa/${qrToken}`)).data,
    retry: false,
  });
}

export function useOrderTracking(token: string) {
  return useQuery({
    queryKey: ['order-track', token],
    queryFn: async () => (await api.get<OrderTracking>(`/public/orders/${token}`)).data,
    retry: false,
    // pára a sondagem quando o pedido termina — ou quando o token é inválido/desconhecido:
    // sem esta porta, um erro definitivo deixava `data` undefined para sempre e a sondagem
    // continuava a cada 10s sem nunca poder ter sucesso.
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      const s = query.state.data?.status;
      return s && isTerminal(s) ? false : 10_000;
    },
  });
}
