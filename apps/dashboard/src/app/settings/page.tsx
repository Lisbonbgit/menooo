'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Store,
  Clock,
  ExternalLink,
  Printer,
  CreditCard,
  Sparkles,
  Image as ImageIcon,
  Globe,
  Copy,
  Check,
  Bike,
  ShoppingBag,
  Palette,
  Tablet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { AppShell } from '@/components/AppShell';
import { ImageUploader } from '@/components/ImageUploader';
import { PrinterConfig } from '@/components/PrinterConfig';
import { KitchenPairing } from '@/components/KitchenPairing';
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

      {/* modos de serviço: entregas / levantamento */}
      <section className="animate-fade-up mb-5 rounded-xl border border-line bg-white p-5 shadow-card">
        <div className="mb-3.5 flex items-center gap-3">
          <span className="text-ink-mute">
            <Bike size={17} />
          </span>
          <div>
            <h2 className="font-display text-[16px] font-semibold leading-tight">Modos de entrega</h2>
            <p className="text-[12px] text-ink-mute">
              Liga ou desliga cada modo. Se desligares as entregas, os clientes só podem levantar no
              local.
            </p>
          </div>
        </div>
        <ServiceToggle
          icon={<Bike size={15} />}
          label="Entregas ao domicílio"
          on={form.acceptsDelivery}
          onToggle={async (next) => {
            if (!next && !form.acceptsPickup)
              return toast.error('Tens de manter pelo menos um modo ativo.');
            setForm((f) => ({ ...f, acceptsDelivery: next }));
            await updateTenant.mutateAsync({ acceptsDelivery: next });
            toast.success(next ? 'Entregas ativadas' : 'Entregas desativadas');
          }}
        />
        <ServiceToggle
          icon={<ShoppingBag size={15} />}
          label="Levantar no local"
          on={form.acceptsPickup}
          onToggle={async (next) => {
            if (!next && !form.acceptsDelivery)
              return toast.error('Tens de manter pelo menos um modo ativo.');
            setForm((f) => ({ ...f, acceptsPickup: next }));
            await updateTenant.mutateAsync({ acceptsPickup: next });
            toast.success(next ? 'Levantamento ativado' : 'Levantamento desativado');
          }}
        />
      </section>

      {/* pagamento online dos clientes — em breve */}
      <section className="animate-fade-up mb-5 rounded-xl border border-line bg-white p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span className="text-ink-mute">
            <CreditCard size={17} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-[16px] font-semibold leading-tight">
                Pagamento online dos clientes
              </h2>
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-dark">
                Brevemente
              </span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
              Em breve os teus clientes vão poder pagar por <strong>MB Way ou cartão</strong>{' '}
              diretamente no checkout. Por agora, recebes na <strong>entrega ou no levantamento</strong>{' '}
              — cada euro é teu, sem intermediários.
            </p>
          </div>
        </div>
      </section>

      {/* subscrição */}
      {tenant.data && <BillingCard tenant={tenant.data} />}

      {/* identidade visual — capa e logótipo da loja */}
      <section className="animate-fade-up mb-5 rounded-xl border border-line bg-white p-5 shadow-card">
        <div className="mb-4 flex items-center gap-3">
          <span className="text-ink-mute">
            <ImageIcon size={17} />
          </span>
          <div>
            <h2 className="font-display text-[16px] font-semibold leading-tight">
              Identidade da loja
            </h2>
            <p className="text-[12px] text-ink-mute">
              A capa e o logótipo aparecem no topo da tua loja online.
            </p>
          </div>
        </div>

        <ImageUploader
          variant="cover"
          value={tenant.data?.coverUrl}
          maxDim={1800}
          onChange={async (url) => {
            await updateTenant.mutateAsync({ coverUrl: url ?? '' });
            toast.success(url ? 'Capa atualizada' : 'Capa removida');
          }}
        />

        <div className="mt-4 flex items-center gap-4">
          <ImageUploader
            variant="square"
            size="md"
            value={tenant.data?.logoUrl}
            maxDim={600}
            onChange={async (url) => {
              await updateTenant.mutateAsync({ logoUrl: url ?? '' });
              toast.success(url ? 'Logótipo atualizado' : 'Logótipo removido');
            }}
          />
          <div className="text-[12.5px] text-ink-mute">
            <p className="font-medium text-ink-soft">Logótipo</p>
            <p className="mt-0.5">Quadrado, aparece junto ao nome da loja.</p>
          </div>
        </div>

        {tenant.data && (
          <StoreColorsBlock
            key={`${tenant.data.brandColor}|${tenant.data.heroColor}`}
            tenant={tenant.data}
            onSave={async (brandColor, heroColor) => {
              await updateTenant.mutateAsync({ brandColor, heroColor });
            }}
          />
        )}
      </section>

      {/* widget de encomendas para o site do dono */}
      {tenant.data && <WebsiteWidgetCard slug={tenant.data.slug} />}

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

        <section className="rounded-xl border border-line bg-white p-5 shadow-card">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-ink-mute">
              <Tablet size={17} />
            </span>
            <div>
              <h2 className="font-display text-[16px] font-semibold leading-tight">
                App de cozinha
              </h2>
              <p className="text-[12px] text-ink-mute">
                Tablet Android que recebe os pedidos e imprime na impressora de rede
              </p>
            </div>
          </div>
          <KitchenPairing />
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
    sub?.state === 'LIFETIME'
      ? { label: 'Ativa', cls: 'bg-green-100 text-green-800' }
      : sub?.state === 'PAID'
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
  const isLifetime = sub?.state === 'LIFETIME';

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
              {isLifetime
                ? 'Subscrição ativa.'
                : hasAutoSub
                  ? 'Renovação mensal automática ativa (Stripe).'
                  : 'Depois do período de teste, a loja precisa de subscrição ativa para ficar online.'}
            </p>
          </div>
        </div>

        {!isLifetime && (
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
        )}
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

