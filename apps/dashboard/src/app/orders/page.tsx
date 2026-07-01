'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import {
  Bike,
  ShoppingBag,
  Wifi,
  WifiOff,
  Printer,
  Settings2,
  Check,
  X,
  ChefHat,
  PackageCheck,
  Send,
  Inbox,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useLiveOrders, useUpdateOrderStatus } from '@/lib/orders-hooks';
import { usePrintStore } from '@/lib/print-store';
import { printOrder } from '@/lib/print';
import { AppShell } from '@/components/AppShell';
import { PrinterSettings } from '@/components/PrinterSettings';
import type { Order, OrderStatus } from '@/lib/types';

const COLUMNS: {
  key: string;
  title: string;
  dot: string;
  statuses: OrderStatus[];
  empty: string;
}[] = [
  { key: 'new', title: 'Novos', dot: 'bg-amber-500', statuses: ['PENDING'], empty: 'Sem pedidos novos' },
  {
    key: 'prep',
    title: 'Em preparação',
    dot: 'bg-blue-500',
    statuses: ['ACCEPTED', 'PREPARING'],
    empty: 'Nada na cozinha',
  },
  { key: 'ready', title: 'Prontos', dot: 'bg-green-500', statuses: ['READY'], empty: 'Nada pronto' },
  {
    key: 'out',
    title: 'Em entrega',
    dot: 'bg-teal-500',
    statuses: ['OUT_FOR_DELIVERY'],
    empty: 'Ninguém na estrada',
  },
];

const FINISHED: OrderStatus[] = ['COMPLETED', 'REJECTED', 'CANCELLED'];

function elapsed(iso: string) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

function nextActions(
  order: Order,
): { label: string; status: OrderStatus; icon: React.ReactNode; danger?: boolean }[] {
  switch (order.status) {
    case 'PENDING':
      return [
        { label: 'Aceitar', status: 'ACCEPTED', icon: <Check size={15} /> },
        { label: '', status: 'REJECTED', icon: <X size={15} />, danger: true },
      ];
    case 'ACCEPTED':
      return [{ label: 'Preparar', status: 'PREPARING', icon: <ChefHat size={15} /> }];
    case 'PREPARING':
      return [{ label: 'Pronto', status: 'READY', icon: <PackageCheck size={15} /> }];
    case 'READY':
      return order.type === 'DELIVERY'
        ? [{ label: 'Enviar', status: 'OUT_FOR_DELIVERY', icon: <Send size={15} /> }]
        : [{ label: 'Concluir', status: 'COMPLETED', icon: <Check size={15} /> }];
    case 'OUT_FOR_DELIVERY':
      return [{ label: 'Concluir', status: 'COMPLETED', icon: <Check size={15} /> }];
    default:
      return [];
  }
}

