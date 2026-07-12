const scallopBottom = {
  backgroundImage: 'radial-gradient(circle 6px at 10px 14px, transparent 6px, #FAF6F0 6.5px)',
  backgroundSize: '20px 12px',
};

/** Impressora térmica a imprimir o talão do pedido — anima no load da página
 *  (printFeed em globals.css); com reduced-motion aparece já impresso. */
export function PrinterHero() {
  return (
    // ilustração do produto: escondida de leitores de ecrã (o texto do hero conta a história)
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[300px]">
      <div
        className="absolute -inset-10 opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, #E05A1E, transparent)' }}
      />

      {/* corpo da impressora */}
      <div className="relative z-10 rounded-2xl border border-cream/10 bg-gradient-to-b from-espresso-light to-[#1A130D] px-5 pb-4 pt-4 shadow-lift">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="led-anim h-2 w-2 rounded-full bg-brand shadow-[0_0_8px_rgba(224,90,30,0.9)]" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cream/50">
              A imprimir
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-[0.18em] text-cream/40">
            térmica · 80 mm
          </span>
        </div>
        {/* ranhura do papel */}
        <div className="mt-3.5 h-2 rounded-full bg-black/60 shadow-[inset_0_1px_3px_rgba(0,0,0,0.9)]" />
      </div>

      {/* talão a sair da ranhura */}
      <div className="relative z-0 -mt-1.5 px-6">
        <div className="print-anim drop-shadow-2xl">
          <div className="bg-paper px-6 pb-6 pt-5 text-ink">
            <p className="text-center text-[10.5px] font-semibold uppercase tracking-[0.28em] text-ink-mute">
              Menooo · pedido
            </p>
            <p className="mt-1 text-center font-display text-[34px] font-semibold leading-none">
              #42
            </p>
            <p className="mt-1.5 text-center text-[11px] uppercase tracking-[0.14em] text-ink-mute">
              entrega · 20:41
            </p>
            <div className="my-4 border-t border-dashed border-ink/20" />
            <ul className="space-y-2 text-[13px] tabular-nums">
              <li className="flex justify-between">
                <span>
                  <span className="font-semibold text-brand-dark">2×</span> Margherita
                </span>
                <span>23,00</span>
              </li>
              <li className="pl-5 text-[11.5px] text-ink-mute">grande · massa fina</li>
              <li className="flex justify-between">
                <span>
                  <span className="font-semibold text-brand-dark">1×</span> Diavola
                </span>
                <span>11,50</span>
              </li>
              <li className="flex justify-between">
                <span>
                  <span className="font-semibold text-brand-dark">2×</span> Água 0,5 L
                </span>
                <span>2,40</span>
              </li>
            </ul>
            <div className="my-4 border-t border-dashed border-ink/20" />
            <div className="flex justify-between text-[13px] tabular-nums">
              <span>Entrega</span>
              <span>2,50</span>
            </div>
            <div className="my-4 border-t border-dashed border-ink/20" />
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-mute">
                Total
              </span>
              <span className="font-display text-[22px] font-semibold tabular-nums">39,40 €</span>
            </div>
            <p className="mt-4 text-center text-[10.5px] uppercase tracking-[0.2em] text-ink-mute">
              — obrigado —
            </p>
          </div>
          <div className="h-3" style={scallopBottom} />
        </div>
      </div>
    </div>
  );
}
