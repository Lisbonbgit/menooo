'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface DeliveryZone {
  id: string;
  name: string;
  postalPrefix: string;
  fee: string;
  minOrder: string;
  active: boolean;
}

export interface Coupon {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED';
  value: string;
  minOrder: string;
  active: boolean;
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
}

// ----- Zonas -----
export function useZones() {
  return useQuery({
    queryKey: ['zones'],
    queryFn: async () => (await api.get<DeliveryZone[]>('/delivery-zones')).data,
  });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; postalPrefix: string; fee: number; minOrder: number }) =>
      (await api.post('/delivery-zones', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zones'] }),
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/delivery-zones/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['zones'] }),
  });
}

// ----- Cupões -----
export function useCoupons() {
  return useQuery({
    queryKey: ['coupons'],
    queryFn: async () => (await api.get<Coupon[]>('/coupons')).data,
  });
}

export function useCreateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      code: string;
      type: 'PERCENT' | 'FIXED';
      value: number;
      minOrder: number;
      maxUses?: number;
    }) => (await api.post('/coupons', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coupons'] }),
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/coupons/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coupons'] }),
  });
}
