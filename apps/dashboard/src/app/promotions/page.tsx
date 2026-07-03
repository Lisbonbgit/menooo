'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, MapPin, Ticket } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import {
  useZones,
  useCreateZone,
  useDeleteZone,
  useCoupons,
  useCreateCoupon,
  useDeleteCoupon,
} from '@/lib/promotions-hooks';

export default function PromotionsPage() {
  return (
    <AppShell title="Entregas & Promoções">
      <div className="stagger grid gap-5 lg:grid-cols-2">
        <ZonesSection />
        <CouponsSection />
      </div>
    </AppShell>
  );
}

const inputCls =
  'rounded-xl border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-brand';

function SectionCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
      <div className="flex items-center gap-3 border-b border-line bg-cream/40 px-5 py-4">
        <span className="text-ink-mute">
          {icon}
        </span>
        <div>
          <h2 className="font-display text-[16px] font-semibold leading-tight">{title}</h2>
          <p className="text-[12px] text-ink-mute">{subtitle}</p>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ZonesSection() {
  const zones = useZones();
  const create = useCreateZone();
  const del = useDeleteZone();
  const [form, setForm] = useState({ name: '', postalPrefix: '', fee: '', minOrder: '' });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{1,7}$/.test(form.postalPrefix)) {
      toast.error('Prefixo postal: só dígitos (ex.: 1000).');
      return;
    }
    try {
      await create.mutateAsync({
        name: form.name,
        postalPrefix: form.postalPrefix,
        fee: parseFloat(form.fee.replace(',', '.')) || 0,
        minOrder: parseFloat(form.minOrder.replace(',', '.')) || 0,
      });
      setForm({ name: '', postalPrefix: '', fee: '', minOrder: '' });
      toast.success('Zona criada');
    } catch {
      toast.error('Erro ao criar zona');
    }
  }

  return (
    <SectionCard
      icon={<MapPin size={17} />}
      title="Zonas de entrega"
      subtitle="Taxa e mínimo por prefixo de código postal"
    >
      <ul className="mb-4 space-y-2">
        {zones.data?.map((z) => (
          <li
            key={z.id}
            className="flex items-center justify-between rounded-xl border border-line px-3.5 py-2.5 text-[13px]"
          >
            <div>
              <span className="font-medium">{z.name}</span>{' '}
              <span className="text-ink-mute">({z.postalPrefix}…)</span>
              <p className="text-[11.5px] text-ink-mute">
                Taxa {Number(z.fee).toFixed(2)} € · mín. {Number(z.minOrder).toFixed(2)} €
              </p>
            </div>
            <button
              onClick={async () => {
                await del.mutateAsync(z.id);
                toast.success('Zona removida');
              }}
              className="rounded-lg p-1.5 text-ink-mute hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
        {zones.data?.length === 0 && (
          <li className="rounded-xl border border-dashed border-line px-3.5 py-4 text-center text-[12.5px] text-ink-mute">
            Sem zonas — usa-se a taxa geral das definições.
          </li>
        )}
      </ul>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Nome">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${inputCls} w-28`} />
        </Field>
        <Field label="Prefixo CP">
          <input value={form.postalPrefix} onChange={(e) => setForm({ ...form, postalPrefix: e.target.value })} className={`${inputCls} w-24`} />
        </Field>
        <Field label="Taxa €">
          <input value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} className={`${inputCls} w-20`} />
        </Field>
        <Field label="Mín. €">
          <input value={form.minOrder} onChange={(e) => setForm({ ...form, minOrder: e.target.value })} className={`${inputCls} w-20`} />
        </Field>
        <button className="flex items-center gap-1 rounded-xl bg-brand px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-dark">
          <Plus size={15} /> Zona
        </button>
      </form>
    </SectionCard>
  );
}

function CouponsSection() {
  const coupons = useCoupons();
  const create = useCreateCoupon();
  const del = useDeleteCoupon();
  const [form, setForm] = useState({
    code: '',
    type: 'PERCENT' as 'PERCENT' | 'FIXED',
    value: '',
    minOrder: '',
    maxUses: '',
  });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = parseFloat(form.value.replace(',', '.'));
    if (!form.code.trim() || Number.isNaN(value)) {
      toast.error('Indica código e valor válidos.');
      return;
    }
    try {
      await create.mutateAsync({
        code: form.code.trim(),
        type: form.type,
        value,
        minOrder: parseFloat(form.minOrder.replace(',', '.')) || 0,
        maxUses: form.maxUses ? parseInt(form.maxUses, 10) : undefined,
      });
      setForm({ code: '', type: 'PERCENT', value: '', minOrder: '', maxUses: '' });
      toast.success('Cupão criado');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Erro ao criar cupão');
    }
  }

  return (
    <SectionCard
      icon={<Ticket size={17} />}
      title="Cupões de desconto"
      subtitle="Percentagem ou valor fixo, com limites opcionais"
    >
      <ul className="mb-4 space-y-2">
        {coupons.data?.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between rounded-xl border border-line px-3.5 py-2.5 text-[13px]"
          >
            <div>
              <span className="rounded-md bg-espresso px-2 py-0.5 font-mono text-[12px] font-semibold tracking-wider text-cream">
                {c.code}
              </span>{' '}
              <span className="ml-1 font-semibold text-brand-dark">
                {c.type === 'PERCENT' ? `−${Number(c.value)}%` : `−${Number(c.value).toFixed(2)} €`}
              </span>
              <p className="mt-0.5 text-[11.5px] text-ink-mute">
                {Number(c.minOrder) > 0 && `mín. ${Number(c.minOrder).toFixed(2)} € · `}
                usado {c.usedCount}
                {c.maxUses != null ? `/${c.maxUses}` : '×'}
                {!c.active && ' · inativo'}
              </p>
            </div>
            <button
              onClick={async () => {
                await del.mutateAsync(c.id);
                toast.success('Cupão removido');
              }}
              className="rounded-lg p-1.5 text-ink-mute hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
        {coupons.data?.length === 0 && (
          <li className="rounded-xl border border-dashed border-line px-3.5 py-4 text-center text-[12.5px] text-ink-mute">
            Sem cupões ativos.
          </li>
        )}
      </ul>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Código">
          <input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            className={`${inputCls} w-28 font-mono uppercase`}
          />
        </Field>
        <Field label="Tipo">
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as 'PERCENT' | 'FIXED' })}
            className={inputCls}
          >
            <option value="PERCENT">%</option>
            <option value="FIXED">€</option>
          </select>
        </Field>
        <Field label="Valor">
          <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={`${inputCls} w-16`} />
        </Field>
        <Field label="Mín. €">
          <input value={form.minOrder} onChange={(e) => setForm({ ...form, minOrder: e.target.value })} className={`${inputCls} w-16`} />
        </Field>
        <Field label="Usos">
          <input value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} className={`${inputCls} w-16`} />
        </Field>
        <button className="flex items-center gap-1 rounded-xl bg-brand px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-dark">
          <Plus size={15} /> Cupão
        </button>
      </form>
    </SectionCard>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-medium text-ink-soft">{label}</label>
      {children}
    </div>
  );
}
