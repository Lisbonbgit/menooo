'use client';

import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { useStore, useTable, useMenu } from '@/lib/store-hooks';
import { StoreTheme } from '@/components/StoreTheme';

/**
 * Página da mesa (QR): menu de Sala só para ver, com a mesa identificada. Componente PRÓPRIO —
 * NÃO reutiliza `StoreClient` de propósito, porque aquele é o caminho do dinheiro (carrinho,
 * checkout) e esta rota é só leitura. Sem botão "+", sem `ProductOptions`, sem `CartBar`:
 * pedir pela mesa chega na Fase 2b.
 */
export function MesaMenuClient({ slug, qrToken }: { slug: string; qrToken: string }) {
  const store = useStore(slug);
  const table = useTable(slug, qrToken);
  const menu = useMenu(slug, 'dine_in');

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

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-8">
      {s && <StoreTheme brandColor={s.brandColor} heroColor={s.heroColor} />}

      <header className="mb-8 text-center">
        <p className="text-[13px] font-medium uppercase tracking-wide text-ink-mute">
          {s?.name ?? 'Menu'}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Mesa {t.name}</h1>
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
                  className="flex items-stretch gap-3 rounded-xl border border-line bg-white p-4 shadow-card"
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
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <footer className="mt-16 text-center text-[12.5px] text-ink-mute">
        Para pedir, chama o staff — encomendar por aqui chega na próxima atualização.
      </footer>
    </main>
  );
}
