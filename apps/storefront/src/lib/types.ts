export interface Store {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  brandColor: string | null;
  heroColor: string | null;
  city: string | null;
  currency: string;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryFee: string;
  minOrderValue: string;
  isOpen: boolean;
  reservationsEnabled: boolean;
  /** Loja aceita pedidos feitos à mesa (Fase 2b) — decide se `/mesa/[qrToken]` mostra carrinho. */
  dineInOrderingEnabled: boolean;
  // Só vêm no payload quando `reservationsEnabled` — a API não publica o contacto e a morada de
  // quem não usa reservas. Opcionais de propósito: o typecheck obriga a tratar a ausência.
  phone?: string | null;
  address?: string | null;
  zipCode?: string | null;
  reservationMaxPartySize?: number;
  reservationMaxAdvanceDays?: number;
  /** Tolerância de atraso, em minutos: «A tua mesa fica guardada X minutos». */
  reservationGraceMin?: number;
}

export interface Modifier {
  id: string;
  name: string;
  priceDelta: string;
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: string;
  vatRate: number;
  imageUrl: string | null;
  modifierGroups: ModifierGroup[];
}

export interface MenuCategory {
  id: string;
  name: string;
  products: Product[];
}

export interface TableInfo {
  id: string;
  name: string;
}

export interface OrderTracking {
  number: number;
  status:
    | 'PENDING' | 'ACCEPTED' | 'PREPARING' | 'READY'
    | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
  type: 'DELIVERY' | 'PICKUP';
  createdAt: string;
  total: number;
  restaurantName: string;
  slug: string;
  items: { name: string; quantity: number }[];
}
