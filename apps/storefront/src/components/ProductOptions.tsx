'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import type { Product } from '@/lib/types';
import type { CartModifier } from '@/lib/cart-store';

export function ProductOptions({
  product,
  onClose,
  onAdd,
}: {
  product: Product;
  onClose: () => void;
  onAdd: (unitPrice: number, modifiers: CartModifier[]) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  const groupName = (groupId: string) =>
    product.modifierGroups.find((g) => g.id === groupId)?.name ?? '';

  function toggle(groupId: string, modifierId: string, maxSelect: number) {
    setSelected((prev) => {
      const current = prev[groupId] ?? [];
      if (maxSelect === 1) return { ...prev, [groupId]: [modifierId] };
      if (current.includes(modifierId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== modifierId) };
      }
      if (current.length >= maxSelect) {
        toast.error(`Máximo ${maxSelect} opções em "${groupName(groupId)}".`);
        return prev;
      }
      return { ...prev, [groupId]: [...current, modifierId] };
    });
  }

  const chosen: CartModifier[] = product.modifierGroups.flatMap((g) =>
    (selected[g.id] ?? []).map((id) => {
      const m = g.modifiers.find((x) => x.id === id)!;
      return { id: m.id, name: m.name, priceDelta: Number(m.priceDelta) };
    }),
  );

  const unitPrice = Number(product.price) + chosen.reduce((s, m) => s + m.priceDelta, 0);

  function confirm() {
    for (const g of product.modifierGroups) {
      const count = (selected[g.id] ?? []).length;
      if (g.required && count < Math.max(1, g.minSelect)) {
        toast.error(`Escolhe uma opção em "${g.name}".`);
        return;
      }
    }
    onAdd(unitPrice, chosen);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-espresso/60 backdrop-blur-[2px] sm:items-center sm:px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-up max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-paper p-6 shadow-bar sm:rounded-3xl"
      >
        {product.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            className="mb-5 h-44 w-full rounded-2xl object-cover"
          />
        )}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-[22px] font-semibold leading-tight">{product.name}</h3>
            {product.description && (
              <p className="mt-1 text-[13px] leading-relaxed text-ink-mute">{product.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full border border-line bg-white p-2 text-ink-soft transition-colors hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>

        {product.modifierGroups.map((g) => (
          <div key={g.id} className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13.5px] font-semibold">{g.name}</span>
              {g.required ? (
                <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-dark">
                  obrigatório
                </span>
              ) : (
                <span className="text-[11px] text-ink-mute">
                  até {g.maxSelect} {g.maxSelect === 1 ? 'opção' : 'opções'}
                </span>
              )}
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-white">
              {g.modifiers.map((m, i) => {
                const isSel = (selected[g.id] ?? []).includes(m.id);
                return (
                  <label
                    key={m.id}
                    className={
                      'flex cursor-pointer items-center justify-between px-4 py-3 text-[13.5px] transition-colors ' +
                      (i > 0 ? 'border-t border-line ' : '') +
                      (isSel ? 'bg-brand-soft/60' : 'hover:bg-cream/50')
                    }
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type={g.maxSelect === 1 ? 'radio' : 'checkbox'}
                        name={g.id}
                        checked={isSel}
                        onChange={() => toggle(g.id, m.id, g.maxSelect)}
                        className="h-4 w-4 accent-brand"
                      />
                      <span className={isSel ? 'font-medium' : ''}>{m.name}</span>
                    </span>
                    {Number(m.priceDelta) > 0 && (
                      <span className="text-[12.5px] font-medium text-ink-soft">
                        +{Number(m.priceDelta).toFixed(2)} €
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        <button
          onClick={confirm}
          className="mt-1 flex w-full items-center justify-between rounded-xl bg-brand px-5 py-4 font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99]"
        >
          <span className="text-[14.5px]">Adicionar ao carrinho</span>
          <span className="font-display text-[16px]">{unitPrice.toFixed(2)} €</span>
        </button>
      </div>
    </div>
  );
}
