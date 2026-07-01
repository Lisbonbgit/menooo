'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { MenuCategory, Store } from './types';

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
