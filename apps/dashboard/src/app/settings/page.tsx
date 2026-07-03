'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Store, Clock, ExternalLink, Printer, CreditCard, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { AppShell } from '@/components/AppShell';
import { PrinterConfig } from '@/components/PrinterConfig';
import {
  useTenant,
  useUpdateTenant,
  useHours,
  useSetHours,
  useBillingConfig,
  type OpeningHour,
  type TenantSettings,
} from '@/lib/settings-hooks';

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const toHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

const inputCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-brand';

interface DayRow {
  enabled: boolean;
  open: string;
  close: string;
}

export default function SettingsPage() {
  const tenant = useTenant();
  const hours = useHours();
  const updateTenant = useUpdateTenant();
  const setHours = useSetHours();

  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    city: '',
    zipCode: '',
    acceptsDelivery: true,
    acceptsPickup: true,
    deliveryFee: '0',
    minOrderValue: '0',
    isOpen: false,
  });

  const [days, setDays] = useState<DayRow[]>(
    DAYS.map(() => ({ enabled: false, open: '09:00', close: '23:00' })),
  );

  useEffect(() => {
    if (tenant.data) {
      const t = tenant.data;
      setForm({
        name: t.name ?? '',
        phone: t.phone ?? '',
        address: t.address ?? '',
        city: t.city ?? '',
        zipCode: t.zipCode ?? '',
        acceptsDelivery: t.acceptsDelivery,
        acceptsPickup: t.acceptsPickup,
        deliveryFee: String(t.deliveryFee),
        minOrderValue: String(t.minOrderValue),
        isOpen: t.isOpen,
      });
    }
  }, [tenant.data]);

  useEffect(() => {
    if (hours.data) {
      setDays(
        DAYS.map((_, d) => {
          const h = hours.data!.find((x) => x.weekday === d);
          return h
            ? { enabled: true, open: toHHMM(h.openMinute), close: toHHMM(h.closeMinute) }
            : { enabled: false, open: '09:00', close: '23:00' };
        }),
      );
    }
  }, [hours.data]);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    try {
      await updateTenant.mutateAsync({
        name: form.name,
        phone: form.phone,
        address: form.address,
        city: form.city,
        zipCode: form.zipCode,
        acceptsDelivery: form.acceptsDelivery,
        acceptsPickup: form.acceptsPickup,
        deliveryFee: parseFloat(form.deliveryFee.replace(',', '.')) || 0,
        minOrderValue: parseFloat(form.minOrderValue.replace(',', '.')) || 0,
        isOpen: form.isOpen,
      });
      toast.success('Definições guardadas');
    } catch {
      toast.error('Erro ao guardar');
    }
  }

  async function saveHours() {
    const payload: OpeningHour[] = [];
    for (let d = 0; d < 7; d++) {
      const row = days[d];
      if (!row.enabled) continue;
      const openMinute = toMin(row.open);
      const closeMinute = toMin(row.close);
      if (closeMinute <= openMinute) {
        toast.error(`${DAYS[d]}: o fecho tem de ser depois da abertura.`);
        return;
      }
      payload.push({ weekday: d, openMinute, closeMinute });
    }
    try {
      await setHours.mutateAsync(payload);
      toast.success('Horário guardado');
    } catch {
      toast.error('Erro ao guardar horário');
    }
  }

  const storeUrl = tenant.data
    ? `${process.env.NEXT_PUBLIC_STORE_URL ?? 'http://187.124.4.163:8080'}/${tenant.data.slug}`
    : null;

  return (
    <AppShell
      title="Definições"
      actions={
        storeUrl && (
          <a
            href={storeUrl}
            target="_blank"
            className="flex items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 py-2 text-[13px] font-medium shadow-card transition-colors hover:border-brand/40"
          >
            <ExternalLink size={14} /> Ver a minha loja
          </a>
        )
      }
    >
      {/* pausa imediata */}
      <section className="animate-fade-up mb-5 flex items-center justify-between rounded-xl border border-line bg-white p-5 shadow-card">
        <div>
          <p className="text-[15px] font-semibold">Loja a aceitar encomendas</p>
          <p className="mt-0.5 text-[12.5px] text-ink-mute">
            Pausa imediata — sobrepõe-se ao horário definido em baixo.
          </p>
        </div>
        <button
          onClick={async () => {
            const next = !form.isOpen;
            setForm((f) => ({ ...f, isOpen: next }));
            await updateTenant.mutateAsync({ isOpen: next });
            toast.success(next ? 'Loja aberta' : 'Loja em pausa');
          }}
          className={
            'relative h-8 w-14 rounded-full transition-colors ' +
            (form.isOpen ? 'bg-green-500' : 'bg-stone-300')
          }
          aria-label="Alternar aberto/fechado"
        >
          <span
            className={
              'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ' +
              (form.isOpen ? 'left-7' : 'left-1')
            }
          />
        </button>
      </section>

      {/* subscrição */}
      {tenant.data && <BillingCard tenant={tenant.data} />}

      <div className="stagger grid gap-5 lg:grid-cols-2">
        {/* dados da loja */}
        <form
          onSubmit={saveSettings}
          className="space-y-4 rounded-xl border border-line bg-white p-5 shadow-card"
        >
          <div className="flex items-center gap-3">
            <span className="text-ink-mute">
              <Store size={17} />
            </span>
            <h2 className="font-display text-[16px] font-semibold">Dados da loja</h2>
          </div>

          <Field label="Nome">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefone">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Cidade">
              <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Morada">
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} />
          </Field>

          <div className="flex gap-5">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={form.acceptsDelivery}
                onChange={(e) => setForm({ ...form, acceptsDelivery: e.target.checked })}
                className="h-4 w-4 accent-brand"
              />
              Aceita entregas
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={form.acceptsPickup}
                onChange={(e) => setForm({ ...form, acceptsPickup: e.target.checked })}
                className="h-4 w-4 accent-brand"
              />
              Aceita take-away
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Taxa de entrega (€)">
              <input value={form.deliveryFee} onChange={(e) => setForm({ ...form, deliveryFee: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Encomenda mínima (€)">
              <input value={form.minOrderValue} onChange={(e) => setForm({ ...form, minOrderValue: e.target.value })} className={inputCls} />
            </Field>
          </div>

          <button
            type="submit"
            className="rounded-xl bg-brand px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
          >
            Guardar definições
          </button>
        </form>

        {/* horário */}
        <section className="rounded-xl border border-line bg-white p-5 shadow-card">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-ink-mute">
              <Clock size={17} />
            </span>
            <div>
              <h2 className="font-display text-[16px] font-semibold leading-tight">
                Horário de funcionamento
              </h2>
              <p className="text-[12px] text-ink-mute">Dias sem horário ficam fechados</p>
            </div>
          </div>

          <div className="space-y-2">
            {days.map((row, d) => (
              <div
                key={d}
                className={
                  'flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors ' +
                  (row.enabled ? 'border-line bg-white' : 'border-transparent bg-cream/50')
                }
              >
                <label className="flex w-24 items-center gap-2 text-[12.5px] font-medium">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) =>
                      setDays((prev) =>
                        prev.map((r, i) => (i === d ? { ...r, enabled: e.target.checked } : r)),
                      )
                    }
                    className="h-4 w-4 accent-brand"
                  />
                  {DAYS[d]}
                </label>
                <input
                  type="time"
                  disabled={!row.enabled}
                  value={row.open}
                  onChange={(e) =>
                    setDays((prev) =>
                      prev.map((r, i) => (i === d ? { ...r, open: e.target.value } : r)),
                    )
                  }
                  className="rounded-lg border border-line px-2 py-1 text-[12.5px] disabled:opacity-30"
                />
                <span className="text-ink-mute">—</span>
                <input
                  type="time"
                  disabled={!row.enabled}
                  value={row.close}
                  onChange={(e) =>
                    setDays((prev) =>
                      prev.map((r, i) => (i === d ? { ...r, close: e.target.value } : r)),
                    )
                  }
                  className="rounded-lg border border-line px-2 py-1 text-[12.5px] disabled:opacity-30"
                />
              </div>
            ))}
          </div>

          <button
            onClick={saveHours}
            className="mt-4 rounded-xl bg-brand px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
          >
            Guardar horário
          </button>
        </section>

        {/* impressão de pedidos */}
        <section className="rounded-xl border border-line bg-white p-5 shadow-card">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-ink-mute">
              <Printer size={17} />
            </span>
            <div>
              <h2 className="font-display text-[16px] font-semibold leading-tight">
                Impressão de pedidos
              </h2>
              <p className="text-[12px] text-ink-mute">
                Impressora local do balcão — a configuração fica guardada neste computador
              </p>
            </div>
          </div>
          <PrinterConfig storeName={form.name || 'Restaurante'} />
        </section>
      </div>
    </AppShell>
  );
}

