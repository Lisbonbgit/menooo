'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface TenantSubscription {
  state: 'NONE' | 'TRIAL' | 'PAID' | 'EXPIRED' | 'LIFETIME';
  trialEndsAt: string | null;
  paidUntil: string | null;
  daysLeft: number | null;
}

export interface TenantSettings {
  id: string;
  name: string;
  slug: string;
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  logoUrl: string | null;
  coverUrl: string | null;
  brandColor: string | null;
  heroColor: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  zipCode: string | null;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryFee: string;
  minOrderValue: string;
  isOpen: boolean;
  dineInOrderingEnabled: boolean;
  subscription?: TenantSubscription;
  stripeSubscriptionId?: string | null;
}

export function useBillingConfig() {
  return useQuery({
    queryKey: ['billing-config'],
    queryFn: async () => (await api.get<{ enabled: boolean }>('/billing/config')).data,
  });
}

export interface OpeningHour {
  id?: string;
  weekday: number;
  openMinute: number;
  closeMinute: number;
}

export function useTenant() {
  return useQuery({
    queryKey: ['tenant-me'],
    queryFn: async () => (await api.get<TenantSettings>('/tenants/me')).data,
  });
}

// valores enviados ao servidor (deliveryFee/minOrderValue vão como número)
export type UpdateTenantInput = Record<string, string | number | boolean>;

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: UpdateTenantInput) =>
      (await api.patch<TenantSettings>('/tenants/me', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-me'] }),
  });
}

export function useHours() {
  return useQuery({
    queryKey: ['hours'],
    queryFn: async () => (await api.get<OpeningHour[]>('/tenants/me/hours')).data,
  });
}

export function useSetHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hours: OpeningHour[]) =>
      (await api.put<OpeningHour[]>('/tenants/me/hours', { hours })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hours'] }),
  });
}
