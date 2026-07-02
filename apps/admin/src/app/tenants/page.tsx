'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import {
  LogOut,
  Store,
  CheckCircle2,
  PauseCircle,
  Flame,
  ReceiptEuro,
  Users,
  ShoppingBag,
  Sparkles,
  X,
  ExternalLink,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import {
  useStats,
  useTenants,
  useTenantDetail,
  useSetTenantStatus,
  type AdminTenant,
  type TenantStatus,
} from '@/lib/admin-hooks';

const STORE_URL = process.env.NEXT_PUBLIC_STORE_URL ?? 'http://187.124.4.163:8080';

const STATUS: Record<TenantStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Pendente', cls: 'bg-amber-100 text-amber-800' },
  ACTIVE: { label: 'Ativo', cls: 'bg-green-100 text-green-800' },
  SUSPENDED: { label: 'Suspenso', cls: 'bg-red-100 text-red-700' },
  CLOSED: { label: 'Fechado', cls: 'bg-stone-200 text-stone-600' },
};

const eur = (v: number) =>
  v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eurFull = (v: number) =>
  v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });

function activeFor(t: { activatedAt: string | null }): string {
  if (!t.activatedAt) return '—';
  const days = Math.floor((Date.now() - new Date(t.activatedAt).getTime()) / 86_400_000);
  if (days < 1) return 'hoje';
  if (days < 31) return `${days} dias`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(months / 12);
  return `${years} ano${years > 1 ? 's' : ''}`;
}

function ago(iso: string | null): string {
  if (!iso) return '—';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.floor(min / 60)} h`;
  return `há ${Math.floor(min / 1440)} dias`;
}

export default function TenantsPage() {
  const router = useRouter();
  const { token, name, logout } = useAuthStore();
  const [ready, setReady] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) router.replace('/login');
    else setReady(true);
  }, [token, router]);

  const stats = useStats();
  const tenants = useTenants();
  const setStatus = useSetTenantStatus();

  if (!ready) return null;

  async function changeStatus(t: { id: string; name: string }, status: TenantStatus) {
    try {
      await setStatus.mutateAsync({ id: t.id, status });
      toast.success(`${t.name}: ${STATUS[status].label}`);
    } catch {
      toast.error('Erro ao mudar estado');
    }
  }

  const s = stats.data;

  return (
    <div className="min-h-screen">
      {/* barra superior */}
      <header className="bg-espresso px-5 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-espresso-light">
              <Flame size={18} className="text-brand" />
            </span>
            <div>
              <p className="font-display text-[17px] font-semibold leading-none text-cream">
                Menooo
              </p>
              <p className="mt-0.5 text-[10.5px] uppercase tracking-[0.16em] text-cream/40">
                administração da plataforma
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-[13px] text-cream/60 sm:inline">{name}</span>
            <button
              onClick={() => {
                logout();
                router.replace('/login');
              }}
              className="flex items-center gap-1.5 rounded-xl border border-espresso-light px-3 py-1.5 text-[13px] text-cream/70 transition-colors hover:bg-espresso-light hover:text-cream"
            >
              <LogOut size={15} /> Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        {/* estatísticas da plataforma */}
        <div className="stagger mb-8 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <StatCard
            icon={<ReceiptEuro size={16} />}
            label="Vendas totais na plataforma"
            value={s ? eur(s.gmvTotal) : '—'}
            hint={s ? `${eur(s.gmv30d)} nos últimos 30 dias` : undefined}
            accent
          />
          <StatCard
            icon={<ShoppingBag size={16} />}
            label="Encomendas totais"
            value={s ? String(s.orders) : '—'}
            hint={s ? `${s.orders30d} nos últimos 30 dias` : undefined}
          />
          <StatCard
            icon={<Store size={16} />}
            label="Restaurantes"
            value={s ? String(s.total) : '—'}
            hint={s ? `${s.active} ativos · ${s.pending} pendentes` : undefined}
          />
          <StatCard
            icon={<Sparkles size={16} />}
            label="Novos · 30 dias"
            value={s ? String(s.newTenants30d) : '—'}
            hint="registos de restaurantes"
          />
        </div>

        {/* tabela */}
        <section className="animate-fade-up overflow-hidden rounded-2xl border border-line bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-line bg-cream/40 px-5 py-4">
            <h2 className="font-display text-[16px] font-semibold">Restaurantes</h2>
            <span className="text-[12px] text-ink-mute">clica numa linha para ver a ficha</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink-mute">
                  <th className="px-5 py-3 font-medium">Restaurante</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 text-right font-medium">Clientes</th>
                  <th className="px-4 py-3 text-right font-medium">Encomendas</th>
                  <th className="px-4 py-3 text-right font-medium">Vendas</th>
                  <th className="px-4 py-3 font-medium">Ativo há</th>
                  <th className="px-4 py-3 font-medium">Última venda</th>
                  <th className="px-5 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tenants.data?.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setDetailId(t.id)}
                    className="cursor-pointer transition-colors hover:bg-cream/40"
                  >
                    <td className="px-5 py-3.5">
                      <p className="font-semibold">{t.name}</p>
                      <p className="text-[11.5px] text-ink-mute">
                        /{t.slug}
                        {t.city ? ` · ${t.city}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={clsx(
                          'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                          STATUS[t.status].cls,
                        )}
                      >
                        {STATUS[t.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Users size={12} className="text-ink-mute" />
                        {t.customers}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums">{t.orders}</td>
                    <td className="px-4 py-3.5 text-right font-semibold tabular-nums">
                      {eurFull(t.revenue)}
                    </td>
                    <td className="px-4 py-3.5 text-ink-soft">{activeFor(t)}</td>
                    <td className="px-4 py-3.5 text-ink-soft">{ago(t.lastOrderAt)}</td>
                    <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <RowActions t={t} onChange={changeStatus} />
                    </td>
                  </tr>
                ))}
                {tenants.data?.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-ink-mute">
                      Ainda não há restaurantes registados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {detailId && (
        <TenantDetailPanel
          id={detailId}
          onClose={() => setDetailId(null)}
          onChangeStatus={changeStatus}
        />
      )}
    </div>
  );
}

