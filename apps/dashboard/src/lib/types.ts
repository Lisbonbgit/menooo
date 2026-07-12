export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface Modifier {
  id: string;
  name: string;
  priceDelta: string;
  sortOrder: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

/** grupo da biblioteca com a contagem de produtos onde está anexado */
export type ModifierGroupWithUsage = ModifierGroup & { usedIn: number };

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: string;
  vatRate: number;
  imageUrl: string | null;
  active: boolean;
  sortOrder: number;
  modifierGroups?: ModifierGroup[];
}

export type OrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED';

export interface OrderItemModifier {
  id: string;
  name: string;
  priceDelta: string;
}

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: string;
  total: string;
  modifiers: OrderItemModifier[];
}

export interface Order {
  id: string;
  number: number;
  status: OrderStatus;
  type: 'DELIVERY' | 'PICKUP';
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  marketingConsent: boolean;
  deliveryAddress: string | null;
  deliveryCity: string | null;
  deliveryZipCode: string | null;
  notes: string | null;
  scheduledFor: string | null;
  subtotal: string;
  deliveryFee: string;
  discount: string;
  couponCode: string | null;
  total: string;
  vatTotal: string;
  paymentMethod: string;
  changeFor: string | null;
  createdAt: string;
  items: OrderItem[];
}
