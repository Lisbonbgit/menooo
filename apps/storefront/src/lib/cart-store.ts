'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartModifier {
  id: string;
  name: string;
  priceDelta: number;
}

export interface CartItem {
  key: string; // produto + opções escolhidas (para agrupar iguais)
  productId: string;
  name: string;
  unitPrice: number; // base + opções (apenas para mostrar; servidor recalcula)
  quantity: number;
  vatRate: number; // taxa de IVA (%) do produto — para o resumo
  modifiers: CartModifier[];
}

interface CartState {
  storeSlug: string | null;
  items: CartItem[];
  /** Há um carrinho de OUTRA loja que seria substituído ao adicionar nesta? */
  conflictsWith: (slug: string) => boolean;
  addItem: (slug: string, item: Omit<CartItem, 'key' | 'quantity'>, quantity?: number) => void;
  setQuantity: (key: string, quantity: number) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  totalItems: () => number;
  subtotal: () => number;
}

function makeKey(productId: string, modifiers: CartModifier[]) {
  return productId + '::' + modifiers.map((m) => m.id).sort().join(',');
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      storeSlug: null,
      items: [],

      conflictsWith: (slug) => {
        const s = get();
        return !!s.storeSlug && s.storeSlug !== slug && s.items.length > 0;
      },

      addItem: (slug, item, quantity = 1) => {
        const state = get();
        // carrinho é por loja: trocar de loja limpa o carrinho
        // (a UI confirma com o cliente antes, via conflictsWith)
        const base = state.storeSlug && state.storeSlug !== slug ? [] : state.items;
        const key = makeKey(item.productId, item.modifiers);
        const existing = base.find((i) => i.key === key);
        const items = existing
          ? base.map((i) => (i.key === key ? { ...i, quantity: i.quantity + quantity } : i))
          : [...base, { ...item, key, quantity }];
        set({ storeSlug: slug, items });
      },

      setQuantity: (key, quantity) =>
        set((s) => ({
          items:
            quantity <= 0
              ? s.items.filter((i) => i.key !== key)
              : s.items.map((i) => (i.key === key ? { ...i, quantity } : i)),
        })),

      removeItem: (key) => set((s) => ({ items: s.items.filter((i) => i.key !== key) })),

      clear: () => set({ items: [], storeSlug: null }),

      totalItems: () => get().items.reduce((n, i) => n + i.quantity, 0),

      subtotal: () => get().items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    }),
    { name: 'menoo-cart' },
  ),
);
