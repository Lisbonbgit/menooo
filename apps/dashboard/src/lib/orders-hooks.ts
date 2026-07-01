'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useMutation } from '@tanstack/react-query';
import { api } from './api';
import { useAuthStore } from './auth-store';
import { playAlarm } from './alarm';
import type { Order, OrderStatus } from './types';

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Carrega encomendas e mantém-nas atualizadas em tempo real via WebSocket. */
export function useLiveOrders(onNewOrder?: (order: Order) => void) {
  const token = useAuthStore((s) => s.token);
  const [orders, setOrders] = useState<Order[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // manter o callback fresco sem reabrir o socket
  const onNewOrderRef = useRef(onNewOrder);
  onNewOrderRef.current = onNewOrder;

  useEffect(() => {
    if (!token) return;

    // carga inicial
    api.get<Order[]>('/orders').then((res) => setOrders(res.data));

    // ligação em tempo real
    const socket = io(WS_URL, { auth: { token }, transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('order.created', (order: Order) => {
      setOrders((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
      playAlarm();
      onNewOrderRef.current?.(order);
    });

    socket.on('order.updated', (order: Order) => {
      setOrders((prev) => prev.map((o) => (o.id === order.id ? order : o)));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  return { orders, setOrders, connected };
}

export function useUpdateOrderStatus() {
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OrderStatus }) =>
      (await api.patch<Order>(`/orders/${id}/status`, { status })).data,
  });
}