export default function OrdersPage() {
  const [showSettings, setShowSettings] = useState(false);
  const autoPrint = usePrintStore((s) => s.autoPrint);

  const tenant = useQuery({
    queryKey: ['tenant-me'],
    queryFn: async () => (await api.get('/tenants/me')).data as { name: string },
  });
  const storeName = tenant.data?.name ?? 'Restaurante';

  // relógio para os tempos decorridos
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const print = useCallback(
    async (order: Order) => {
      try {
        await printOrder(order, storeName);
      } catch (e: any) {
        toast.error(e?.message ?? 'Erro ao imprimir');
      }
    },
    [storeName],
  );

  const onNewOrder = useCallback(
    (order: Order) => {
      if (usePrintStore.getState().autoPrint) {
        printOrder(order, storeName).catch(() =>
          toast.error(`Falha a imprimir #${order.number}`),
        );
      }
    },
    [storeName],
  );

  const { orders, setOrders, connected } = useLiveOrders(onNewOrder);
  const updateStatus = useUpdateOrderStatus();

  async function advance(order: Order, status: OrderStatus) {
    try {
      const updated = await updateStatus.mutateAsync({ id: order.id, status });
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Erro ao atualizar estado');
    }
  }

  const finished = orders.filter((o) => FINISHED.includes(o.status));

  return (
    <AppShell
      title="Receção"
      actions={
        <>
          <span
            className={clsx(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold',
              connected ? 'bg-green-100 text-green-800' : 'bg-stone-200 text-stone-500',
            )}
          >
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            {connected ? 'Ao vivo' : 'A ligar…'}
          </span>
          {autoPrint && (
            <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-[12px] font-semibold text-brand-dark">
              <Printer size={13} /> auto
            </span>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 py-2 text-[13px] font-medium shadow-card transition-colors hover:border-brand/40"
          >
            <Settings2 size={15} /> Impressão
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = orders.filter((o) => col.statuses.includes(o.status));
          return (
            <section key={col.key} className="flex min-h-[240px] flex-col">
              <header className="mb-3 flex items-center gap-2 px-1">
                <span className={clsx('h-2 w-2 rounded-full', col.dot)} />
                <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-soft">
                  {col.title}
                </h2>
                <span className="ml-auto rounded-full bg-cream px-2 py-0.5 text-[11.5px] font-semibold text-ink-soft">
                  {list.length}
                </span>
              </header>
              <div className="stagger flex flex-1 flex-col gap-3">
                {list.length === 0 && (
                  <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line py-8 text-center">
                    <Inbox size={20} className="text-ink-mute" strokeWidth={1.5} />
                    <p className="text-[12px] text-ink-mute">{col.empty}</p>
                  </div>
                )}
                {list.map((o) => (
                  <OrderCard key={o.id} order={o} onAdvance={advance} onPrint={print} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {finished.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-soft">
            Histórico de hoje ({finished.length})
          </summary>
          <ul className="mt-3 grid gap-1.5 md:grid-cols-2">
            {finished.slice(0, 20).map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-2.5 text-[13px]"
              >
                <span className="font-medium">
                  #{o.number} · {o.customerName}
                </span>
                <span
                  className={clsx(
                    'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    o.status === 'COMPLETED'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-700',
                  )}
                >
                  {o.status === 'COMPLETED'
                    ? 'Concluído'
                    : o.status === 'REJECTED'
                      ? 'Recusado'
                      : 'Cancelado'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {showSettings && (
        <PrinterSettings storeName={storeName} onClose={() => setShowSettings(false)} />
      )}
    </AppShell>
  );
}

function OrderCard({
  order,
  onAdvance,
  onPrint,
}: {
  order: Order;
  onAdvance: (o: Order, s: OrderStatus) => void;
  onPrint: (o: Order) => void;
}) {
  const isNew = order.status === 'PENDING';
  return (
    <article
      className={clsx(
        'rounded-2xl border bg-white p-4 shadow-card transition-shadow hover:shadow-lift',
        isNew ? 'border-brand/50 animate-ring-new' : 'border-line',
      )}
    >
      <div className="mb-2.5 flex items-start justify-between">
        <div>
          <p className="font-display text-lg font-semibold leading-none">#{order.number}</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-soft">
            {order.type === 'DELIVERY' ? <Bike size={13} /> : <ShoppingBag size={13} />}
            {order.type === 'DELIVERY' ? 'Entrega' : 'Take-away'}
            <span className="text-ink-mute">· há {elapsed(order.createdAt)}</span>
          </p>
        </div>
        <button
          onClick={() => onPrint(order)}
          title="Imprimir talão"
          className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-brand/40 hover:text-brand-dark"
        >
          <Printer size={14} />
        </button>
      </div>

      <p className="text-[13.5px] font-medium">{order.customerName}</p>
      <p className="text-[11.5px] text-ink-mute">{order.customerPhone}</p>
      {order.deliveryAddress && (
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-mute">{order.deliveryAddress}</p>
      )}

      <ul className="my-3 space-y-1 border-y border-dashed border-line py-2.5 text-[12.5px]">
        {order.items.map((it) => (
          <li key={it.id} className="flex gap-1.5">
            <span className="font-semibold text-brand-dark">{it.quantity}×</span>
            <span className="min-w-0 flex-1">
              {it.name}
              {it.modifiers.length > 0 && (
                <span className="text-ink-mute"> · {it.modifiers.map((m) => m.name).join(', ')}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="mb-2.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] italic text-amber-900">
          “{order.notes}”
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[15px] font-semibold">
          {Number(order.total).toFixed(2)} €
        </span>
        <div className="flex gap-1.5">
          {nextActions(order).map((a) => (
            <button
              key={a.status}
              onClick={() => onAdvance(order, a.status)}
              title={a.danger ? 'Recusar' : a.label}
              className={clsx(
                'flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold text-white transition-transform active:scale-95',
                a.danger
                  ? 'bg-stone-300 text-stone-600 hover:bg-red-600 hover:text-white'
                  : 'bg-brand shadow-card hover:bg-brand-dark',
              )}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}
