'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  BellRing,
  CalendarCheck,
  BookOpen,
  BadgePercent,
  Settings,
  LogOut,
  Flame,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useAuthHydrated } from '@/lib/use-hydrated';
import { unlockAudio } from '@/lib/alarm';
import { TenantSwitcher } from '@/components/TenantSwitcher';

const NAV = [
  { href: '/overview', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/orders', label: 'Receção', icon: BellRing },
  { href: '/reservations', label: 'Reservas', icon: CalendarCheck },
  { href: '/menu', label: 'Menu', icon: BookOpen },
  { href: '/promotions', label: 'Promoções', icon: BadgePercent },
  { href: '/settings', label: 'Definições', icon: Settings },
];

interface TenantLite {
  id: string;
  name: string;
  slug: string;
  isOpen: boolean;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  subscription?: {
    state: 'NONE' | 'TRIAL' | 'PAID' | 'EXPIRED' | 'LIFETIME';
    trialEndsAt: string | null;
    paidUntil: string | null;
    daysLeft: number | null;
  };
}

export function AppShell({
  title,
  kicker,
  actions,
  children,
}: {
  title: string;
  kicker?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { token, logout, user, kitchenDevice } = useAuthStore();
  const kitchen = user?.role === 'KITCHEN';
  const hydrated = useAuthHydrated();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hydrated) return; // espera o persist restaurar o token antes de decidir
    if (!token) {
      // tablet de cozinha desemparelhado volta ao /pair, não ao login de email
      router.replace(kitchenDevice ? '/pair' : '/login');
      return;
    }
    // cozinha só tem a Receção — qualquer outra rota volta para lá
    if (kitchen && pathname !== '/orders') {
      router.replace('/orders');
      return;
    }
    setReady(true);
  }, [hydrated, token, kitchen, kitchenDevice, pathname, router]);

  // 1.º toque desbloqueia o AudioContext (senão o beep de nova encomenda não toca)
  useEffect(() => {
    const h = () => unlockAudio();
    window.addEventListener('pointerdown', h, { once: true });
    return () => window.removeEventListener('pointerdown', h);
  }, []);

  const tenant = useQuery({
    queryKey: ['tenant-me'],
    queryFn: async () => (await api.get<TenantLite>('/tenants/me')).data,
    enabled: ready,
  });

  function signOut() {
    // revoga o refresh token no servidor (best-effort) antes de limpar localmente
    const rt = useAuthStore.getState().refreshToken;
    if (rt) void api.post('/auth/logout', { refreshToken: rt }).catch(() => {});
    logout();
    router.replace(kitchen || kitchenDevice ? '/pair' : '/login');
  }

  if (!ready) return null;

  const initials = (tenant.data?.name ?? 'R')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // cozinha: só a Receção (o resto é do dono e daria 403)
  const navItems = kitchen ? NAV.filter((i) => i.href === '/orders') : NAV;
  const navLinks = navItems.map(({ href, label, icon: Icon }) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        className={clsx(
          'flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
          active
            ? 'bg-brand/15 text-brand'
            : 'text-cream/60 hover:bg-espresso-light hover:text-cream',
        )}
      >
        <Icon size={16} strokeWidth={2.2} />
        {label}
      </Link>
    );
  });

  return (
    <div className="flex min-h-screen">
      {/* ---- barra lateral (desktop) ---- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-espresso px-4 py-6 md:flex">
        <div className="mb-9 flex items-center gap-2 px-2 pt-1">
          <Flame size={19} strokeWidth={2.4} className="text-brand" />
          <p className="font-display text-[19px] font-semibold leading-none tracking-tight text-cream">
            Menooo
          </p>
        </div>

        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-cream/30">
          Operação
        </p>
        <nav className="flex flex-col gap-1">{navLinks}</nav>

        <div className="mt-auto border-t border-espresso-line pt-4">
          <div className="flex items-center gap-2 px-1">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-espresso-light text-xs font-semibold text-cream">
              {initials}
            </span>
            {kitchen ? (
              <span className="min-w-0 flex-1 truncate text-[13px] text-cream/70">
                {tenant.data?.name ?? '—'}
              </span>
            ) : (
              <TenantSwitcher activeId={tenant.data?.id} />
            )}
            <button
              onClick={signOut}
              title={kitchen ? 'Desemparelhar' : 'Sair'}
              className="shrink-0 rounded-lg p-2 text-cream/50 transition-colors hover:bg-espresso-light hover:text-cream"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* ---- barra superior (mobile) ---- */}
      <div className="fixed inset-x-0 top-0 z-30 flex flex-col gap-2 bg-espresso px-4 pb-2 pt-3 md:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <Flame size={16} className="text-brand" />
            <span className="font-display text-base font-semibold text-cream">Menooo</span>
          </div>
          {kitchen ? (
            <span className="min-w-0 flex-1 truncate text-[13px] text-cream/70">
              {tenant.data?.name ?? '—'}
            </span>
          ) : (
            <TenantSwitcher activeId={tenant.data?.id} dropUp={false} />
          )}
          <button
            onClick={signOut}
            className="shrink-0 rounded-lg p-1.5 text-cream/60"
            title={kitchen ? 'Desemparelhar' : 'Sair'}
          >
            <LogOut size={16} />
          </button>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto pb-1">{navLinks}</nav>
      </div>

      {/* ---- conteúdo ---- */}
      <main className="min-w-0 flex-1 px-4 pb-12 pt-28 md:ml-60 md:px-8 md:pt-8">
        {!kitchen && (
          <>
            {tenant.data?.status === 'PENDING' && (
              <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                <strong>A tua loja está em análise.</strong> Podes montar já o menu, horários e
                impressão — fica visível ao público assim que a equipa a ativar (normalmente no
                próprio dia).
              </div>
            )}
            {tenant.data?.status === 'SUSPENDED' && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
                <strong>A tua loja está suspensa.</strong> Contacta o apoio Menooo para a
                reativar.
              </div>
            )}
            {tenant.data?.status === 'ACTIVE' && tenant.data.subscription?.state === 'TRIAL' && (
              <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-900">
                <strong>
                  Período de teste: {tenant.data.subscription.daysLeft}{' '}
                  {tenant.data.subscription.daysLeft === 1 ? 'dia restante' : 'dias restantes'}.
                </strong>{' '}
                Para a loja continuar online depois do teste,{' '}
                <Link href="/settings" className="font-semibold underline">
                  ativa a subscrição nas Definições
                </Link>
                .
              </div>
            )}
            {tenant.data?.status === 'ACTIVE' && tenant.data.subscription?.state === 'EXPIRED' && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
                <strong>
                  O período de teste terminou e a tua loja está offline para os clientes.
                </strong>{' '}
                O teu menu e dados estão guardados — para voltar a vender,{' '}
                <Link href="/settings" className="font-semibold underline">
                  ativa a subscrição nas Definições
                </Link>
                .
              </div>
            )}
          </>
        )}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            {kicker && (
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-mute">
                {kicker}
              </p>
            )}
            <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
          </div>
          <div className="flex items-center gap-2.5">{actions}</div>
        </header>
        {children}
      </main>
    </div>
  );
}
