import Link from 'next/link';
import { UtensilsCrossed, ArrowRight } from 'lucide-react';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://187.124.4.163:8081';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-paper px-6 text-center">
      <UtensilsCrossed size={34} strokeWidth={1.5} className="text-ink-mute" />
      <div>
        <p className="font-display text-[26px] font-semibold tracking-tight">Página não encontrada</p>
        <p className="mt-2 text-[14px] text-ink-soft">
          O endereço não existe ou a loja mudou de link.
        </p>
      </div>

      <div className="mt-2 rounded-2xl border border-line bg-white px-6 py-5 shadow-card">
        <p className="text-[14.5px] font-semibold">Tens um restaurante?</p>
        <p className="mt-1 text-[13px] text-ink-soft">
          Cria a tua loja online em minutos — sem comissões, 7 dias grátis.
        </p>
        <a
          href={`${DASHBOARD_URL}/register`}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
        >
          Criar a minha loja <ArrowRight size={15} />
        </a>
      </div>

      <Link href="/" className="text-[13px] font-medium text-brand hover:underline">
        ← Voltar ao início
      </Link>
    </main>
  );
}
