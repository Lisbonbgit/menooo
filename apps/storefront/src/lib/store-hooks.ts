'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { isTerminal } from './order-status';
import type { MenuCategory, OrderTracking, Store } from './types';

export function useStore(slug: string) {
  return useQuery({
    queryKey: ['store', slug],
    queryFn: async () => (await api.get<Store>(`/public/stores/${slug}`)).data,
    retry: false,
  });
}

export function useMenu(slug: string) {
  return useQuery({
    queryKey: ['menu', slug],
    queryFn: async () => (await api.get<MenuCategory[]>(`/public/stores/${slug}/menu`)).data,
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