function RowActions({
  t,
  onChange,
}: {
  t: AdminTenant;
  onChange: (t: { id: string; name: string }, s: TenantStatus) => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      {t.status !== 'ACTIVE' && (
        <button
          onClick={() => onChange(t, 'ACTIVE')}
          className="flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-green-700"
        >
          <CheckCircle2 size={13} /> Ativar
        </button>
      )}
      {t.status === 'ACTIVE' && (
        <button
          onClick={() => onChange(t, 'SUSPENDED')}
          className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
        >
          <PauseCircle size={13} /> Suspender
        </button>
      )}
    </div>
  );
}

function TenantDetailPanel({
  id,
  onClose,
  onChangeStatus,
}: {
  id: string;
  onClose: () => void;
  onChangeStatus: (t: { id: string; name: string }, s: TenantStatus) => void;
}) {
  const detail = useTenantDetail(id);
  const d = detail.data;
  const maxMonthly = Math.max(1, ...(d?.monthly ?? []).map((m) => m.revenue));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-paper p-6 shadow-lift"
      >
        {!d ? (
          <p className="py-16 text-center text-ink-mute">A carregar a ficha…</p>
        ) : (
          <>
            {/* cabeçalho */}
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="font-display text-[22px] font-semibold">{d.name}</h3>
                  <span
                    className={clsx(
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                      STATUS[d.status].cls,
                    )}
                  >
                    {STATUS[d.status].label}
                  </span>
                  {d.status === 'ACTIVE' && (
                    <span
                      className={clsx(
                        'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                        d.isOpen ? 'bg-green-100 text-green-800' : 'bg-stone-200 text-stone-600',
                      )}
                    >
                      {d.isOpen ? 'loja aberta' : 'em pausa'}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] text-ink-mute">
                  <a
                    href={`${STORE_URL}/${d.slug}`}
                    target="_blank"
                    className="inline-flex items-center gap-1 text-brand hover:underline"
                  >
                    /{d.slug} <ExternalLink size={11} />
                  </a>
                  {d.city ? ` · ${d.city}` : ''} · cliente desde{' '}
                  {new Date(d.createdAt).toLocaleDateString('pt-PT')}
                  {d.activatedAt ? ` · ativo há ${activeFor(d)}` : ' · nunca ativado'}
                </p>
                {d.owner && (
                  <p className="mt-0.5 text-[12.5px] text-ink-soft">
                    {d.owner.name} · {d.owner.email}
                    {d.phone ? ` · ${d.phone}` : ''}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                aria-label="Fechar"
                className="rounded-full border border-line bg-white p-2 text-ink-soft transition-colors hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            {/* KPIs */}
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Vendas totais" value={eurFull(d.metrics.revenue)} strong />
              <Kpi label="Encomendas" value={String(d.metrics.orders)} />
              <Kpi label="Clientes únicos" value={String(d.metrics.customers)} />
              <Kpi label="Ticket médio" value={eurFull(d.metrics.avgTicket)} />
            </div>

            {/* evolução 6 meses */}
            <div className="mb-5 rounded-2xl border border-line bg-white p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <h4 className="text-[13.5px] font-semibold">Vendas · últimos 6 meses</h4>
                <span className="text-[11px] text-ink-mute">
                  {d.metrics.lastOrderAt
                    ? `última venda ${ago(d.metrics.lastOrderAt)}`
                    : 'sem vendas'}
                </span>
              </div>
              <div className="flex h-24 items-end gap-2">
                {d.monthly.map((m) => (
                  <div key={m.month} className="group flex flex-1 flex-col items-center gap-1">
                    <span className="text-[9.5px] font-medium text-ink-mute opacity-0 transition-opacity group-hover:opacity-100">
                      {eur(m.revenue)}
                    </span>
                    <div
                      className="w-full rounded-t-md bg-brand/80 transition-colors group-hover:bg-brand"
                      style={{ height: `${Math.max(4, (m.revenue / maxMonthly) * 100)}%` }}
                    />
                    <span className="text-[10px] uppercase text-ink-mute">
                      {new Date(m.month + '-01T00:00:00')
                        .toLocaleDateString('pt-PT', { month: 'short' })
                        .replace('.', '')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              {/* top produtos */}
              <div className="rounded-2xl border border-line bg-white p-4">
                <h4 className="mb-2.5 text-[13.5px] font-semibold">Mais vendidos</h4>
                {d.topProducts.length === 0 ? (
                  <p className="text-[12px] text-ink-mute">Ainda sem vendas.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {d.topProducts.map((p, i) => (
                      <li key={p.name} className="flex items-center gap-2 text-[12.5px]">
                        <span className="w-4 font-display font-semibold text-ink-mute">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="text-ink-mute">{p.quantity}×</span>
                        <span className="w-16 text-right font-medium">{eurFull(p.revenue)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* últimas encomendas */}
              <div className="rounded-2xl border border-line bg-white p-4">
                <h4 className="mb-2.5 text-[13.5px] font-semibold">Últimas encomendas</h4>
                {d.recentOrders.length === 0 ? (
                  <p className="text-[12px] text-ink-mute">Ainda sem encomendas.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {d.recentOrders.map((o) => (
                      <li key={o.id} className="flex items-center gap-2 text-[12.5px]">
                        <span className="font-display font-semibold">#{o.number}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-mute">
                          {new Date(o.createdAt).toLocaleDateString('pt-PT')}{' '}
                          {new Date(o.createdAt).toLocaleTimeString('pt-PT', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="w-16 text-right font-medium">{eurFull(o.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* rodapé: catálogo + ações */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] text-ink-mute">
                Catálogo: {d.categories} categorias · {d.products} produtos
              </p>
              <div className="flex gap-2">
                {d.status !== 'ACTIVE' && (
                  <button
                    onClick={() => onChangeStatus(d, 'ACTIVE')}
                    className="flex items-center gap-1.5 rounded-xl bg-green-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-green-700"
                  >
                    <CheckCircle2 size={14} /> Ativar loja
                  </button>
                )}
                {d.status === 'ACTIVE' && (
                  <button
                    onClick={() => onChangeStatus(d, 'SUSPENDED')}
                    className="flex items-center gap-1.5 rounded-xl border border-line bg-white px-4 py-2 text-[12.5px] font-medium text-ink-soft hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                  >
                    <PauseCircle size={14} /> Suspender loja
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={clsx(
        'rounded-2xl border p-3.5',
        strong ? 'border-brand/25 bg-brand text-white' : 'border-line bg-white',
      )}
    >
      <p className={clsx('text-[11px]', strong ? 'text-white/75' : 'text-ink-mute')}>{label}</p>
      <p className="mt-0.5 font-display text-[19px] font-semibold tracking-tight">{value}</p>
    </div>
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
        'rounded-2xl border p-4 shadow-card',
        accent ? 'border-brand/25 bg-brand text-white' : 'border-line bg-white',
      )}
    >
      <div
        className={clsx(
          'mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg',
          accent ? 'bg-white/15 text-white' : 'bg-brand-soft text-brand-dark',
        )}
      >
        {icon}
      </div>
      <p className={clsx('text-[11.5px]', accent ? 'text-white/75' : 'text-ink-mute')}>{label}</p>
      <p className="font-display text-2xl font-semibold">{value}</p>
      {hint && (
        <p className={clsx('mt-0.5 text-[11px]', accent ? 'text-white/60' : 'text-ink-mute')}>
          {hint}
        </p>
      )}
    </div>
  );
}
