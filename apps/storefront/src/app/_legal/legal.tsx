import Link from 'next/link';
import { Flame } from 'lucide-react';
import type { ReactNode } from 'react';

/** Dados da entidade legal que opera a plataforma Menooo. */
export const ENTIDADE = {
  nome: 'Fordaimon Foods Lda',
  nif: '517542510',
  morada: 'Praceta do Infantário 6, R/C D, 2720-304 Águas Livres, Amadora',
  email: 'geral@menooo.com',
};

export function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-paper">
      <header className="bg-espresso text-cream">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
          <Link href="/" className="flex items-center gap-2">
            <Flame size={18} strokeWidth={2.4} className="text-brand" />
            <span className="font-display text-[17px] font-semibold tracking-tight">Menooo</span>
          </Link>
          <Link href="/" className="text-[13px] text-cream/60 hover:text-cream">
            ← Voltar
          </Link>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        <p className="mt-2 text-[12.5px] text-ink-mute">Última atualização: {updated}</p>
        <div className="legal-prose mt-8 space-y-4 text-[14.5px] leading-relaxed text-ink-soft [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:text-ink [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_a]:text-brand-dark [&_a]:underline">
          {children}
        </div>
      </article>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-x-5 gap-y-1 px-6 py-6 text-[12px] text-ink-mute">
          <Link href="/termos" className="hover:text-ink">Termos e Condições</Link>
          <Link href="/privacidade" className="hover:text-ink">Política de Privacidade</Link>
          <a href="https://www.livroreclamacoes.pt/Inicio/" target="_blank" rel="noopener noreferrer" className="hover:text-ink">
            Livro de Reclamações
          </a>
          <a href={`mailto:${ENTIDADE.email}`} className="hover:text-ink">{ENTIDADE.email}</a>
        </div>
      </footer>
    </main>
  );
}
