'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ShoppingBag, Bike, ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api';
import { AppShell } from '@/components/AppShell';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import type { Order, OrderStatus } from '@/lib/types';

interface Summary {
  todayCount: number;
  todayRevenue: number;
  activeCount: number;
  avgTicket7d: number;
  series: { date: string; count: number; revenue: number }[];
}

const STATUS_META: Record<OrderStatus, { label: string; dot: string }> = {
  PENDING: { label: 'Novo', dot: 'bg-amber-500' },
  ACCEPTED: { label: 'Aceite', dot: 'bg-blue-500' },
  PREPARING: { label: 'A preparar', dot: 'bg-blue-500' },
  READY: { label: 'Pronto', dot: 'bg-green-600' },
  OUT_FOR_DELIVERY: { label: 'A caminho', dot: 'bg-teal-600' },
  COMPLETED: { label: 'Concluído', dot: 'bg-stone-400' },
  REJECTED: { label: 'Recusado', dot: 'bg-red-500' },
  CANCELLED: { label: 'Cancelado', dot: 'bg-stone-400' },
};

const eur = (v: number) => v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });

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
      title={greeting()}
      kicker={todayLabel}
      actions={
        <Link
          href="/orders"
          className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-[13px] font-medium transition-colors hover:border-brand/40"
        >
          Abrir receção <ArrowUpRight size={14} />
        </Link>
      }
    >
      {/* checklist de arranque do trial (esconde-se quando completo/dispensado) */}
      <OnboardingChecklist />

      {/* banda de indicadores */}
      <div className="animate-fade-up grid grid-cols-2 divide-line rounded-xl border border-line bg-white sm:grid-cols-4 sm:divide-x">
        <Stat label="Encomendas hoje" value={s ? String(s.todayCount) : '—'} />
        <Stat label="Receita hoje" value={s ? eur(s.todayRevenue) : '—'} accent />
        <Stat
          label="Ativas agora"
          value={s ? String(s.activeCount) : '—'}
          hint={s && s.activeCount > 0 ? 'em curso na cozinha' : 'sem pedidos em curso'}
        />
        <Stat label="Ticket médio · 7 dias" value={s ? eur(s.avgTicket7d) : '—'} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        {/* gráfico 7 dias */}
        <section className="animate-fade-up rounded-xl border border-line bg-white p-5 lg:col-span-2">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              Últimos 7 dias
            </h2>
            <span className="text-[11px] text-ink-mute">receita por dia</span>
          </div>
          <div className="flex h-36 items-end gap-2">
            {(s?.series ?? Array.from({ length: 7 }, () => null)).map((d, i) => {
              const h = d ? Math.max(3, Math.round((d.revenue / maxRevenue) * 100)) : 3;
              const isToday = i === 6;
              return (
                <div key={i} className="group flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[10px] font-medium tabular-nums text-ink-mute opacity-0 transition-opacity group-hover:opacity-100">
                    {d ? eur(d.revenue) : ''}
                  </span>
                  <div
                    className={clsx(
                      'w-full transition-colors',
                      isToday ? 'bg-brand' : 'bg-cream group-hover:bg-brand/30',
                    )}
                    style={{ height: `${h}%` }}
                  />
                  <span className="text-[10px] uppercase tracking-wide text-ink-mute">
                    {d
                      ? new Date(d.date + 'T00:00:00')
                          .toLocaleDateString('pt-PT', { weekday: 'short' })
                          .slice(0, 3)
                      : '·'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* encomendas recentes */}
        <section className="animate-fade-up rounded-xl border border-line bg-white lg:col-span-3">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
              Encomendas recentes
            </h2>
            <Link
              href="/orders"
              className="text-[12.5px] font-medium text-brand-dark hover:underline"
            >
              Ver receção
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-[13.5px] font-medium text-ink-soft">Ainda sem encomendas</p>
              <p className="mt-1 text-[12.5px] text-ink-mute">
                Partilha o link da tua loja para receberes a primeira.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((o) => (
                <li key={o.id} className="flex items-center gap-3.5 px-5 py-3">
                  <span className="w-9 font-display text-[15px] font-semibold tabular-nums">
                    {o.number}
                  </span>
                  <span className="text-ink-mute">
                    {o.type === 'DELIVERY' ? <Bike size={14} /> : <ShoppingBag size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{o.customerName}</p>
                    <p className="text-[11.5px] tabular-nums text-ink-mute">
                      {new Date(o.createdAt).toLocaleTimeString('pt-PT', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' · '}
                      {o.items.reduce((n, it) => n + it.quantity, 0)} itens
                    </p>
                  </div>
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                    <span className={clsx('h-1.5 w-1.5 rounded-full', STATUS_META[o.status].dot)} />
                    {STATUS_META[o.status].label}
                  </span>
                  <span className="w-16 text-right text-[13.5px] font-semibold tabular-nums">
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

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className={clsx('px-5 py-4', accent && 'border-l-2 border-l-brand')}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-mute">
        {label}
      </p>
      <p className="mt-1.5 font-display text-[24px] font-semibold leading-none tabular-nums tracking-tight">
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] text-ink-mute">{hint}</p>}
    </div>
  );
}