// tema Menooo por omissão (usado como valor inicial dos seletores)
const DEFAULT_BRAND = '#e05a1e';
const DEFAULT_HERO = '#231a13';

/** Cores da montra: cor da marca (botões/preços) e cor do topo (cabeçalho). */
function StoreColorsBlock({
  tenant,
  onSave,
}: {
  tenant: TenantSettings;
  onSave: (brandColor: string, heroColor: string) => Promise<void>;
}) {
  const [brand, setBrand] = useState(tenant.brandColor ?? DEFAULT_BRAND);
  const [hero, setHero] = useState(tenant.heroColor ?? DEFAULT_HERO);
  const [saving, setSaving] = useState(false);
  const isCustom = !!(tenant.brandColor || tenant.heroColor);
  const dirty =
    brand !== (tenant.brandColor ?? DEFAULT_BRAND) || hero !== (tenant.heroColor ?? DEFAULT_HERO);

  async function save(brandColor: string, heroColor: string) {
    setSaving(true);
    try {
      await onSave(brandColor, heroColor);
      toast.success(brandColor || heroColor ? 'Cores da loja guardadas' : 'Tema Menooo reposto');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível guardar as cores.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5 border-t border-dashed border-line pt-4">
      <div className="mb-3 flex items-center gap-2">
        <Palette size={15} className="text-ink-mute" />
        <p className="text-[13.5px] font-semibold">Cores da loja</p>
      </div>
      <p className="mb-3 text-[12px] text-ink-mute">
        A tua loja online veste as cores da tua marca — botões e preços usam a cor da marca; o
        topo usa a cor do cabeçalho (tem de ser escura para o texto se ler bem).
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-soft">Cor da marca</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="h-9 w-14 cursor-pointer rounded-lg border border-line bg-white p-1"
            />
            <span className="font-mono text-[12px] text-ink-mute">{brand}</span>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink-soft">Cor do topo</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={hero}
              onChange={(e) => setHero(e.target.value)}
              className="h-9 w-14 cursor-pointer rounded-lg border border-line bg-white p-1"
            />
            <span className="font-mono text-[12px] text-ink-mute">{hero}</span>
          </div>
        </div>

        {/* pré-visualização rápida */}
        <div
          className="flex min-w-40 flex-1 items-center justify-between gap-2 rounded-xl px-3.5 py-2.5"
          style={{ background: hero }}
        >
          <span className="text-[12.5px] font-semibold" style={{ color: '#F3EBDF' }}>
            A tua loja
          </span>
          <span
            className="rounded-full px-3 py-1 text-[11.5px] font-semibold text-white"
            style={{ background: brand }}
          >
            Encomendar
          </span>
        </div>
      </div>

      <div className="mt-3.5 flex gap-2">
        <button
          onClick={() => save(brand, hero)}
          disabled={saving || !dirty}
          className="rounded-xl bg-brand px-4 py-2 text-[12.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {saving ? 'A guardar…' : 'Guardar cores'}
        </button>
        {isCustom && (
          <button
            onClick={() => {
              setBrand(DEFAULT_BRAND);
              setHero(DEFAULT_HERO);
              save('', '');
            }}
            disabled={saving}
            className="rounded-xl border border-line bg-white px-4 py-2 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand/40"
          >
            Repor tema Menooo
          </button>
        )}
      </div>
    </div>
  );
}

/** Interruptor imediato de um modo de serviço (entregas / levantamento). */
function ServiceToggle({
  icon,
  label,
  on,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  on: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-line py-3">
      <span className="flex items-center gap-2.5 text-[13.5px] font-medium">
        <span className="text-ink-mute">{icon}</span>
        {label}
      </span>
      <button
        type="button"
        onClick={() => onToggle(!on)}
        aria-label={label}
        className={
          'relative h-7 w-12 shrink-0 rounded-full transition-colors ' +
          (on ? 'bg-green-500' : 'bg-stone-300')
        }
      >
        <span
          className={
            'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ' +
            (on ? 'left-6' : 'left-1')
          }
        />
      </button>
    </div>
  );
}

/** Código do botão de encomendas para o dono colar no site dele (estilo GloriaFood). */
function WebsiteWidgetCard({ slug }: { slug: string }) {
  const base = process.env.NEXT_PUBLIC_STORE_URL ?? 'https://menooo.com';
  const storeUrl = `${base}/${slug}`;
  const floatSnippet = `<script src="${base}/embed.js" data-slug="${slug}" defer></script>`;
  const ownSnippet = `<script src="${base}/embed.js" data-slug="${slug}" data-button="hidden" defer></script>\n<button data-menooo-order>Peça aqui</button>`;

  return (
    <section className="animate-fade-up mb-5 rounded-xl border border-line bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-ink-mute">
          <Globe size={17} />
        </span>
        <div>
          <h2 className="font-display text-[16px] font-semibold leading-tight">
            Encomendas no teu site
          </h2>
          <p className="text-[12px] text-ink-mute">
            Tens duas maneiras de ligar o teu site à loja — escolhe a que preferires. Em qualquer
            uma, o pedido cai na tua receção.
          </p>
        </div>
      </div>

      {/* ---- A) link direto ---- */}
      <p className="mb-2 text-[13px] font-semibold text-ink">A) Link direto — o mais simples</p>
      <p className="mb-2 text-[12px] text-ink-mute">
        Põe este endereço num botão ou link do teu site (ex.: “Peça já aqui”). Abre a loja em página
        inteira e funciona em qualquer site, sem código.
      </p>
      <SnippetBlock title="" desc="" code={storeUrl} />

      {/* ---- B) popup (widget) ---- */}
      <p className="mb-2 mt-5 text-[13px] font-semibold text-ink">
        B) Popup no site — sem sair da página
      </p>
      <p className="mb-3 text-[12px] text-ink-mute">
        Abre a loja numa janela sobreposta (estilo GloriaFood). Cola o código no{' '}
        <strong>“Código personalizado”</strong> do teu site (a parte do{' '}
        <code className="rounded bg-cream px-1 py-0.5 text-[11px]">&lt;body&gt;</code>) — não num
        bloco de texto.
      </p>
      <SnippetBlock
        title="Botão flutuante (aparece sozinho no canto)"
        desc=""
        code={floatSnippet}
      />
      <SnippetBlock
        title="O teu próprio botão (ex.: “Peça aqui”)"
        desc="Esconde o botão flutuante e liga o teu botão: mete data-menooo-order em qualquer botão ou link."
        code={ownSnippet}
      />

      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-mute">
        No botão flutuante podes mudar o texto e a cor com{' '}
        <code className="rounded bg-cream px-1 py-0.5">data-label="…"</code> e{' '}
        <code className="rounded bg-cream px-1 py-0.5">data-color="#E05A1E"</code>.
      </p>
    </section>
  );
}

function SnippetBlock({ title, desc, code }: { title?: string; desc?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success('Copiado');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar — seleciona e copia à mão.');
    }
  }
  return (
    <div className="mb-4">
      {title && <p className="text-[13px] font-semibold text-ink">{title}</p>}
      {desc && <p className="mb-2 text-[12px] text-ink-mute">{desc}</p>}
      <div className="relative">
        <pre className="overflow-x-auto whitespace-pre rounded-xl border border-line bg-espresso px-4 py-3.5 pr-24 text-[12px] leading-relaxed text-cream">
          <code>{code}</code>
        </pre>
        <button
          onClick={copy}
          className="absolute right-2 top-2 flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}
