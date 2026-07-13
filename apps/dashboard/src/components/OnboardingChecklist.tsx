'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, ArrowRight, X, Printer, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useProducts } from '@/lib/catalog-hooks';
import { useHours, useTenant } from '@/lib/settings-hooks';
import { useZones } from '@/lib/promotions-hooks';

const STORE_URL = process.env.NEXT_PUBLIC_STORE_URL ?? 'http://187.124.4.163:8080';
const DISMISS_KEY = 'menoo-onboarding-dismissed';
const PRINTER_KEY = 'menoo-onboarding-printer';

/**
 * Checklist de arranque do trial. Deteta o que já está feito a partir dos
 * endpoints existentes; o passo da impressora é manual (não é detetável).
 * Esconde-se quando completo ou dispensado.
 */
export function OnboardingChecklist() {
  const products = useProducts();
  const hours = useHours();
  const zones = useZones();
  const tenant = useTenant();
  const orders = useQuery({
    queryKey: ['onboarding-orders'],
    queryFn: async () => (await api.get<unknown[]>('/orders')).data,
  });

  // estado local (localStorage) — lido no cliente para evitar mismatch de SSR
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [printerDone, setPrinterDone] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    setPrinterDone(localStorage.getItem(PRINTER_KEY) === '1');
    setReady(true);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }
  function markPrinter() {
    localStorage.setItem(PRINTER_KEY, '1');
    setPrinterDone(true);
  }

  const isActive = tenant.data?.status === 'ACTIVE';

  const steps = [
    {
      key: 'menu',
      done: (products.data?.length ?? 0) > 0,
      title: 'Monta o menu',
      help: 'Categorias, produtos, tamanhos e extras.',
      action: <StepLink href="/menu" label="Abrir menu" />,
    },
    {
      key: 'settings',
      done: (hours.data?.length ?? 0) > 0 || (zones.data?.length ?? 0) > 0,
      title: 'Horários e zona de entrega',
      help: 'Define quando abres e para onde entregas.',
      action: <StepLink href="/settings" label="Definições" />,
    },
    {
      key: 'printer',
      done: printerDone,
      title: 'Liga a impressora',
      help: 'Talão automático na térmica do balcão (opcional).',
      action: (
        <button
          onClick={markPrinter}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand/40 hover:text-brand-dark"
        >
          <Printer size={13} /> Já liguei
        </button>
      ),
    },
    {
      key: 'test-order',
      done: (orders.data?.length ?? 0) > 0,
      title: 'Faz uma encomenda de teste',
      help: isActive
        ? 'Abre a tua loja e faz um pedido para veres tudo a funcionar.'
        : 'Disponível assim que a loja for aprovada.',
      action: isActive ? (
        <a
          href={`${STORE_URL}/${tenant.data?.slug ?? ''}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand/40 hover:text-brand-dark"
        >
          Abrir a loja <ArrowRight size={13} />
        </a>
      ) : (
        <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-mute">
          <Lock size={12} /> por aprovar
        </span>
      ),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  // ainda a ler localStorage, dispensado, ou tudo feito → não mostrar
  if (!ready || dismissed || doneCount === steps.length) return null;

  return (
    <section className="animate-fade-up mb-6 rounded-xl border border-line bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-[17px] font-semibold tracking-tight">
            Põe a tua loja a andar
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            {doneCount} de {steps.length} passos feitos — faltam poucos para vender.
          </p>
        </div>
        <button
          onClick={dismiss}
          title="Dispensar"
          className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-cream hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      {/* barra de progresso */}
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-cream">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <ul className="mt-4 divide-y divide-line">
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-center gap-3.5 py-3">
            <span
              className={
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ' +
                (step.done ? 'bg-brand text-white' : 'border border-line text-ink-mute')
              }
            >
              {step.done ? <Check size={15} strokeWidth={2.6} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={
                  'text-[14px] font-semibold ' + (step.done ? 'text-ink-mute line-through' : '')
                }
              >
                {step.title}
              </p>
              {!step.done && <p className="mt-0.5 text-[12.5px] text-ink-soft">{step.help}</p>}
            </div>
            {!step.done && <div className="shrink-0">{step.action}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StepLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand/40 hover:text-brand-dark"
    >
      {label} <ArrowRight size={13} />
    </Link>
  );
}
