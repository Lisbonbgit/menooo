import type { CSSProperties } from 'react';
import { ArrowRight, Bell, Plus } from 'lucide-react';
import { Reveal } from './Reveal';

const scallop = {
  top: {
    backgroundImage:
      'radial-gradient(circle 5px at 8px -2px, transparent 5px, #FFFFFF 5.5px)',
    backgroundSize: '16px 10px',
  },
  bottom: {
    backgroundImage:
      'radial-gradient(circle 5px at 8px 12px, transparent 5px, #FFFFFF 5.5px)',
    backgroundSize: '16px 10px',
  },
};

function PhoneMockup() {
  return (
    <div className="reveal-rise mx-auto w-full max-w-[220px] rounded-[1.9rem] border border-ink/15 bg-espresso p-2 shadow-lift">
      <div className="overflow-hidden rounded-[1.45rem] bg-paper">
        {/* topo da loja */}
        <div className="bg-espresso px-4 pb-3 pt-4 text-cream">
          <p className="font-display text-[13.5px] font-semibold leading-none">Pizzaria Roma</p>
          <p className="mt-1 text-[8.5px] text-cream/60">Aberto até 23:00 · entrega 30–45 min</p>
        </div>
        {/* categorias */}
        <div className="flex gap-1.5 px-3 pt-3">
          {['Pizzas', 'Bebidas', 'Doces'].map((c, i) => (
            <span
              key={c}
              className={
                i === 0
                  ? 'rounded-full bg-brand px-2.5 py-1 text-[8.5px] font-semibold text-white'
                  : 'rounded-full border border-ink/15 px-2.5 py-1 text-[8.5px] font-medium text-ink-soft'
              }
            >
              {c}
            </span>
          ))}
        </div>
        {/* produtos */}
        <div className="space-y-2 px-3 py-3">
          {[
            ['Margherita', 'Tomate, mozzarella, manjericão', '11,50 €'],
            ['Diavola', 'Salame picante, mozzarella', '13,00 €'],
          ].map(([nome, desc, preco]) => (
            <div
              key={nome}
              className="flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2.5 shadow-card"
            >
              <div>
                <p className="text-[10px] font-semibold text-ink">{nome}</p>
                <p className="mt-0.5 max-w-[110px] truncate text-[8px] text-ink-mute">{desc}</p>
                <p className="mt-1 text-[9.5px] font-semibold tabular-nums text-brand-dark">
                  {preco}
                </p>
              </div>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white">
                <Plus size={11} strokeWidth={2.6} />
              </span>
            </div>
          ))}
        </div>
        {/* barra do carrinho */}
        <div className="mx-3 mb-3 flex items-center justify-between rounded-lg bg-espresso px-3 py-2.5 text-cream">
          <span className="text-[9px] font-semibold">Ver carrinho</span>
          <span className="text-[9px] font-semibold tabular-nums">5 itens · 36,90 €</span>
        </div>
      </div>
    </div>
  );
}

