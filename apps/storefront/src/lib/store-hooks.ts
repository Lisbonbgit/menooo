'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
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
    // pára a sondagem quando o pedido termina
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s && ['COMPLETED', 'REJECTED', 'CANCELLED'].includes(s) ? false : 10_000;
    },
  });
}
