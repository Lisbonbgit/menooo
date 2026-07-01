'use client';

import { use, useState } from 'react';
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
} from 'lucide-react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store-hooks';
import { useCartStore } from '@/lib/cart-store';

type OrderType = 'DELIVERY' | 'PICKUP';
type PaymentMethod = 'CASH' | 'CARD_ON_DELIVERY';

const inputCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] shadow-card outline-none transition-colors focus:border-brand';

export default function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const store = useStore(slug);
  const { items, setQuantity, removeItem, subtotal, clear } = useCartStore();

  const [type, setType] = useState<OrderType>('DELIVERY');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [zip, setZip] = useState('');
  const [notes, setNotes] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('CASH');
  const [loading, setLoading] = useState(false);
  const [placed, setPlaced] = useState<{ number: number; total: string } | null>(null);

  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);

  const s = store.data;
  const sub = subtotal();

  const quote = useQuery({
    queryKey: ['quote', slug, zip],
    queryFn: async () =>
      (await api.get(`/public/stores/${slug}/delivery-quote?zip=${encodeURIComponent(zip)}`))
        .data as { delivered: boolean; fee: number; minOrder: number },
    enabled: type === 'DELIVERY' && !!s,
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

  if (placed) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="animate-fade-up w-full max-w-sm rounded-3xl border border-line bg-white p-8 text-center shadow-lift">
          <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="text-green-600" size={34} />
          </span>
          <h1 className="font-display text-[26px] font-semibold">Encomenda enviada!</h1>
          <p className="mt-3 rounded-2xl bg-cream/70 py-3 font-display text-lg">
            Pedido <strong>#{placed.number}</strong>
            <span className="mx-2 text-ink-mute">·</span>
            {Number(placed.total).toFixed(2)} €
          </p>
          <p className="mt-4 text-[13px] leading-relaxed text-ink-mute">
            O restaurante vai confirmar a tua encomenda dentro de momentos. Obrigado! 🍕
          </p>
          <Link
            href={`/${slug}`}
            className="mt-6 block rounded-2xl bg-brand py-3 text-[14px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
          >
            Voltar à loja
          </Link>
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
          className="rounded-2xl bg-brand px-6 py-3 text-[14px] font-semibold text-white shadow-card"
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
    if (type === 'DELIVERY' && !address.trim()) return toast.error('Indica a morada de entrega.');
    if (type === 'DELIVERY' && !canDeliver)
      return toast.error('Sem entrega para esse código postal.');
    if (sub < minOrder) return toast.error(`Encomenda mínima de ${minOrder.toFixed(2)} €.`);

    setLoading(true);
    try {
      const { data } = await api.post(`/public/stores/${slug}/orders`, {
        type,
        customerName: name,
        customerPhone: phone,
        deliveryAddress: type === 'DELIVERY' ? address : undefined,
        deliveryZipCode: type === 'DELIVERY' ? zip : undefined,
        notes: notes || undefined,
        couponCode: coupon?.code,
        paymentMethod: payment,
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

  return (
    <main className="mx-auto max-w-md px-4 pb-12 pt-6">
      <Link
        href={`/${slug}`}
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} /> Continuar a comprar
      </Link>
      <h1 className="mb-6 font-display text-[28px] font-semibold tracking-tight">
        Finalizar encomenda
      </h1>

      {/* carrinho */}
      <section className="stagger mb-6 space-y-2.5">
        {items.map((i) => (
          <div key={i.key} className="rounded-2xl border border-line bg-white p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold">{i.name}</p>
                {i.modifiers.length > 0 && (
                  <p className="mt-0.5 text-[12px] text-ink-mute">
                    {i.modifiers.map((m) => m.name).join(', ')}
                  </p>
                )}
                <p className="mt-1 font-display text-[14px] font-semibold text-brand-dark">
                  {(i.unitPrice * i.quantity).toFixed(2)} €
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setQuantity(i.key, i.quantity - 1)}
                  aria-label="Menos um"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-line transition-colors hover:bg-cream"
                >
                  <Minus size={14} />
                </button>
                <span className="w-8 text-center text-[14px] font-semibold">{i.quantity}</span>
                <button
                  onClick={() => setQuantity(i.key, i.quantity + 1)}
                  aria-label="Mais um"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-line transition-colors hover:bg-cream"
                >
                  <Plus size={14} />
                </button>
                <button
                  onClick={() => removeItem(i.key)}
                  aria-label="Remover"
                  className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-ink-mute transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>

      <form onSubmit={submit} className="space-y-5">
        {/* tipo de serviço */}
        <div className="grid grid-cols-2 gap-2">
          {s?.acceptsDelivery && (
            <ChoiceButton
              active={type === 'DELIVERY'}
              onClick={() => setType('DELIVERY')}
              icon={<Bike size={16} />}
            >
              Entrega
            </ChoiceButton>
          )}
          {s?.acceptsPickup && (
            <ChoiceButton
              active={type === 'PICKUP'}
              onClick={() => setType('PICKUP')}
              icon={<ShoppingBag size={16} />}
            >
              Take-away
            </ChoiceButton>
          )}
        </div>

        <div className="space-y-3.5 rounded-2xl border border-line bg-white p-5 shadow-card">
          <Field label="Nome">
            <input value={name} required onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Telemóvel">
            <input value={phone} required onChange={(e) => setPhone(e.target.value)} className={inputCls} />
          </Field>
          {type === 'DELIVERY' && (
            <>
              <Field label="Morada de entrega">
                <input value={address} required onChange={(e) => setAddress(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Código postal">
                <input value={zip} required onChange={(e) => setZip(e.target.value)} placeholder="1000-100" className={inputCls} />
              </Field>
              {zip && quote.data?.delivered === false && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                  Sem entrega para esse código postal.
                </p>
              )}
            </>
          )}
          <Field label="Notas (opcional)">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: sem cebola, tocar à campainha…"
              className={inputCls}
            />
          </Field>
        </div>

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
        {coupon && (
          <p className="-mt-2 text-[12.5px] font-medium text-green-700">
            ✓ Cupão {coupon.code}: −{coupon.discount.toFixed(2)} €
          </p>
        )}

        {/* pagamento */}
        <div className="grid grid-cols-2 gap-2">
          <ChoiceButton
            active={payment === 'CASH'}
            onClick={() => setPayment('CASH')}
            icon={<Banknote size={16} />}
          >
            Dinheiro
          </ChoiceButton>
          <ChoiceButton
            active={payment === 'CARD_ON_DELIVERY'}
            onClick={() => setPayment('CARD_ON_DELIVERY')}
            icon={<CreditCard size={16} />}
          >
            Multibanco à porta
          </ChoiceButton>
        </div>

        {/* totais */}
        <div className="rounded-2xl border border-line bg-white p-5 text-[13.5px] shadow-card">
          <Row label="Subtotal" value={`${sub.toFixed(2)} €`} />
          {discount > 0 && (
            <Row label={`Desconto (${coupon?.code})`} value={`−${discount.toFixed(2)} €`} green />
          )}
          {type === 'DELIVERY' && <Row label="Entrega" value={`${deliveryFee.toFixed(2)} €`} />}
          <div className="mt-2 flex items-center justify-between border-t border-dashed border-line pt-3">
            <span className="font-semibold">Total</span>
            <span className="font-display text-[19px] font-semibold">{total.toFixed(2)} €</span>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !s?.isOpen || !canDeliver}
          className="w-full rounded-2xl bg-brand py-4 text-[15px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99] disabled:opacity-50"
        >
          {!s?.isOpen ? 'Loja fechada' : loading ? 'A enviar…' : `Encomendar · ${total.toFixed(2)} €`}
        </button>
      </form>
    </main>
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
        'flex items-center justify-center gap-2 rounded-2xl border py-3 text-[13.5px] font-semibold transition-all ' +
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
