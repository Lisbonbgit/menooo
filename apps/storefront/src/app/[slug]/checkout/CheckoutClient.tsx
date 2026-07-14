'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Minus,
  Plus,
  Trash2,
  CheckCircle2,
  ArrowLeft,
  Tag,
  Bike,
  ShoppingBag,
  Banknote,
  CreditCard,
  Clock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-hooks';
import { useCartStore } from '@/lib/cart-store';
import { AddressMap } from '@/components/AddressMap';
import { StoreTheme } from '@/components/StoreTheme';

type OrderType = 'DELIVERY' | 'PICKUP';
type PaymentMethod = 'CASH' | 'CARD_ON_DELIVERY';

const inputCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] shadow-card outline-none transition-colors focus:border-brand';

/** "yyyy-MM-ddThh:mm" na hora local (para o input datetime-local). */
function localNow() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function CheckoutClient({ slug }: { slug: string }) {
  const store = useStore(slug);
  const { items, storeSlug: cartSlug, setQuantity, removeItem, subtotal, clear } = useCartStore();

  const [type, setType] = useState<OrderType>('DELIVERY');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [marketing, setMarketing] = useState(false);
  const [address, setAddress] = useState('');
  const [complement, setComplement] = useState('');
  const [zip, setZip] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('CASH');
  const [changeForInput, setChangeForInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [placed, setPlaced] = useState<{ number: number; total: string } | null>(null);

  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);

  const s = store.data;
  const sub = subtotal();

  // tipo de pedido por omissão conforme o que a loja aceita
  useEffect(() => {
    if (!s) return;
    if (!s.acceptsDelivery && s.acceptsPickup) setType('PICKUP');
    else if (s.acceptsDelivery && !s.acceptsPickup) setType('DELIVERY');
  }, [s?.acceptsDelivery, s?.acceptsPickup]);

  const quote = useQuery({
    queryKey: ['quote', slug, zip],
    queryFn: async () =>
      (await api.get(`/public/stores/${slug}/delivery-quote?zip=${encodeURIComponent(zip)}`))
        .data as { delivered: boolean; fee: number; minOrder: number },
    enabled: type === 'DELIVERY' && !!s && zip.trim().length >= 4,
  });

  const canDeliver = type !== 'DELIVERY' || quote.data?.delivered !== false;
  const deliveryFee = type === 'DELIVERY' && quote.data?.delivered ? Number(quote.data.fee) : 0;
  const minOrder =
    type === 'DELIVERY' && quote.data?.delivered
      ? Number(quote.data.minOrder)
      : s
        ? Number(s.minOrderValue)
        : 0;
  const discount = coupon?.discount ?? 0;
  const total = Math.max(0, sub - discount) + deliveryFee;

  // IVA incluído nos preços (repartido por taxa; desconto repartido proporcionalmente)
  const netSub = Math.max(0, sub - discount);
  const vatByRate: Record<number, number> = {};
  for (const i of items) {
    const line = i.unitPrice * i.quantity;
    const lineNet = sub > 0 ? (line * netSub) / sub : 0;
    const rate = i.vatRate ?? 23;
    vatByRate[rate] = (vatByRate[rate] ?? 0) + (lineNet * rate) / (100 + rate);
  }
  if (deliveryFee > 0) vatByRate[23] = (vatByRate[23] ?? 0) + (deliveryFee * 23) / 123;
  const vatEntries = Object.entries(vatByRate)
    .map(([r, v]) => ({ rate: Number(r), value: v }))
    .filter((e) => e.value >= 0.005)
    .sort((a, b) => b.rate - a.rate);

  const changeForNum = parseFloat(changeForInput.replace(',', '.'));
  const changeBack =
    payment === 'CASH' && !Number.isNaN(changeForNum) && changeForNum >= total
      ? changeForNum - total
      : null;

  if (placed) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        {s && <StoreTheme brandColor={s.brandColor} heroColor={s.heroColor} />}
        <div className="animate-fade-up w-full max-w-sm rounded-3xl border border-line bg-white p-8 text-center shadow-lift">
          <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="text-green-600" size={34} />
          </span>
          <h1 className="font-display text-[26px] font-semibold">Encomenda enviada!</h1>
          <p className="mt-3 rounded-xl bg-cream/70 py-3 font-display text-lg">
            Pedido <strong>#{placed.number}</strong>
            <span className="mx-2 text-ink-mute">·</span>
            {Number(placed.total).toFixed(2)} €
          </p>
          <p className="mt-4 text-[13px] leading-relaxed text-ink-mute">
            O restaurante vai confirmar a tua encomenda dentro de momentos. Obrigado.
          </p>
          <Link
            href={`/${slug}`}
            className="mt-6 block rounded-xl bg-brand py-3 text-[14px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
          >
            Voltar à loja
          </Link>
        </div>
      </main>
    );
  }

  // o carrinho persistido pertence a OUTRA loja: nunca submeter aqui às cegas
  if (items.length > 0 && cartSlug && cartSlug !== slug) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        {s && <StoreTheme brandColor={s.brandColor} heroColor={s.heroColor} />}
        <ShoppingBag size={30} strokeWidth={1.5} className="text-ink-mute" />
        <p className="max-w-xs text-[15px] leading-relaxed text-ink-soft">
          O teu carrinho pertence a outra loja. Queres terminar essa encomenda ou começar uma
          nova aqui?
        </p>
        <div className="flex flex-wrap justify-center gap-2.5">
          <Link
            href={`/${cartSlug}/checkout`}
            className="rounded-xl bg-brand px-5 py-3 text-[14px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
          >
            Terminar a outra encomenda
          </Link>
          <button
            onClick={() => clear()}
            className="rounded-xl border border-line bg-white px-5 py-3 text-[14px] font-medium text-ink-soft transition-colors hover:bg-cream"
          >
            Esvaziar e começar aqui
          </button>
        </div>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <ShoppingBag size={30} strokeWidth={1.5} className="text-ink-mute" />
        <p className="text-[15px] text-ink-soft">O teu carrinho está vazio.</p>
        <Link
          href={`/${slug}`}
          className="rounded-xl bg-brand px-6 py-3 text-[14px] font-semibold text-white shadow-card"
        >
          Ver menu
        </Link>
      </main>
    );
  }

  async function applyCoupon() {
    if (!couponInput.trim()) return;
    try {
      const { data } = await api.post(`/public/stores/${slug}/validate-coupon`, {
        code: couponInput.trim(),
        subtotal: sub,
      });
      if (data.valid) {
        setCoupon({ code: data.code, discount: Number(data.discount) });
        toast.success(`Cupão aplicado: −${Number(data.discount).toFixed(2)} €`);
      } else {
        setCoupon(null);
        toast.error(data.message ?? 'Cupão inválido');
      }
    } catch {
      toast.error('Não foi possível validar o cupão');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return toast.error('Indica o nome e o apelido.');
    if (!phone.trim()) return toast.error('Indica o número de telefone.');
    if (type === 'DELIVERY' && !address.trim()) return toast.error('Indica a morada de entrega.');
    if (type === 'DELIVERY' && !canDeliver)
      return toast.error('Sem entrega para esse código postal.');
    if (sub < minOrder) return toast.error(`Encomenda mínima de ${minOrder.toFixed(2)} €.`);
    if (when === 'later' && !scheduledLocal) return toast.error('Escolhe a hora do pedido.');
    if (when === 'later' && new Date(scheduledLocal).getTime() < Date.now())
      return toast.error('A hora escolhida já passou.');
    if (payment === 'CASH' && changeForInput.trim() && changeBack === null)
      return toast.error(`O valor para troco tem de ser ≥ ${total.toFixed(2)} €.`);

    setLoading(true);
    try {
      const { data } = await api.post(`/public/stores/${slug}/orders`, {
        type,
        customerName: `${firstName.trim()} ${lastName.trim()}`,
        customerPhone: phone.trim(),
        customerEmail: email.trim() || undefined,
        marketingConsent: marketing,
        deliveryAddress:
          type === 'DELIVERY'
            ? [address.trim(), complement.trim()].filter(Boolean).join(', ')
            : undefined,
        deliveryZipCode: type === 'DELIVERY' ? zip.trim() : undefined,
        deliveryCity: type === 'DELIVERY' ? city.trim() || undefined : undefined,
        notes: notes.trim() || undefined,
        scheduledFor: when === 'later' ? new Date(scheduledLocal).toISOString() : undefined,
        couponCode: coupon?.code,
        paymentMethod: payment,
        changeFor: payment === 'CASH' && !Number.isNaN(changeForNum) ? changeForNum : undefined,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          modifierIds: i.modifiers.map((m) => m.id),
        })),
      });
      clear();
      setPlaced({ number: data.number, total: data.total });
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Não foi possível enviar a encomenda.');
    } finally {
      setLoading(false);
    }
  }

  const mapQuery = [address, zip, city].filter(Boolean).join(', ');

  return (
    <main className="mx-auto max-w-md px-4 pb-12 pt-6">
      {s && <StoreTheme brandColor={s.brandColor} heroColor={s.heroColor} />}
      <Link
        href={`/${slug}`}
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} /> Continuar a comprar
      </Link>
      <h1 className="mb-6 font-display text-[28px] font-semibold tracking-tight">
        Finalizar encomenda
      </h1>

      <form onSubmit={submit} className="space-y-6">
        {/* 1. contacto */}
        <Section title="Contacto">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nome">
              <input value={firstName} required onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Apelido">
              <input value={lastName} required onChange={(e) => setLastName(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" className={inputCls} />
          </Field>
          <Field label="Número de telefone">
            <input type="tel" value={phone} required onChange={(e) => setPhone(e.target.value)} className={inputCls} />
          </Field>
          <label className="flex cursor-pointer items-start gap-2.5 pt-0.5 text-[12.5px] text-ink-soft">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
            />
            Aceito receber promoções e novidades desta loja por email/telefone.
          </label>
        </Section>

        {/* 2. tipo de pedido */}
        <Section title="Tipo de pedido">
          <div className="grid grid-cols-2 gap-2">
            {s?.acceptsPickup && (
              <ChoiceButton active={type === 'PICKUP'} onClick={() => setType('PICKUP')} icon={<ShoppingBag size={16} />}>
                Levantar no restaurante
              </ChoiceButton>
            )}
            {s?.acceptsDelivery && (
              <ChoiceButton active={type === 'DELIVERY'} onClick={() => setType('DELIVERY')} icon={<Bike size={16} />}>
                Entrega
              </ChoiceButton>
            )}
          </div>

          {type === 'DELIVERY' && (
            <div className="mt-3.5 space-y-3.5">
              <Field label="Morada (rua e número)">
                <input value={address} required onChange={(e) => setAddress(e.target.value)} className={inputCls} placeholder="Ex.: Rua das Flores, 12" />
              </Field>
              <Field label="Andar, porta (opcional)">
                <input value={complement} onChange={(e) => setComplement(e.target.value)} className={inputCls} placeholder="Ex.: 3º Esq., Bloco B, campainha 12" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Código postal">
                  <input value={zip} required onChange={(e) => setZip(e.target.value)} placeholder="1000-100" className={inputCls} />
                </Field>
                <Field label="Cidade">
                  <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
                </Field>
              </div>

              <AddressMap query={mapQuery} />

              {zip.trim().length >= 4 && quote.data && (
                quote.data.delivered ? (
                  <div className="flex items-center justify-between rounded-xl border border-line bg-cream/50 px-3.5 py-2.5 text-[13px]">
                    <span className="flex items-center gap-1.5 text-ink-soft">
                      <Bike size={14} /> Taxa de entrega nesta zona
                    </span>
                    <span className="font-semibold">
                      {deliveryFee > 0 ? `${deliveryFee.toFixed(2)} €` : 'grátis'}
                    </span>
                  </div>
                ) : (
                  <p className="rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                    Esta loja não entrega no código postal {zip}.
                  </p>
                )
              )}
            </div>
          )}

          <div className="mt-3.5">
            <Field label="Notas (opcional)">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: sem cebola, tocar à campainha…" className={inputCls} />
            </Field>
          </div>
        </Section>

        {/* 3. horário */}
        <Section title="Horário">
          <div className="grid grid-cols-2 gap-2">
            <ChoiceButton active={when === 'now'} onClick={() => setWhen('now')} icon={<Clock size={16} />}>
              Agora
            </ChoiceButton>
            <ChoiceButton active={when === 'later'} onClick={() => setWhen('later')} icon={<Clock size={16} />}>
              Mais tarde
            </ChoiceButton>
          </div>
          {when === 'later' && (
            <div className="mt-3.5">
              <Field label="Para quando?">
                <input
                  type="datetime-local"
                  value={scheduledLocal}
                  min={localNow()}
                  onChange={(e) => setScheduledLocal(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
          )}
        </Section>

        {/* 4. pagamento */}
        <Section title="Pagamento">
          <div className="grid grid-cols-2 gap-2">
            <ChoiceButton active={payment === 'CASH'} onClick={() => setPayment('CASH')} icon={<Banknote size={16} />}>
              Dinheiro
            </ChoiceButton>
            <ChoiceButton active={payment === 'CARD_ON_DELIVERY'} onClick={() => setPayment('CARD_ON_DELIVERY')} icon={<CreditCard size={16} />}>
              Cartão na entrega
            </ChoiceButton>
          </div>
          {payment === 'CASH' && (
            <div className="mt-3.5">
              <Field label="Pagas com quanto? (para levarmos troco)">
                <input
                  value={changeForInput}
                  onChange={(e) => setChangeForInput(e.target.value)}
                  inputMode="decimal"
                  placeholder={`Ex.: ${Math.ceil(total / 5) * 5}`}
                  className={inputCls}
                />
              </Field>
              {changeBack !== null && changeBack > 0 && (
                <p className="mt-1.5 text-[12.5px] font-medium text-green-700">
                  Troco a levar: {changeBack.toFixed(2)} €
                </p>
              )}
            </div>
          )}
        </Section>

        {/* cupão */}
        <div className="flex gap-2">
          <input
            value={couponInput}
            onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
            placeholder="CUPÃO"
            className={`${inputCls} flex-1 font-mono uppercase tracking-wider`}
          />
          <button
            type="button"
            onClick={applyCoupon}
            className="flex items-center gap-1.5 rounded-xl border border-brand bg-brand-soft px-4 py-2 text-[13px] font-semibold text-brand-dark transition-colors hover:bg-brand hover:text-white"
          >
            <Tag size={14} /> Aplicar
          </button>
        </div>

        {/* 5. resumo */}
        <div className="rounded-xl border border-line bg-white p-5 text-[13.5px] shadow-card">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-mute">
            Resumo
          </p>
          {items.map((i) => (
            <div key={i.key} className="flex items-center justify-between gap-2 py-1">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => setQuantity(i.key, i.quantity - 1)} aria-label="Menos um" className="flex h-6 w-6 items-center justify-center rounded-md border border-line hover:bg-cream">
                    <Minus size={12} />
                  </button>
                  <span className="w-5 text-center text-[13px] font-semibold">{i.quantity}</span>
                  <button type="button" onClick={() => setQuantity(i.key, i.quantity + 1)} aria-label="Mais um" className="flex h-6 w-6 items-center justify-center rounded-md border border-line hover:bg-cream">
                    <Plus size={12} />
                  </button>
                </div>
                <span className="min-w-0 truncate">
                  {i.name}
                  {i.modifiers.length > 0 && (
                    <span className="text-ink-mute"> · {i.modifiers.map((m) => m.name).join(', ')}</span>
                  )}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="font-medium">{(i.unitPrice * i.quantity).toFixed(2)} €</span>
                <button type="button" onClick={() => removeItem(i.key)} aria-label="Remover" className="text-ink-mute hover:text-red-600">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}

          <div className="mt-2 border-t border-dashed border-line pt-2">
            <Row label="Subtotal" value={`${sub.toFixed(2)} €`} />
            {discount > 0 && (
              <Row label={`Desconto (${coupon?.code})`} value={`−${discount.toFixed(2)} €`} green />
            )}
            {type === 'DELIVERY' && <Row label="Entrega" value={`${deliveryFee.toFixed(2)} €`} />}
            <div className="mt-2 flex items-center justify-between border-t border-dashed border-line pt-3">
              <span className="font-semibold">Total</span>
              <span className="font-display text-[19px] font-semibold">{total.toFixed(2)} €</span>
            </div>
            {vatEntries.length > 0 && (
              <div className="mt-2 space-y-0.5 border-t border-dashed border-line pt-2 text-[11.5px] text-ink-mute">
                {vatEntries.map((e) => (
                  <div key={e.rate} className="flex justify-between">
                    <span>IVA incluído ({e.rate}%)</span>
                    <span>{e.value.toFixed(2)} €</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !s?.isOpen || !canDeliver}
          className="w-full rounded-xl bg-brand py-4 text-[15px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99] disabled:opacity-50"
        >
          {!s?.isOpen ? 'Loja fechada' : loading ? 'A enviar…' : `Encomendar · ${total.toFixed(2)} €`}
        </button>
      </form>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3.5 rounded-xl border border-line bg-white p-5 shadow-card">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-mute">{title}</h2>
      {children}
    </section>
  );
}

function ChoiceButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex items-center justify-center gap-2 rounded-xl border px-2 py-3 text-center text-[13px] font-semibold leading-tight transition-all ' +
        (active
          ? 'border-brand bg-brand text-white shadow-card'
          : 'border-line bg-white text-ink-soft hover:border-brand/40')
      }
    >
      {icon}
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[12.5px] font-medium text-ink-soft">{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className={'flex justify-between py-0.5 ' + (green ? 'text-green-700' : 'text-ink-soft')}>
      <span>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
