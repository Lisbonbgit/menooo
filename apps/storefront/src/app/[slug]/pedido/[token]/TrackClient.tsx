'use client';

import { useOrderTracking } from '@/lib/store-hooks';
import { stepsFor, currentStepIndex, isNegative } from '@/lib/order-status';

export function TrackClient({ slug, token }: { slug: string; token: string }) {
  const { data, isLoading, isError } = useOrderTracking(token);

  if (isLoading) return <main className="mx-auto max-w-lg p-6 text-center text-ink-mute">A carregar…</main>;
  if (isError || !data)
    return (
      <main className="mx-auto max-w-lg p-6 text-center">
        <p className="text-ink">Pedido não encontrado.</p>
        <a href={`/${slug}`} className="mt-3 inline-block text-brand-dark underline">Voltar à loja</a>
      </main>
    );

  const steps = stepsFor(data.type);
  const idx = currentStepIndex(data.status, data.type);
  const negativo = isNegative(data.status);

  return (
    <main className="mx-auto max-w-lg p-6">
      <header className="mb-5 text-center">
        <h1 className="font-display text-2xl font-semibold">{data.restaurantName}</h1>
        <p className="mt-1 text-[13px] text-ink-mute">Pedido nº {data.number}</p>
      </header>

      {negativo ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-center text-red-700">
          {data.status === 'REJECTED' ? 'Pedido recusado' : 'Pedido cancelado'}
        </div>
      ) : (
        <ol className="mb-6 space-y-2">
          {steps.map((s, i) => {
            const feito = idx >= i;
            const atual = idx === i;
            return (
              <li key={s.key} className="flex items-center gap-3">
                <span
                  className={
                    'flex h-6 w-6 items-center justify-center rounded-full text-[12px] ' +
                    (feito ? 'bg-brand text-white' : 'bg-cream text-ink-mute')
                  }
                >
                  {feito ? '✓' : i + 1}
                </span>
                <span className={atual ? 'font-semibold text-ink' : feito ? 'text-ink' : 'text-ink-mute'}>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="rounded-xl border border-line bg-white p-4">
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-soft">O teu pedido</h2>
        <ul className="space-y-1 text-[13.5px]">
          {data.items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-semibold text-brand-dark">{it.quantity}×</span>
              <span>{it.name}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-2 text-right font-display text-[15px] font-semibold">
          {data.total.toFixed(2)} €
        </p>
      </div>

      <a href={`/${slug}`} className="mt-5 block text-center text-[13px] text-brand-dark underline">
        Pedir novamente
      </a>
    </main>
  );
}
