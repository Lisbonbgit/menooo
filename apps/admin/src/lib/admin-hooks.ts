'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type TenantStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export interface AdminTenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: string;
  city: string | null;
  owner: { name: string; email: string } | null;
  products: number;
  orders: number;
  revenue: number;
  customers: number;
  lastOrderAt: string | null;
  createdAt: string;
  activatedAt: string | null;
}

export interface AdminStats {
  total: number;
  active: number;
  pending: number;
  orders: number;
  gmvTotal: number;
  orders30d: number;
  gmv30d: number;
  newTenants30d: number;
}

export interface TenantDetail {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  owner: { name: string; email: string } | null;
  products: number;
  categories: number;
  createdAt: string;
  activatedAt: string | null;
  isOpen: boolean;
  metrics: {
    orders: number;
    revenue: number;
    customers: number;
    avgTicket: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
  };
  monthly: { month: string; orders: number; revenue: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  recentOrders: { id: string; number: number; status: string; total: number; createdAt: string }[];
}

export function useStats() {
  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => (await api.get<AdminStats>('/admin/stats')).data,
  });
}

export function useTenants() {
  return useQuery({
    queryKey: ['admin-tenants'],
    queryFn: async () => (await api.get<AdminTenant[]>('/admin/tenants')).data,
  });
}

export function useTenantDetail(id: string | null) {
  return useQuery({
    queryKey: ['admin-tenant', id],
    queryFn: async () => (await api.get<TenantDetail>(`/admin/tenants/${id}`)).data,
    enabled: !!id,
  });
}

export function useSetTenantStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TenantStatus }) =>
      (await api.patch(`/admin/tenants/${id}/status`, { status })).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      qc.invalidateQueries({ queryKey: ['admin-tenant', vars.id] });
    },
  });
}
