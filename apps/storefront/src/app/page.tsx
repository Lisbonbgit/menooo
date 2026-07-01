import { Flame } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-lift">
        <Flame size={26} strokeWidth={2.2} />
      </span>
      <div>
        <h1 className="font-display text-4xl font-semibold tracking-tight">Comanda</h1>
        <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-ink-soft">
          Encomendas online diretas ao restaurante, sem comissões. Cada restaurante tem a sua loja
          em <code className="rounded-md bg-cream px-1.5 py-0.5 text-[12.5px]">/nome-da-loja</code>.
        </p>
      </div>
      <a
        href="/pizzaria-demo"
        className="rounded-2xl bg-espresso px-6 py-3 text-[14px] font-semibold text-cream shadow-card transition-transform hover:scale-[1.02]"
      >
        Ver loja de demonstração
      </a>
    </main>
  );
}
