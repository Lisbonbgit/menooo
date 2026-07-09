'use client';

import { use, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Bike, ShoppingBag, Clock, UtensilsCrossed } from 'lucide-react';
import { useStore, useMenu } from '@/lib/store-hooks';
import { useCartStore } from '@/lib/cart-store';
import { ProductOptions } from '@/components/ProductOptions';
import { CartBar } from '@/components/CartBar';
import type { Product } from '@/lib/types';

export default function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const store = useStore(slug);
  const menu = useMenu(slug);
  const addItem = useCartStore((s) => s.addItem);
  const [optionsFor, setOptionsFor] = useState<Product | null>(null);

  if (store.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-ink-mute">
          <UtensilsCrossed size={28} strokeWidth={1.5} className="animate-pulse" />
          <p className="text-sm">A preparar a mesa…</p>
        </div>
      </main>
    );
  }
  if (store.isError || !store.data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
        <UtensilsCrossed size={30} strokeWidth={1.5} className="text-ink-mute" />
        <p className="font-display text-xl font-semibold">Loja não encontrada</p>
        <p className="text-sm text-ink-mute">Confirma o endereço que te enviaram.</p>
      </main>
    );
  }

  const s = store.data;

  function quickAdd(product: Product) {
    if (product.modifierGroups.length > 0) {
      setOptionsFor(product);
      return;
    }
    addItem(slug, {
      productId: product.id,
      name: product.name,
      unitPrice: Number(product.price),
      vatRate: product.vatRate,
      modifiers: [],
    });
    toast.success(`${product.name} no carrinho`);
  }

  return (
    <main className="pb-32">
      {/* hero */}
      <header className="relative overflow-hidden bg-espresso px-4 pb-14 pt-10 text-cream">
        {s.coverUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.coverUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-espresso via-espresso/85 to-espresso/55" />
          </>
        )}
        <div className="relative mx-auto max-w-3xl">
          <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              {s.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.logoUrl}
                  alt={s.name}
                  className="h-16 w-16 shrink-0 rounded-2xl border border-cream/20 object-cover shadow-lift sm:h-20 sm:w-20"
                />
              )}
              <div>
                <h1 className="font-display text-4xl font-semibold tracking-tight">{s.name}</h1>
                {s.city && <p className="mt-1.5 text-[13.5px] text-cream/60">{s.city}</p>}
              </div>
            </div>
            <span
              className={
                'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ' +
                (s.isOpen ? 'bg-green-400/15 text-green-300' : 'bg-cream/10 text-cream/50')
              }
            >
              <span
                className={
                  'h-2 w-2 rounded-full ' + (s.isOpen ? 'bg-green-400' : 'bg-cream/40')
                }
              />
              {s.isOpen ? 'Aberto agora' : 'Fechado'}
            </span>
          </div>

          <div className="animate-fade-up mt-6 flex flex-wrap gap-2.5" style={{ animationDelay: '0.1s' }}>
            {s.acceptsDelivery && (
              <InfoChip icon={<Bike size={13} />}>
                Entrega {Number(s.deliveryFee) > 0 ? `${Number(s.deliveryFee).toFixed(2)} €` : 'grátis'}
              </InfoChip>
            )}
            {s.acceptsPickup && <InfoChip icon={<ShoppingBag size={13} />}>Take-away</InfoChip>}
            {Number(s.minOrderValue) > 0 && (
              <InfoChip icon={<Clock size={13} />}>
                Mínimo {Number(s.minOrderValue).toFixed(2)} €
              </InfoChip>
            )}
          </div>
        </div>
      </header>

      {/* navegação de categorias */}
      {menu.data && menu.data.length > 1 && (
        <nav className="sticky top-0 z-20 -mt-6 px-4">
          <div className="no-scrollbar mx-auto flex max-w-3xl gap-2 overflow-x-auto rounded-xl border border-line bg-white p-2 shadow-lift">
            {menu.data.map((cat) => (
              <a
                key={cat.id}
                href={`#cat-${cat.id}`}
                className="shrink-0 rounded-xl px-3.5 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:bg-brand-soft hover:text-brand-dark"
              >
                {cat.name}
              </a>
            ))}
          </div>
        </nav>
      )}

      {!s.isOpen && (
        <div className="mx-auto mt-6 max-w-3xl px-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
            A loja está fechada de momento — podes ver o menu, mas ainda não encomendar.
          </div>
        </div>
      )}

      {/* menu */}
      <div className="mx-auto max-w-3xl space-y-10 px-4 pt-8">
        {menu.isLoading && <p className="text-ink-mute">A carregar o menu…</p>}
        {menu.data?.map((cat) => (
          <section key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-24">
            <h2 className="mb-4 font-display text-2xl font-semibold tracking-tight">{cat.name}</h2>
            <ul className="stagger grid gap-3 sm:grid-cols-2">
              {cat.products.map((p) => (
                <li
                  key={p.id}
                  className="group flex items-stretch justify-between gap-3 rounded-xl border border-line bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift"
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
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold leading-snug">{p.name}</p>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink-mute">
                        {p.description}
                      </p>
                    )}
                    <p className="mt-2 font-display text-[15px] font-semibold text-brand-dark">
                      {Number(p.price).toFixed(2)} €
                      {p.modifierGroups.length > 0 && (
                        <span className="ml-1.5 font-sans text-[11px] font-medium text-ink-mute">
                          + opções
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    disabled={!s.isOpen}
                    onClick={() => quickAdd(p)}
                    aria-label={`Adicionar ${p.name}`}
                    className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full bg-brand text-white shadow-card transition-all hover:bg-brand-dark active:scale-90 disabled:opacity-30"
                  >
                    <Plus size={19} strokeWidth={2.4} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <footer className="mt-16 px-4 pb-6 text-center text-[11.5px] text-ink-mute">
        loja online por <span className="font-display font-semibold text-ink-soft">Menooo</span>
      </footer>

      {optionsFor && (
        <ProductOptions
          product={optionsFor}
          onClose={() => setOptionsFor(null)}
          onAdd={(unitPrice, modifiers) => {
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

      <CartBar slug={slug} />
    </main>
  );
}

function InfoChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-cream/15 bg-cream/5 px-3 py-1.5 text-[12px] text-cream/75">
      {icon}
      {children}
    </span>
  );
}
