'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  ReceiptEuro,
  CookingPot,
  TrendingUp,
  ShoppingBag,
  ArrowUpRight,
  Bike,
} from 'lucide-react';
import { api } from '@/lib/api';
import { AppShell } from '@/components/AppShell';
import type { Order, OrderStatus } from '@/lib/types';

interface Summary {
  todayCount: number;
  todayRevenue: number;
  activeCount: number;
  avgTicket7d: number;
  series: { date: string; count: number; revenue: number }[];
}

const STATUS_BADGE: Record<OrderStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Novo', cls: 'bg-amber-100 text-amber-800' },
  ACCEPTED: { label: 'Aceite', cls: 'bg-blue-100 text-blue-800' },
  PREPARING: { label: 'A preparar', cls: 'bg-indigo-100 text-indigo-800' },
  READY: { label: 'Pronto', cls: 'bg-green-100 text-green-800' },
  OUT_FOR_DELIVERY: { label: 'A caminho', cls: 'bg-teal-100 text-teal-800' },
  COMPLETED: { label: 'Concluído', cls: 'bg-stone-200 text-stone-600' },
  REJECTED: { label: 'Recusado', cls: 'bg-red-100 text-red-800' },
  CANCELLED: { label: 'Cancelado', cls: 'bg-stone-200 text-stone-500' },
};

const eur = (v: number) =>
  v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 20) return 'Boa tarde';
  return 'Boa noite';
}

export default function OverviewPage() {
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: async () => (await api.get<Summary>('/orders/summary')).data,
    refetchInterval: 60_000,
  });
  const orders = useQuery({
    queryKey: ['orders-recent'],
    queryFn: async () => (await api.get<Order[]>('/orders')).data,
    refetchInterval: 60_000,
  });

  const s = summary.data;
  const recent = (orders.data ?? []).slice(0, 6);
  const maxRevenue = Math.max(1, ...(s?.series ?? []).map((d) => d.revenue));
  const todayLabel = new Date().toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <AppShell
      title={`${greeting()} 👋`}
      actions={<span className="text-[13px] capitalize text-ink-soft">{todayLabel}</span>}
    >
      {/* indicadores */}
      <div className="stagger grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard
          icon={<ShoppingBag size={17} />}
          label="Encomendas hoje"
          value={s ? String(s.todayCount) : '—'}
        />
        <StatCard
          icon={<ReceiptEuro size={17} />}
          label="Receita hoje"
          value={s ? eur(s.todayRevenue) : '—'}
          accent
        />
        <StatCard
          icon={<CookingPot size={17} />}
          label="Ativas agora"
          value={s ? String(s.activeCount) : '—'}
          hint={s && s.activeCount > 0 ? 'em curso na cozinha' : 'sem pedidos em curso'}
        />
        <StatCard
          icon={<TrendingUp size={17} />}
          label="Ticket médio · 7 dias"
          value={s ? eur(s.avgTicket7d) : '—'}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        {/* gráfico 7 dias */}
        <section className="animate-fade-up rounded-2xl border border-line bg-white p-5 shadow-card lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">Últimos 7 dias</h2>
            <span className="text-xs text-ink-mute">receita/dia</span>
          </div>
          <div className="flex h-36 items-end gap-2.5">
            {(s?.series ?? Array.from({ length: 7 }, () => null)).map((d, i) => {
              const h = d ? Math.max(4, Math.round((d.revenue / maxRevenue) * 100)) : 4;
              const isToday = i === 6;
              return (
                <div key={i} className="group flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[10px] font-medium text-ink-mute opacity-0 transition-opacity group-hover:opacity-100">
                    {d ? eur(d.revenue) : ''}
                  </span>
                  <div
                    className={clsx(
                      'w-full rounded-t-md transition-all',
                      isToday ? 'bg-brand' : 'bg-cream group-hover:bg-brand/40',
                    )}
                    style={{ height: `${h}%` }}
                  />
                  <span className="text-[10px] uppercase text-ink-mute">
                    {d
                      ? new Date(d.date + 'T00:00:00').toLocaleDateString('pt-PT', {
                          weekday: 'short',
                        }).slice(0, 3)
                      : '·'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* encomendas recentes */}
        <section className="animate-fade-up rounded-2xl border border-line bg-white shadow-card lg:col-span-3">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">Encomendas recentes</h2>
            <Link
              href="/orders"
              className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline"
            >
              Abrir receção <ArrowUpRight size={14} />
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <ShoppingBag className="text-ink-mute" size={28} strokeWidth={1.5} />
              <p className="text-sm text-ink-soft">Ainda sem encomendas.</p>
              <p className="text-xs text-ink-mute">
                Partilha o link da tua loja para receberes a primeira. 🚀
              </p>
            </div>
          ) : (
            <ul className="stagger divide-y divide-line">
              {recent.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-10 font-display text-[15px] font-semibold text-ink">
                    #{o.number}
                  </span>
                  <span className="text-ink-mute">
                    {o.type === 'DELIVERY' ? <Bike size={15} /> : <ShoppingBag size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{o.customerName}</p>
                    <p className="text-[11.5px] text-ink-mute">
                      {new Date(o.createdAt).toLocaleTimeString('pt-PT', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' · '}
                      {o.items.reduce((n, it) => n + it.quantity, 0)} itens
                    </p>
                  </div>
                  <span
                    className={clsx(
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                      STATUS_BADGE[o.status].cls,
                    )}
                  >
                    {STATUS_BADGE[o.status].label}
                  </span>
                  <span className="w-16 text-right text-[13.5px] font-semibold">
                    {eur(Number(o.total))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={clsx(
        'rounded-2xl border p-4 shadow-card transition-transform hover:-translate-y-0.5',
        accent ? 'border-brand/25 bg-brand text-white' : 'border-line bg-white',
      )}
    >
      <div
        className={clsx(
          'mb-3 flex h-8 w-8 items-center justify-center rounded-lg',
          accent ? 'bg-white/15 text-white' : 'bg-brand-soft text-brand-dark',
        )}
      >
        {icon}
      </div>
      <p className={clsx('text-[12px]', accent ? 'text-white/75' : 'text-ink-mute')}>{label}</p>
      <p className="mt-0.5 font-display text-2xl font-semibold tracking-tight">{value}</p>
      {hint && (
        <p className={clsx('mt-1 text-[11px]', accent ? 'text-white/60' : 'text-ink-mute')}>
          {hint}
        </p>
      )}
    </div>
  );
}
