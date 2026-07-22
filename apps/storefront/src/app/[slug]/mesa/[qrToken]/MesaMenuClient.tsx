'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2, UtensilsCrossed, X } from 'lucide-react';
import { useStore, useTable, useMenu } from '@/lib/store-hooks';
import { useCartStore } from '@/lib/cart-store';
import { api } from '@/lib/api';
import { ProductOptions } from '@/components/ProductOptions';
import { StoreTheme } from '@/components/StoreTheme';
import type { Product } from '@/lib/types';

/**
 * Página da mesa (QR): menu de Sala com a mesa identificada.
 *
 * Fase 2b: com `store.dineInOrderingEnabled` ligada, ganha carrinho + "Confirmar pedido" —
 * reutiliza o mesmo padrão do `StoreClient` (useCartStore, quickAdd, <ProductOptions>). Sem
 * checkout próprio: quem já está sentado à mesa não precisa de morada/pagamento/entrega, só
 * confirma e o pedido segue para a cozinha (POST .../mesa/:qrToken/orders).
 *
 * Com a flag DESLIGADA, o comportamento fica IDÊNTICO à Fase 2a: só leitura, sem "+", sem
 * carrinho. Componente PRÓPRIO — NÃO reutiliza `StoreClient` de propósito (aquele é o caminho
 * de delivery/pickup, com o seu próprio checkout).
 */
