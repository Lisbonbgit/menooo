'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Category, ModifierGroupWithUsage, Product } from './types';

// ----- Categorias -----
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<Category[]>('/catalog/categories')).data,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      (await api.post<Category>('/catalog/categories', { name })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/catalog/categories/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

// ----- Produtos -----
export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get<Product[]>('/catalog/products')).data,
  });
}

export interface CreateProductInput {
  categoryId: string;
  name: string;
  price: number;
  description?: string;
  vatRate?: number;
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProductInput) =>
      (await api.post<Product>('/catalog/products', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useToggleProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await api.patch<Product>(`/catalog/products/${id}`, { active })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export type UpdateProductInput = { id: string } & Partial<{
  name: string;
  price: number;
  description: string;
  categoryId: string;
  imageUrl: string;
  active: boolean;
  vatRate: number;
}>;

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateProductInput) =>
      (await api.patch<Product>(`/catalog/products/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/catalog/products/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

// ----- Grupos de opções (subgrupos dentro do produto: Tamanho, Extras…) -----
export function useProductDetail(id: string, enabled = true) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: async () => (await api.get<Product>(`/catalog/products/${id}`)).data,
    enabled,
  });
}

// biblioteca de grupos do restaurante (aba Personalizações)
export function useModifierGroups() {
  return useQuery({
    queryKey: ['modifier-groups'],
    queryFn: async () =>
      (await api.get<ModifierGroupWithUsage[]>('/catalog/modifier-groups')).data,
  });
}

export function useCreateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      required,
      maxSelect,
    }: {
      name: string;
      required: boolean;
      maxSelect: number;
    }) =>
      (
        await api.post('/catalog/modifier-groups', {
          name,
          required,
          minSelect: required ? 1 : 0,
          maxSelect,
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useUpdateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      required?: boolean;
      minSelect?: number;
      maxSelect?: number;
    }) => (await api.patch(`/catalog/modifier-groups/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useDeleteModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) =>
      (await api.delete(`/catalog/modifier-groups/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

// ligação grupo ↔ produto (aba Vista geral)
export function useAttachGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, groupId }: { productId: string; groupId: string }) =>
      (await api.post(`/catalog/products/${productId}/modifier-groups/${groupId}`)).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['product', vars.productId] });
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
    },
  });
}

export function useDetachGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, groupId }: { productId: string; groupId: string }) =>
      (await api.delete(`/catalog/products/${productId}/modifier-groups/${groupId}`)).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['product', vars.productId] });
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
    },
  });
}

export function useCreateModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      groupId,
      name,
      priceDelta,
    }: {
      groupId: string;
      name: string;
      priceDelta: number;
    }) => (await api.post(`/catalog/modifier-groups/${groupId}/modifiers`, { name, priceDelta })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useDeleteModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) =>
      (await api.delete(`/catalog/modifiers/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}