function CounterMockup() {
  return (
    <div className="reveal-rise mx-auto w-full max-w-[260px] rounded-xl border border-ink/15 bg-espresso p-1.5 shadow-lift">
      <div className="overflow-hidden rounded-lg bg-[#FDFBF7]">
        {/* header do painel */}
        <div className="flex items-center justify-between border-b border-line bg-white px-3 py-2">
          <p className="text-[9.5px] font-semibold text-ink">Pedidos · ao vivo</p>
          <span className="flex items-center gap-1 text-[8.5px] font-medium text-ink-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            ligado
          </span>
        </div>
        <div className="space-y-2 p-2.5">
          {/* pedido novo, entra animado */}
          <div
            className="reveal-order rounded-lg border-2 border-brand bg-white p-2.5 shadow-card"
            style={{ '--reveal-delay': '0.5s' } as CSSProperties}
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-ink">#42 · Entrega</p>
              <span className="flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[8px] font-semibold text-white">
                <span className="ring-pulse flex h-3 w-3 items-center justify-center rounded-full">
                  <Bell size={8} strokeWidth={2.6} />
                </span>
                Novo
              </span>
            </div>
            <p className="mt-1 text-[8.5px] text-ink-soft">2× Margherita · 1× Diavola · 2× Água</p>
            <div className="mt-2 flex gap-1.5">
              <span className="flex-1 rounded-md bg-brand py-1 text-center text-[8.5px] font-semibold text-white">
                Aceitar
              </span>
              <span className="flex-1 rounded-md border border-ink/15 py-1 text-center text-[8.5px] font-medium text-ink-soft">
                Imprimir
              </span>
            </div>
          </div>
          {/* pedido anterior */}
          <div className="rounded-lg border border-line bg-white p-2.5 opacity-70">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-ink">#41 · Levantamento</p>
              <span className="rounded-full bg-cream px-2 py-0.5 text-[8px] font-semibold text-ink-soft">
                Em preparação
              </span>
            </div>
            <p className="mt-1 text-[8.5px] text-ink-soft">1× Quatro Queijos · 1× Tiramisù</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReceiptMockup() {
  return (
    // a rotação vive num wrapper próprio: o riseIn anima transform no exterior
    // e esmagaria o rotate se partilhassem o mesmo nó
    <div className="reveal-rise mx-auto w-full max-w-[190px] drop-shadow-xl">
      <div className="rotate-[-1.5deg]">
      <div className="h-2.5" style={scallop.top} />
      <div className="bg-white px-4 pb-4 pt-3 text-ink">
        <p className="text-center text-[8.5px] font-semibold uppercase tracking-[0.24em] text-ink-mute">
          Menooo · pedido
        </p>
        <p className="mt-0.5 text-center font-display text-[22px] font-semibold leading-none">
          #42
        </p>
        <div className="my-2.5 border-t border-dashed border-ink/20" />
        <ul className="space-y-1 text-[9px] tabular-nums">
          <li className="flex justify-between">
            <span>2× Margherita</span>
            <span>23,00</span>
          </li>
          <li className="flex justify-between">
            <span>1× Diavola</span>
            <span>11,50</span>
          </li>
          <li className="flex justify-between">
            <span>2× Água 0,5 L</span>
            <span>2,40</span>
          </li>
        </ul>
        <div className="my-2.5 border-t border-dashed border-ink/20" />
        <ul className="space-y-1 text-[9px] tabular-nums">
          <li className="flex justify-between">
            <span>Entrega</span>
            <span>2,50</span>
          </li>
        </ul>
        <div className="my-2.5 border-t border-dashed border-ink/20" />
        <div className="flex items-baseline justify-between">
          <span className="text-[8px] font-semibold uppercase tracking-[0.16em] text-ink-mute">
            Total
          </span>
          <span className="font-display text-[14px] font-semibold tabular-nums">39,40 €</span>
        </div>
      </div>
      <div className="h-2.5" style={scallop.bottom} />
      </div>
    </div>
  );
}

const STEPS: Array<[string, string, () => JSX.Element]> = [
  ['O cliente encomenda na tua loja', 'No telemóvel, no teu endereço — sem app para instalar.', PhoneMockup],
  ['O balcão recebe na hora', 'Alarme sonoro e pedido em destaque até alguém o aceitar.', CounterMockup],
  ['O talão imprime-se sozinho', 'Na térmica do balcão, pronto a seguir para a cozinha.', ReceiptMockup],
];

/** Secção "Da encomenda ao talão": o percurso de um pedido em três
 *  mockups do produto, revelados quando a secção entra no ecrã. */
export function OrderFlow() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.22em] text-brand-dark">
        Da encomenda ao talão
      </p>
      <h2 className="mt-3 max-w-lg font-display text-[30px] font-semibold leading-tight tracking-tight">
        O pedido cai no balcão. O talão sai sozinho.
      </h2>
      <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-ink-soft">
        Sem tablets de terceiros nem telefone ocupado — o ciclo completo acontece dentro do
        Menooo.
      </p>

      <Reveal className="mt-14 grid items-start gap-12 md:grid-cols-3 md:gap-8">
        {STEPS.map(([titulo, texto, Mock], i) => (
          <div key={titulo} style={{ '--reveal-delay': `${i * 0.12}s` } as CSSProperties}>
            {/* os mockups são ilustração: escondidos de leitores de ecrã,
                a história fica nas legendas por baixo */}
            <div aria-hidden="true" className="relative flex items-center md:h-[340px]">
              <Mock />
              {/* seta de ligação entre passos (só em desktop) */}
              {i < 2 && (
                <ArrowRight
                  size={18}
                  className="absolute -right-[22px] top-1/2 hidden -translate-y-1/2 text-brand md:block"
                />
              )}
            </div>
            <div className="mt-6 border-t border-line pt-4">
              <h3 className="text-[15px] font-semibold">{titulo}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{texto}</p>
            </div>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