export function MesaMenuClient({ slug, qrToken }: { slug: string; qrToken: string }) {
  const router = useRouter();
  const store = useStore(slug);
  const table = useTable(slug, qrToken);
  const menu = useMenu(slug, 'dine_in');

  const addItem = useCartStore((s) => s.addItem);
  const conflictsWith = useCartStore((s) => s.conflictsWith);
  const cartItems = useCartStore((s) => s.items);
  const cartSlug = useCartStore((s) => s.storeSlug);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clear);

  const [optionsFor, setOptionsFor] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (store.isLoading || table.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-ink-mute">
          <UtensilsCrossed size={28} strokeWidth={1.5} className="animate-pulse" />
          <p className="text-sm">A abrir o menu da mesa…</p>
        </div>
      </main>
    );
  }

  // Mesma resposta neutra para slug inexistente, token errado ou mesa inativa — o endpoint
  // público (`GET /public/stores/:slug/mesa/:qrToken`) já não distingue estes casos entre si.
  if (table.isError || !table.data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
        <UtensilsCrossed size={30} strokeWidth={1.5} className="text-ink-mute" />
        <p className="font-display text-xl font-semibold">Mesa não encontrada</p>
        <p className="text-sm text-ink-mute">Confirma o código QR ou pede ajuda ao staff.</p>
        <Link
          href={`/${slug}`}
          className="mt-3 text-[13px] font-medium text-brand-dark underline decoration-line underline-offset-2 hover:text-brand"
        >
          Ver a loja
        </Link>
      </main>
    );
  }

  const s = store.data;
  const t = table.data;
  const ordering = !!s?.dineInOrderingEnabled;

  // O carrinho persistido pode pertencer a outra loja (ou a outro separador desta) — só o que é
  // desta loja conta para a barra/sondagem e vai no pedido. Mesmo espírito do `conflictsWith` do
  // `StoreClient`, mas resolvido localmente em vez de bloquear a página inteira: aqui o cliente
  // só está a VER o menu, não faz sentido interromper com um ecrã de conflito antes de tentar
  // adicionar nada.
  const items = cartSlug === slug ? cartItems : [];
  const totalItems = items.reduce((n, i) => n + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  /** O carrinho é por loja: se vier de outra, pede confirmação antes de o substituir. */
  function confirmReplaceCart(storeName: string): boolean {
    if (!conflictsWith(slug)) return true;
    return confirm(
      `Tens um carrinho aberto noutra loja. Substituí-lo por artigos da ${storeName}?`,
    );
  }

  function quickAdd(product: Product) {
    if (product.modifierGroups.length > 0) {
      setOptionsFor(product);
      return;
    }
    if (!confirmReplaceCart(s?.name ?? 'desta loja')) return;
    addItem(slug, {
      productId: product.id,
      name: product.name,
      unitPrice: Number(product.price),
      vatRate: product.vatRate,
      modifiers: [],
    });
    toast.success(`${product.name} no carrinho`);
  }

  async function confirmOrder() {
    if (items.length === 0) return;
    setSubmitting(true);
    try {
      const { data } = await api.post(`/public/stores/${slug}/mesa/${qrToken}/orders`, {
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          modifierIds: i.modifiers.map((m) => m.id),
        })),
        notes: notes.trim() || undefined,
      });
      clearCart();
      router.push(`/${slug}/pedido/${data.trackToken}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Não foi possível enviar o pedido.');
      setSubmitting(false);
    }
  }

  return (
    <main
      className={
        'mx-auto max-w-3xl px-4 pt-8 ' +
        (ordering ? 'pb-[calc(7rem+env(safe-area-inset-bottom))]' : 'pb-16')
      }
    >
      {s && <StoreTheme brandColor={s.brandColor} heroColor={s.heroColor} />}

      <header className="mb-8 text-center">
        <p className="text-[13px] font-medium uppercase tracking-wide text-ink-mute">
          {s?.name ?? 'Menu'}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{t.name}</h1>
      </header>

      <div className="space-y-10">
        {menu.isLoading && <p className="text-ink-mute">A carregar o menu…</p>}
        {menu.isError && (
          <p className="text-ink-mute">Não foi possível carregar o menu. Tenta recarregar.</p>
        )}
        {menu.data?.map((cat) => (
          <section key={cat.id}>
            <h2 className="mb-4 font-display text-2xl font-semibold tracking-tight">
              {cat.name}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {cat.products.map((p) => (
                <li
                  key={p.id}
                  className={
                    'flex items-stretch gap-3 rounded-xl border border-line bg-white p-4 shadow-card' +
                    (ordering
                      ? ' justify-between transition-all hover:-translate-y-0.5 hover:shadow-lift'
                      : '')
                  }
                >
                  {p.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      loading="lazy"
                      className="h-20 w-20 shrink-0 self-center rounded-lg object-cover sm:h-[92px] sm:w-[92px]"
                    />
                  )}
                  <div className="min-w-0 flex-1 self-center">
                    <p className="text-[14.5px] font-semibold leading-snug">{p.name}</p>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink-mute">
                        {p.description}
                      </p>
                    )}
                    <p className="mt-2 font-display text-[15px] font-semibold text-brand-dark">
                      {Number(p.price).toFixed(2)} €
                      {ordering && p.modifierGroups.length > 0 && (
                        <span className="ml-1.5 font-sans text-[11px] font-medium text-ink-mute">
                          + opções
                        </span>
                      )}
                    </p>
                  </div>
                  {ordering && (
                    <button
                      onClick={() => quickAdd(p)}
                      aria-label={`Adicionar ${p.name}`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full bg-brand text-white shadow-card transition-all hover:bg-brand-dark active:scale-90"
                    >
                      <Plus size={19} strokeWidth={2.4} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {!ordering && (
        <footer className="mt-16 text-center text-[12.5px] text-ink-mute">
          Para pedir, chama o staff — encomendar por aqui chega na próxima atualização.
        </footer>
      )}

      {ordering && optionsFor && (
        <ProductOptions
          product={optionsFor}
          onClose={() => setOptionsFor(null)}
          onAdd={(unitPrice, modifiers) => {
            if (!confirmReplaceCart(s?.name ?? 'desta loja')) return;
            addItem(slug, {
              productId: optionsFor.id,
              name: optionsFor.name,
              unitPrice,
              vatRate: optionsFor.vatRate,
              modifiers,
            });
            toast.success(`${optionsFor.name} no carrinho`);
            setOptionsFor(null);
          }}
        />
      )}

      {ordering && totalItems > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 px-4">
          <button
            onClick={() => setCartOpen(true)}
            className="animate-sheet-up mx-auto flex w-full max-w-md items-center justify-between rounded-xl bg-espresso px-5 py-4 text-cream shadow-bar transition-transform active:scale-[0.99]"
          >
            <span className="flex items-center gap-3">
              <span className="relative">
                <ShoppingBag size={20} />
                <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10.5px] font-bold text-white">
                  {totalItems}
                </span>
              </span>
              <span className="text-[14px] font-medium">Rever pedido</span>
            </span>
            <span className="flex items-center gap-2 font-display text-[16px] font-semibold">
              {subtotal.toFixed(2)} €
              <ArrowRight size={17} className="text-brand" />
            </span>
          </button>
        </div>
      )}

      {ordering && cartOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-espresso/60 backdrop-blur-[2px] sm:items-center sm:px-4"
          onClick={() => setCartOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="animate-sheet-up max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-paper p-6 shadow-bar sm:rounded-3xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-[20px] font-semibold">O teu pedido</h3>
              <button
                onClick={() => setCartOpen(false)}
                aria-label="Fechar"
                className="rounded-full border border-line bg-white p-2 text-ink-soft transition-colors hover:text-ink"
              >
                <X size={17} />
              </button>
            </div>

            <div className="space-y-2">
              {items.map((i) => (
                <div
                  key={i.key}
                  className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => setQuantity(i.key, i.quantity - 1)}
                        aria-label="Menos um"
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-line hover:bg-cream"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-5 text-center text-[13px] font-semibold">
                        {i.quantity}
                      </span>
                      <button
                        onClick={() => setQuantity(i.key, i.quantity + 1)}
                        aria-label="Mais um"
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-line hover:bg-cream"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <span className="min-w-0 truncate text-[13.5px]">
                      {i.name}
                      {i.modifiers.length > 0 && (
                        <span className="text-ink-mute">
                          {' '}
                          · {i.modifiers.map((m) => m.name).join(', ')}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[13px] font-medium">
                      {(i.unitPrice * i.quantity).toFixed(2)} €
                    </span>
                    <button
                      onClick={() => removeItem(i.key)}
                      aria-label="Remover"
                      className="text-ink-mute hover:text-red-600"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
                Notas para a cozinha (opcional)
              </label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: sem cebola, alergia a marisco…"
                className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] shadow-card outline-none transition-colors focus:border-brand"
              />
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-dashed border-line pt-3 text-[13.5px]">
              <span className="font-semibold">Total</span>
              <span className="font-display text-[17px] font-semibold">
                {subtotal.toFixed(2)} €
              </span>
            </div>

            <button
              onClick={confirmOrder}
              disabled={submitting || items.length === 0}
              className="mt-4 flex w-full items-center justify-center rounded-xl bg-brand px-5 py-4 text-[14.5px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99] disabled:opacity-50"
            >
              {submitting ? 'A enviar…' : `Confirmar pedido · ${subtotal.toFixed(2)} €`}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
