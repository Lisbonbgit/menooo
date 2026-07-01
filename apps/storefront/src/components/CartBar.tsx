'use client';

import Link from 'next/link';
import { ShoppingBag, ArrowRight } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';

export function CartBar({ slug }: { slug: string }) {
  const totalItems = useCartStore((s) => s.totalItems());
  const subtotal = useCartStore((s) => s.subtotal());

  if (totalItems === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 px-4">
      <Link
        href={`/${slug}/checkout`}
        className="animate-sheet-up mx-auto flex max-w-md items-center justify-between rounded-2xl bg-espresso px-5 py-4 text-cream shadow-bar transition-transform active:scale-[0.99]"
      >
        <span className="flex items-center gap-3">
          <span className="relative">
            <ShoppingBag size={20} />
            <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10.5px] font-bold text-white">
              {totalItems}
            </span>
          </span>
          <span className="text-[14px] font-medium">Ver carrinho</span>
        </span>
        <span className="flex items-center gap-2 font-display text-[16px] font-semibold">
          {subtotal.toFixed(2)} €
          <ArrowRight size={17} className="text-brand" />
        </span>
      </Link>
    </div>
  );
}
