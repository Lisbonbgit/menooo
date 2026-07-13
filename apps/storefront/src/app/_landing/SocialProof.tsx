/**
 * Prova social — Lenha e Brasa.
 * ⚠️ RASCUNHO A CONFIRMAR: a citação é redação nossa. Antes de divulgar,
 * confirmar com o dono que autoriza ser citado e substituir por foto + nome
 * reais. Não usar métricas inventadas como se fossem factos.
 */
export function SocialProof() {
  return (
    <section className="border-y border-line bg-cream/40">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <figure className="mx-auto max-w-3xl">
          <blockquote className="text-center font-display text-[26px] font-medium leading-[1.35] tracking-tight text-ink sm:text-[32px]">
            “Antes, cada pedido nas apps levava uma comissão. Com o Menooo, o cliente encomenda no
            nosso link e o <em className="text-brand-dark">talão sai sozinho na cozinha</em> — e o
            dinheiro fica todo connosco.”
          </blockquote>
          <figcaption className="mt-8 flex items-center justify-center gap-3">
            {/* placeholder da foto do dono — trocar por imagem real */}
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-espresso font-display text-[15px] font-semibold text-cream">
              LB
            </span>
            <span className="text-left">
              <span className="block text-[14px] font-semibold text-ink">Lenha e Brasa</span>
              <span className="block text-[12.5px] text-ink-mute">Pizzaria · cliente Menooo</span>
            </span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
