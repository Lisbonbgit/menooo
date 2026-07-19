'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';
import type { Category, MenuType, ModifierGroupWithUsage, Product } from './types';

// ----- Categorias -----
export function useCategories(menu: MenuType = 'delivery') {
  return useQuery({
    queryKey: ['categories', menu],
    queryFn: async () => (await api.get<Category[]>('/catalog/categories', { params: { menu } })).data,
  });
}

export function useCreateCategory(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      (await api.post<Category>('/catalog/categories', { name }, { params: { menu } })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories', menu] }),
  });
}

export function useUpdateCategory(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      (await api.patch<Category>(`/catalog/categories/${id}`, { name })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories', menu] }),
  });
}

export function useDeleteCategory(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/catalog/categories/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories', menu] });
      qc.invalidateQueries({ queryKey: ['products', menu] });
    },
  });
}

// ----- Produtos -----
export function useProducts(menu: MenuType = 'delivery') {
  return useQuery({
    queryKey: ['products', menu],
    queryFn: async () => (await api.get<Product[]>('/catalog/products', { params: { menu } })).data,
  });
}

export interface CreateProductInput {
  categoryId: string;
  name: string;
  price: number;
  description?: string;
  vatRate?: number;
}

export function useCreateProduct(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProductInput) =>
      (await api.post<Product>('/catalog/products', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', menu] }),
  });
}

export function useToggleProduct(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await api.patch<Product>(`/catalog/products/${id}`, { active })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', menu] }),
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

export function useUpdateProduct(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateProductInput) =>
      (await api.patch<Product>(`/catalog/products/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', menu] }),
  });
}

export function useDeleteProduct(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/catalog/products/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', menu] }),
  });
}

/** Reordena os produtos de UMA categoria em lote (otimista na cache ['products', menu]). */
export function useReorderProducts(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ categoryId, ids }: { categoryId: string; ids: string[] }) =>
      (await api.put('/catalog/products/reorder', { categoryId, ids })).data,
    onMutate: async ({ categoryId, ids }) => {
      await qc.cancelQueries({ queryKey: ['products', menu] });
      const anterior = qc.getQueryData<Product[]>(['products', menu]);
      qc.setQueryData<Product[]>(['products', menu], (old) => {
        if (!old) return old;
        const daCategoria = new Map(
          old.filter((p) => p.categoryId === categoryId).map((p) => [p.id, p]),
        );
        const reordenados = ids
          .map((id, i) => {
            const p = daCategoria.get(id);
            return p ? { ...p, sortOrder: i } : undefined;
          })
          .filter((p): p is Product => p !== undefined);
        let i = 0;
        return old.map((p) => (p.categoryId === categoryId ? reordenados[i++] ?? p : p));
      });
      return { anterior };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.anterior) qc.setQueryData(['products', menu], ctx.anterior);
      toast.error('Não foi possível reordenar os produtos.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['products', menu] }),
  });
}

/** Reordena as CATEGORIAS de um menu (otimista na cache ['categories', menu]). */
export function useReorderCategories(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) =>
      (await api.put('/catalog/categories/reorder', { ids }, { params: { menu } })).data,
    onMutate: async ({ ids }) => {
      await qc.cancelQueries({ queryKey: ['categories', menu] });
      const anterior = qc.getQueryData<Category[]>(['categories', menu]);
      qc.setQueryData<Category[]>(['categories', menu], (old) => {
        if (!old) return old;
        const byId = new Map(old.map((c) => [c.id, c]));
        return ids
          .map((id, i) => {
            const c = byId.get(id);
            return c ? { ...c, sortOrder: i } : undefined;
          })
          .filter((c): c is Category => c !== undefined);
      });
      return { anterior };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.anterior) qc.setQueryData(['categories', menu], ctx.anterior);
      toast.error('Não foi possível reordenar as categorias.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['categories', menu] }),
  });
}

// ----- Grupos de opções (biblioteca por menu) -----
export function useProductDetail(id: string, enabled = true) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: async () => (await api.get<Product>(`/catalog/products/${id}`)).data,
    enabled,
  });
}

export function useModifierGroups(menu: MenuType = 'delivery') {
  return useQuery({
    queryKey: ['modifier-groups', menu],
    queryFn: async () =>
      (await api.get<ModifierGroupWithUsage[]>('/catalog/modifier-groups', { params: { menu } })).data,
  });
}

export function useCreateModifierGroup(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, required, maxSelect }: { name: string; required: boolean; maxSelect: number }) =>
      (
        await api.post(
          '/catalog/modifier-groups',
          { name, required, minSelect: required ? 1 : 0, maxSelect },
          { params: { menu } },
        )
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups', menu] }),
  });
}

export function useUpdateModifierGroup(menu: MenuType = 'delivery') {
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
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useDeleteModifierGroup(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) =>
      (await api.delete(`/catalog/modifier-groups/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useAttachGroup(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, groupId }: { productId: string; groupId: string }) =>
      (await api.post(`/catalog/products/${productId}/modifier-groups/${groupId}`)).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['product', vars.productId] });
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
    },
  });
}

export function useDetachGroup(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, groupId }: { productId: string; groupId: string }) =>
      (await api.delete(`/catalog/products/${productId}/modifier-groups/${groupId}`)).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['product', vars.productId] });
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
    },
  });
}

export function useCreateModifier(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, name, priceDelta }: { groupId: string; name: string; priceDelta: number }) =>
      (await api.post(`/catalog/modifier-groups/${groupId}/modifiers`, { name, priceDelta })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useDeleteModifier(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => (await api.delete(`/catalog/modifiers/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}
