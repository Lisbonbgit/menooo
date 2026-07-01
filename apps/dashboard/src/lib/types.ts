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
  sortOrder: number;
  modifiers: Modifier[];
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: string;
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
  deliveryAddress: string | null;
  notes: string | null;
  subtotal: string;
  deliveryFee: string;
  total: string;
  paymentMethod: string;
  createdAt: string;
  items: OrderItem[];
}
