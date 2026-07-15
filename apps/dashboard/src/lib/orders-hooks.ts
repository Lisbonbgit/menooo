'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useMutation } from '@tanstack/react-query';
import { api, ensureFreshSession } from './api';
import { useAuthStore } from './auth-store';
import { playAlarm } from './alarm';
import type { Order, OrderStatus } from './types';

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** tenantId do access token (o socket junta-se à sala desta unidade). */
function tokenTenantId(token: string | null): string | null {
  if (!token) return null;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)).tenantId ?? null;
  } catch {
    return null;
  }
}

/** Carrega encomendas e mantém-nas atualizadas em tempo real via WebSocket. */
export function useLiveOrders(onNewOrder?: (order: Order) => void) {
  const activeTenantId = useAuthStore((s) => tokenTenantId(s.token));
  const [orders, setOrders] = useState<Order[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // manter o callback fresco sem reabrir o socket
  const onNewOrderRef = useRef(onNewOrder);
  onNewOrderRef.current = onNewOrder;

  useEffect(() => {
    if (!activeTenantId) return;
    let alive = true;

    // o socket NÃO repõe eventos perdidos num gap de ligação — cada connect
    // (inclui reconexões) re-sincroniza a lista completa
    const sync = () => {
      api
        .get<Order[]>('/orders')
        .then((res) => {
          if (alive) setOrders(res.data);
        })
        .catch(() => {
          /* sem rede: o próximo connect volta a tentar */
        });
    };
    sync();

    const socket = io(WS_URL, {
      // token FRESCO em cada (re)tentativa — um quadro parado para lá do TTL
      // religa com o token renovado em vez de cair num loop de disconnect
      auth: (cb) => cb({ token: useAuthStore.getState().token }),
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      sync();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => {
      // handshake recusado (token expirado): renova; o retry automático do
      // socket.io volta a chamar o auth-callback já com o token novo
      void ensureFreshSession();
    });

    socket.on('order.created', (order: Order) => {
      setOrders((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
      playAlarm();
      onNewOrderRef.current?.(order);
    });

    socket.on('order.updated', (order: Order) => {
      setOrders((prev) => prev.map((o) => (o.id === order.id ? order : o)));
    });

    // tablet volta a foreground: reconexão agressiva com token fresco
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !socket.connected) {
        void ensureFreshSession().finally(() => socket.connect());
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
      socketRef.current = null;
    };
    // rotação do token NÃO reabre o socket (auth é callback); trocar de unidade SIM
  }, [activeTenantId]);

  return { orders, setOrders, connected };
}

export function useUpdateOrderStatus() {
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OrderStatus }) =>
      (await api.patch<Order>(`/orders/${id}/status`, { status })).data,
  });
}
