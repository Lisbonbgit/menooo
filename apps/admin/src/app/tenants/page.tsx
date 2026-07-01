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
  Clock,
  Flame,
  ReceiptEuro,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import {
  useStats,
  useTenants,
  useSetTenantStatus,
  type AdminTenant,
} from '@/lib/admin-hooks';

const STATUS: Record<AdminTenant['status'], { label: string; cls: string }> = {
  PENDING: { label: 'Pendente', cls: 'bg-amber-100 text-amber-800' },
  ACTIVE: { label: 'Ativo', cls: 'bg-green-100 text-green-800' },
  SUSPENDED: { label: 'Suspenso', cls: 'bg-red-100 text-red-700' },
  CLOSED: { label: 'Fechado', cls: 'bg-stone-200 text-stone-600' },
};

export default function TenantsPage() {
  const router = useRouter();
  const { token, name, logout } = useAuthStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) router.replace('/login');
    else setReady(true);
  }, [token, router]);

  const stats = useStats();
  const tenants = useTenants();
  const setStatus = useSetTenantStatus();

  if (!ready) return null;

  async function changeStatus(t: AdminTenant, status: AdminTenant['status']) {
    try {
      await setStatus.mutateAsync({ id: t.id, status });
      toast.success(`${t.name}: ${STATUS[status].label}`);
    } catch {
      toast.error('Erro ao mudar estado');
    }
  }

  return (
    <div className="min-h-screen">
      {/* barra superior */}
      <header className="bg-espresso px-5 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-espresso-light">
              <Flame size={18} className="text-brand" />
            </span>
            <div>
              <p className="font-display text-[17px] font-semibold leading-none text-cream">
                Comanda
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

      <main className="mx-auto max-w-5xl px-5 py-8">
        {/* estatísticas */}
        <div className="stagger mb-8 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <StatCard icon={<Store size={16} />} label="Restaurantes" value={stats.data?.total} />
          <StatCard
            icon={<CheckCircle2 size={16} />}
            label="Ativos"
            value={stats.data?.active}
            accent
          />
          <StatCard icon={<Clock size={16} />} label="Pendentes" value={stats.data?.pending} />
          <StatCard
            icon={<ReceiptEuro size={16} />}
            label="Encomendas totais"
            value={stats.data?.orders}
          />
        </div>

        {/* tabela */}
        <section className="animate-fade-up overflow-hidden rounded-2xl border border-line bg-white shadow-card">
          <div className="border-b border-line bg-cream/40 px-5 py-4">
            <h2 className="font-display text-[16px] font-semibold">Restaurantes</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink-mute">
                  <th className="px-5 py-3 font-medium">Restaurante</th>
                  <th className="px-4 py-3 font-medium">Dono</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 text-right font-medium">Produtos</th>
                  <th className="px-4 py-3 text-right font-medium">Encomendas</th>
                  <th className="px-5 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tenants.data?.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-cream/30">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold">{t.name}</p>
                      <p className="text-[11.5px] text-ink-mute">/{t.slug}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      {t.owner ? (
                        <>
                          <p>{t.owner.name}</p>
                          <p className="text-[11.5px] text-ink-mute">{t.owner.email}</p>
                        </>
                      ) : (
                        <span className="text-ink-mute">—</span>
                      )}
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
                    <td className="px-4 py-3.5 text-right tabular-nums">{t.products}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums">{t.orders}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-2">
                        {t.status !== 'ACTIVE' && (
                          <button
                            onClick={() => changeStatus(t, 'ACTIVE')}
                            className="flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-green-700"
                          >
                            <CheckCircle2 size={13} /> Ativar
                          </button>
                        )}
                        {t.status === 'ACTIVE' && (
                          <button
                            onClick={() => changeStatus(t, 'SUSPENDED')}
                            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                          >
                            <PauseCircle size={13} /> Suspender
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {tenants.data?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-ink-mute">
                      Ainda não há restaurantes registados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
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
      <p className="font-display text-2xl font-semibold">{value ?? '—'}</p>
    </div>
  );
}
