import { Plus } from 'lucide-react';

const QA: Array<[string, React.ReactNode]> = [
  [
    'Como recebo o dinheiro?',
    <>
      O pagamento é feito diretamente ao restaurante, na entrega ou no levantamento (dinheiro ou
      cartão à porta). Cada euro é teu — sem intermediários.{' '}
      <span className="text-ink">MB Way e pagamento online estão a chegar em breve.</span>
    </>,
  ],
  [
    'E se não tiver impressora térmica?',
    'Funciona à mesma. Imprimes em qualquer impressora pelo browser, ou acompanhas os pedidos no tablet ou telemóvel do balcão. A impressora térmica é opcional.',
  ],
  [
    'Preciso de perceber de informática?',
    'Não. Montas o menu como quem escreve uma mensagem — categorias, produtos, preços. E ajudamos-te no arranque se precisares.',
  ],
  [
    'Posso cancelar quando quiser?',
    'Sim, sem fidelização. Cancelas quando quiseres e manténs o acesso até ao fim do período já pago.',
  ],
  [
    'Quanto tempo demora a aprovação?',
    'Analisamos e aprovamos a loja em menos de 2 horas em dias úteis. Enquanto isso, já podes montar o menu no painel.',
  ],
];

/** FAQ com as objeções reais do dono. Acordeão nativo <details> — sem JS. */
export function Faq() {
  return (
    <section className="border-t border-line bg-cream/40">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="font-display text-[30px] font-semibold leading-tight tracking-tight">
          Perguntas de quem está a decidir.
        </h2>
        <div className="mt-10 divide-y divide-line border-y border-line">
          {QA.map(([q, a]) => (
            <details key={q} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15.5px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {q}
                <Plus
                  size={18}
                  className="shrink-0 text-brand-dark transition-transform duration-200 group-open:rotate-45"
                />
              </summary>
              <p className="pb-5 pr-8 text-[14px] leading-relaxed text-ink-soft">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
