/**
 * Declaração de posicionamento na voz da MARCA (não é um depoimento de cliente).
 * Sem atribuir a nenhuma empresa real — evita depoimentos fabricados.
 */
export function BrandPromise() {
  return (
    <section className="border-y border-line bg-cream/40">
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="font-display text-[28px] font-medium leading-[1.3] tracking-tight text-ink sm:text-[34px]">
          Cada pedido é teu. Cada cliente é teu.{' '}
          <em className="text-brand-dark">Cada euro é teu.</em>
        </p>
        <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-ink-soft">
          As apps de entrega ficam com a comissão e com a relação com o cliente. O Menooo dá-te a
          loja online — a marca, o link e os clientes continuam teus.
        </p>
        <p className="mt-7 text-[11.5px] font-semibold uppercase tracking-[0.2em] text-ink-soft">
          A promessa Menooo
        </p>
      </div>
    </section>
  );
}