function BillingCard({ tenant }: { tenant: TenantSettings }) {
  const billing = useBillingConfig();
  const [redirecting, setRedirecting] = useState(false);
  const sub = tenant.subscription;

  // feedback ao voltar do checkout do Stripe
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('billing') === 'success') {
      toast.success('Subscrição ativada');
      window.history.replaceState(null, '', '/settings');
    } else if (q.get('billing') === 'cancelled') {
      toast.info('Pagamento cancelado — podes tentar quando quiseres.');
      window.history.replaceState(null, '', '/settings');
    }
  }, []);

  async function go(path: '/billing/checkout' | '/billing/portal') {
    setRedirecting(true);
    try {
      const { data } = await api.post(path);
      window.location.href = data.url;
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível abrir o pagamento.');
      setRedirecting(false);
    }
  }

  const stateMeta =
    sub?.state === 'PAID'
      ? {
          label: `Paga até ${new Date(sub.paidUntil!).toLocaleDateString('pt-PT')}`,
          cls: 'bg-green-100 text-green-800',
        }
      : sub?.state === 'TRIAL'
        ? {
            label: `Período de teste · ${sub.daysLeft} ${sub.daysLeft === 1 ? 'dia' : 'dias'}`,
            cls: 'bg-blue-100 text-blue-800',
          }
        : sub?.state === 'EXPIRED'
          ? { label: 'Expirada — loja offline', cls: 'bg-red-100 text-red-700' }
          : { label: 'Aguarda ativação da loja', cls: 'bg-stone-200 text-stone-600' };

  const hasAutoSub = !!tenant.stripeSubscriptionId;

  return (
    <section className="animate-fade-up mb-5 rounded-xl border border-line bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-ink-mute">
            <CreditCard size={17} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-[16px] font-semibold leading-tight">Subscrição</h2>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${stateMeta.cls}`}
              >
                {stateMeta.label}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-ink-mute">
              {hasAutoSub
                ? 'Renovação mensal automática ativa (Stripe).'
                : 'Depois do período de teste, a loja precisa de subscrição ativa para ficar online.'}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {hasAutoSub ? (
            <button
              onClick={() => go('/billing/portal')}
              disabled={redirecting}
              className="rounded-xl border border-line bg-white px-4 py-2.5 text-[13px] font-medium shadow-card transition-colors hover:border-brand/40 disabled:opacity-60"
            >
              {redirecting ? 'A abrir…' : 'Gerir pagamento e faturas'}
            </button>
          ) : billing.data?.enabled ? (
            <button
              onClick={() => go('/billing/checkout')}
              disabled={redirecting}
              className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark disabled:opacity-60"
            >
              <Sparkles size={15} />
              {redirecting ? 'A abrir o pagamento…' : 'Ativar subscrição mensal'}
            </button>
          ) : (
            <p className="max-w-56 text-right text-[12px] text-ink-mute">
              Pagamento automático brevemente — por agora, contacta a equipa Menooo para ativar.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[12.5px] font-medium text-ink-soft">{label}</label>
      {children}
    </div>
  );
}
