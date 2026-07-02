import {
  Flame,
  BellRing,
  Printer,
  TrendingUp,
  Percent,
  Store,
  QrCode,
  ArrowRight,
  Check,
} from 'lucide-react';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://187.124.4.163:8081';

export default function HomePage() {
  return (
    <main>
      {/* hero */}
      <header className="relative overflow-hidden bg-espresso px-5 pb-20 pt-8 text-cream">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'radial-gradient(#F3EBDF 1.2px, transparent 1.2px)',
            backgroundSize: '26px 26px',
          }}
        />
        <div className="relative mx-auto max-w-4xl">
          <nav className="mb-16 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
                <Flame size={18} strokeWidth={2.4} />
              </span>
              <span className="font-display text-xl font-semibold">Comanda</span>
            </div>
            <a
              href={`${DASHBOARD_URL}/login`}
              className="rounded-xl border border-cream/20 px-4 py-2 text-[13px] font-medium text-cream/80 transition-colors hover:bg-cream/10 hover:text-cream"
            >
              Entrar no painel
            </a>
          </nav>

          <div className="max-w-2xl">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3.5 py-1.5 text-[12px] font-semibold text-brand">
              <Percent size={13} /> 0% de comissões, para sempre
            </p>
            <h1 className="font-display text-[42px] font-semibold leading-[1.1] tracking-tight sm:text-[54px]">
              As encomendas do teu restaurante, <em className="text-brand">sem intermediários.</em>
            </h1>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-cream/65">
              O Comanda dá-te uma loja online própria, um painel de receção em tempo real e
              impressão automática de talões. Os clientes encomendam direto a ti — e o dinheiro é
              todo teu.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={`${DASHBOARD_URL}/register`}
                className="flex items-center gap-2 rounded-2xl bg-brand px-6 py-3.5 text-[15px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark hover:scale-[1.02]"
              >
                Criar a minha loja grátis <ArrowRight size={17} />
              </a>
              <a
                href="/pizzaria-demo"
                className="rounded-2xl border border-cream/20 px-6 py-3.5 text-[15px] font-medium text-cream/80 transition-colors hover:bg-cream/10"
              >
                Ver loja de exemplo
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* vantagens */}
      <section className="mx-auto max-w-4xl px-5 py-16">
        <h2 className="mb-2 text-center font-display text-3xl font-semibold tracking-tight">
          Tudo o que o balcão precisa
        </h2>
        <p className="mb-10 text-center text-[14px] text-ink-soft">
          Pensado para restaurantes, pizzarias, hamburguerias e take-aways.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<Store size={19} />}
            title="Loja online própria"
            text="Menu com opções e extras, no teu endereço. Partilha o link ou usa um código QR na montra."
          />
          <FeatureCard
            icon={<BellRing size={19} />}
            title="Receção em tempo real"
            text="Os pedidos chegam ao tablet do balcão com alarme sonoro. Aceitar, preparar, pronto, entregue — tudo num quadro."
          />
          <FeatureCard
            icon={<Printer size={19} />}
            title="Talão na térmica"
            text="Impressão automática de cada pedido na impressora do balcão. Sem impressora térmica? Imprime pelo browser."
          />
          <FeatureCard
            icon={<Percent size={19} />}
            title="Zero comissões"
            text="Diferente dos marketplaces: cada euro vendido é teu. Cupões e promoções controlados por ti."
          />
          <FeatureCard
            icon={<QrCode size={19} />}
            title="Entregas por zona"
            text="Taxa e mínimo por código postal, horários por dia da semana e pausa imediata quando a cozinha aperta."
          />
          <FeatureCard
            icon={<TrendingUp size={19} />}
            title="Números do dia"
            text="Encomendas, receita, ticket médio e evolução dos últimos 7 dias — visíveis ao abrir o painel."
          />
        </div>
      </section>

      {/* como funciona */}
      <section className="bg-cream/50 px-5 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-10 text-center font-display text-3xl font-semibold tracking-tight">
            A funcionar em 3 passos
          </h2>
          <ol className="grid gap-6 sm:grid-cols-3">
            <Step n={1} title="Regista o restaurante">
              Cria a conta em 2 minutos: nome da loja, endereço próprio e dados de acesso.
            </Step>
            <Step n={2} title="Monta o menu">
              Categorias, produtos, tamanhos e extras. Define horários, zonas de entrega e taxas.
            </Step>
            <Step n={3} title="Recebe pedidos">
              Partilha o link da loja. Os pedidos caem no balcão ao vivo, com alarme e talão.
            </Step>
          </ol>
        </div>
      </section>

      {/* CTA final */}
      <section className="px-5 py-16">
        <div className="mx-auto max-w-3xl rounded-3xl bg-espresso px-6 py-12 text-center text-cream shadow-lift">
          <h2 className="font-display text-3xl font-semibold tracking-tight">
            Pronto para vender sem comissões?
          </h2>
          <ul className="mx-auto mt-5 flex max-w-md flex-col gap-2 text-left text-[13.5px] text-cream/70 sm:flex-row sm:justify-center sm:gap-6">
            <li className="flex items-center gap-1.5">
              <Check size={15} className="text-brand" /> Sem cartão de crédito
            </li>
            <li className="flex items-center gap-1.5">
              <Check size={15} className="text-brand" /> Loja pronta hoje
            </li>
            <li className="flex items-center gap-1.5">
              <Check size={15} className="text-brand" /> Apoio em português
            </li>
          </ul>
          <a
            href={`${DASHBOARD_URL}/register`}
            className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-brand px-7 py-3.5 text-[15px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark hover:scale-[1.02]"
          >
            Criar a minha loja <ArrowRight size={17} />
          </a>
        </div>
      </section>

      <footer className="border-t border-line px-5 py-8 text-center text-[12px] text-ink-mute">
        © {new Date().getFullYear()} Comanda — sistema de encomendas online para restaurantes
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-card transition-transform hover:-translate-y-0.5">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand-dark">
        {icon}
      </span>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{text}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-line bg-white p-5 shadow-card">
      <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-espresso font-display text-[15px] font-semibold text-cream">
        {n}
      </span>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{children}</p>
    </li>
  );
}
