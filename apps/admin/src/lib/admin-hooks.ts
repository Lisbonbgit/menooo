'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface AdminTenant {
  id: string;
  slug: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  plan: string;
  city: string | null;
  owner: { name: string; email: string } | null;
  orders: number;
  products: number;
  createdAt: string;
}

export interface AdminStats {
  total: number;
  active: number;
  pending: number;
  orders: number;
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

export function useSetTenantStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AdminTenant['status'] }) =>
      (await api.patch(`/admin/tenants/${id}/status`, { status })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
  });
}
