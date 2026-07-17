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
  phone: string | null;
  address: string | null;
  zipCode: string | null;
  reservationMaxPartySize: number;
  reservationMaxAdvanceDays: number;
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
