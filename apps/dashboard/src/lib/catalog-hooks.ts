'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Category, Product } from './types';

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

export interface CreateGroupInput {
  productId: string;
  name: string;
  required: boolean;
  maxSelect: number;
}

export function useCreateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, name, required, maxSelect }: CreateGroupInput) =>
      (
        await api.post(`/catalog/products/${productId}/modifier-groups`, {
          name,
          required,
          minSelect: required ? 1 : 0,
          maxSelect,
        })
      ).data,
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['product', vars.productId] }),
  });
}

export function useDeleteModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; productId: string }) =>
      (await api.delete(`/catalog/modifier-groups/${id}`)).data,
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['product', vars.productId] }),
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
      productId: string;
      name: string;
      priceDelta: number;
    }) => (await api.post(`/catalog/modifier-groups/${groupId}/modifiers`, { name, priceDelta })).data,
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['product', vars.productId] }),
  });
}

export function useDeleteModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; productId: string }) =>
      (await api.delete(`/catalog/modifiers/${id}`)).data,
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['product', vars.productId] }),
  });
}
