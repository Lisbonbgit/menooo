const ROWS = [
  { fatura: '€1.000', comissao: '€300', iva: '€69', apps: '€369', poupa: '€359' },
  { fatura: '€2.000', comissao: '€600', iva: '€138', apps: '€738', poupa: '€728' },
  { fatura: '€4.000', comissao: '€1.200', iva: '€276', apps: '€1.476', poupa: '€1.466' },
];

/** Comparação de custos: comissão das apps (30% + IVA) vs mensalidade fixa do Menooo. */
export function CostTable() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.22em] text-brand-dark">
        A conta que ninguém te mostra
      </p>
      <h2 className="mt-3 max-w-2xl font-display text-[30px] font-semibold leading-tight tracking-tight">
        As apps ficam com 30% + IVA. O Menooo fica com 0%.
      </h2>
      <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-ink-soft">
        A comissão é sobre <strong>cada</strong> pedido, todos os meses. A mensalidade do Menooo é
        sempre a mesma — vendas o que vendas.
      </p>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-ink/15 text-left text-[11.5px] uppercase tracking-[0.1em] text-ink-soft">
              <th className="py-3 pr-4 font-semibold">Faturas / mês</th>
              <th className="px-4 py-3 text-right font-semibold">Comissão (30%)</th>
              <th className="px-4 py-3 text-right font-semibold">IVA (23%)</th>
              <th className="px-4 py-3 text-right font-semibold">Custo nas apps</th>
              <th className="px-4 py-3 text-right font-semibold">No Menooo</th>
              <th className="py-3 pl-4 text-right font-semibold">Poupas / mês</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            {ROWS.map((r) => (
              <tr key={r.fatura}>
                <td className="py-4 pr-4 font-semibold">{r.fatura}</td>
                <td className="px-4 py-4 text-right text-ink-soft">{r.comissao}</td>
                <td className="px-4 py-4 text-right text-ink-soft">{r.iva}</td>
                <td className="px-4 py-4 text-right font-semibold text-ink">{r.apps}</td>
                <td className="px-4 py-4 text-right font-semibold text-ink">€9,90</td>
                <td className="py-4 pl-4 text-right font-display text-[16px] font-semibold text-brand-dark">
                  {r.poupa}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[12px] text-ink-soft">
        Comissão de referência ~30% (cada app cobra a sua). Valores com IVA incluído dos dois lados —
        tanto no custo das apps como na mensalidade do Menooo (€9,90).
      </p>
    </section>
  );
}
