import { Flame, ArrowRight } from 'lucide-react';
import { PrinterHero } from './_landing/PrinterHero';
import { PhotoBand } from './_landing/PhotoBand';
import { OrderFlow } from './_landing/OrderFlow';
import { SocialProof } from './_landing/SocialProof';
import { CostTable } from './_landing/CostTable';
import { Faq } from './_landing/Faq';
import { Contact } from './_landing/Contact';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://187.124.4.163:8081';

const FEATURES = [
  {
    n: '01',
    t: 'Loja online própria',
    d: 'Menu com tamanhos, extras e preços no teu endereço. Partilha o link ou um código QR na montra.',
  },
  {
    n: '02',
    t: 'Receção em tempo real',
    d: 'Os pedidos chegam ao tablet do balcão com alarme sonoro e avançam por estados até à entrega.',
  },
  {
    n: '03',
    t: 'Talão na impressora',
    d: 'Impressão automática na térmica do balcão via QZ Tray — ou em qualquer impressora, pelo browser.',
  },
  {
    n: '04',
    t: 'Zero comissões',
    d: 'Mensalidade fixa. Cada euro vendido é do restaurante — sem percentagens sobre as encomendas.',
  },
  {
    n: '05',
    t: 'Entregas por zona',
    d: 'Taxa e mínimo por código postal, horários por dia da semana e pausa imediata da loja.',
  },
  {
    n: '06',
    t: 'Números do negócio',
    d: 'Encomendas, receita, ticket médio e evolução de 7 dias, visíveis ao abrir o painel.',
  },
];

export default function HomePage() {
  return (
    <main>
      {/* ---------- hero ---------- */}
      <header className="relative overflow-hidden bg-espresso text-cream">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: 'radial-gradient(#F3EBDF 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="relative mx-auto max-w-5xl px-6">
          <nav className="flex items-center justify-between py-7">
            <div className="flex items-center gap-2">
              <Flame size={20} strokeWidth={2.4} className="text-brand" />
              <span className="font-display text-[19px] font-semibold tracking-tight">Menooo</span>
            </div>
            <div className="flex items-center gap-6">
              <a
                href={`${DASHBOARD_URL}/login`}
                className="text-[13.5px] font-medium text-cream/60 transition-colors hover:text-cream"
              >
                Entrar
              </a>
              <a
                href={`${DASHBOARD_URL}/register`}
                className="rounded-lg bg-brand-dark px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-ink"
              >
                Criar loja
              </a>
            </div>
          </nav>

          <div className="grid items-center gap-14 py-14 md:grid-cols-[1.15fr_0.85fr] md:py-20">
            <div>
              <p className="mb-5 text-[11.5px] font-semibold uppercase tracking-[0.22em] text-brand">
                Plataforma de encomendas online
              </p>
              <h1 className="font-display text-[40px] font-semibold leading-[1.06] tracking-tight sm:text-[52px]">
                O teu restaurante a vender online, <em className="text-brand">sem comissões.</em>
              </h1>
              <p className="mt-6 max-w-md text-[15.5px] leading-relaxed text-cream/60">
                Loja própria, pedidos no balcão em tempo real e talão impresso automaticamente. Os
                clientes encomendam direto — o dinheiro é todo do restaurante.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-5">
                <a
                  href={`${DASHBOARD_URL}/register`}
                  className="group flex items-center gap-2.5 rounded-lg bg-brand-dark px-6 py-3.5 text-[14.5px] font-semibold text-white transition-colors hover:bg-brand-ink"
                >
                  Começar — 7 dias grátis
                  <ArrowRight
                    size={16}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </a>
                <a
                  href="/pizzaria-demo"
                  className="text-[13.5px] font-medium text-cream/60 underline decoration-cream/25 underline-offset-4 transition-colors hover:text-cream"
                >
                  Ver loja de exemplo
                </a>
              </div>
              <p className="mt-6 text-[12px] text-cream/40">
                Sem cartão de crédito para começar · €9,90/mês depois do teste · cancela quando
                quiseres
              </p>
            </div>

            {/* impressora térmica a imprimir o pedido */}
            <PrinterHero />
          </div>
        </div>

        {/* faixa de factos */}
        <div className="relative border-t border-cream/10">
          <div className="mx-auto grid max-w-5xl grid-cols-2 divide-cream/10 px-6 sm:grid-cols-4 sm:divide-x">
            {[
              ['0%', 'de comissões'],
              ['7 dias', 'de teste grátis'],
              ['€9,90', 'por mês, fixo'],
              ['minutos', 'até estar online'],
            ].map(([v, l]) => (
              <div key={l} className="py-6 text-center sm:px-4">
                <p className="font-display text-[22px] font-semibold text-cream">{v}</p>
                <p className="mt-0.5 text-[11.5px] uppercase tracking-[0.14em] text-cream/40">
                  {l}
                </p>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ---------- ambiente: a cozinha ---------- */}
      <PhotoBand
        src="/landing/cozinha.jpg"
        alt="Pizzaiolo a enfornar uma pizza no forno do restaurante"
        kicker="Para quem está no balcão"
        title="Feito para o balcão, não para o back-office."
        sub="Menos ecrãs e menos passos: o Menooo vive ao lado da caixa e da cozinha, não numa central de suporte."
        priority
      />

      {/* ---------- da encomenda ao talão ---------- */}
      <OrderFlow />

      {/* ---------- funcionalidades ---------- */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.22em] text-brand-dark">
          O essencial, bem feito
        </p>
        <h2 className="mt-3 max-w-lg font-display text-[30px] font-semibold leading-tight tracking-tight">
          Tudo o que o balcão precisa — e nada do que não precisa.
        </h2>
        <div className="mt-12 grid gap-x-14 gap-y-10 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.n} className="border-t border-line pt-5">
              <div className="flex items-baseline gap-4">
                <span className="font-display text-[13px] font-semibold text-brand-dark">
                  {f.n}
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold">{f.t}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{f.d}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- ambiente: os talões ---------- */}
      <PhotoBand
        src="/landing/talao.jpg"
        alt="Talões de pedidos pendurados na barra da cozinha de um restaurante"
        kicker="Zero comissões"
        title="Cada euro vendido é do restaurante."
        sub="Mensalidade fixa de €9,90. Sem percentagens sobre as encomendas, sem surpresas no fim do mês."
      >
        <a
          href={`${DASHBOARD_URL}/register`}
          className="mt-7 inline-flex items-center gap-2.5 rounded-lg bg-brand-dark px-6 py-3 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-ink"
        >
          Começar — 7 dias grátis <ArrowRight size={15} />
        </a>
      </PhotoBand>

      {/* ---------- como funciona ---------- */}
      <section className="border-y border-line bg-cream/40">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="grid gap-10 md:grid-cols-3">
            {[
              [
                '1',
                'Regista o restaurante',
                'Nome da loja, endereço próprio e dados de acesso. Dois minutos, sem cartão.',
              ],
              [
                '2',
                'Monta o menu',
                'Categorias, produtos, tamanhos e extras. Horários, zonas de entrega e taxas.',
              ],
              [
                '3',
                'Recebe pedidos',
                'Partilha o link. Os pedidos caem no balcão ao vivo, com alarme e talão.',
              ],
            ].map(([n, t, d]) => (
              <div key={n}>
                <span className="font-display text-[38px] font-semibold leading-none text-brand">
                  {n}
                </span>
                <h3 className="mt-3 text-[15px] font-semibold">{t}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- prova social ---------- */}
      <SocialProof />

      {/* ---------- comparação de custos ---------- */}
      <CostTable />

      {/* ---------- preço ---------- */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="mx-auto max-w-xl border border-ink/15 bg-white px-8 py-10 text-center">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.22em] text-brand-dark">
            Um plano, sem letras pequenas
          </p>
          <p className="mt-5 font-display text-[52px] font-semibold leading-none tracking-tight">
            €9,90
            <span className="font-sans text-[15px] font-medium text-ink-mute"> /mês</span>
          </p>
          <p className="mt-2 text-[13px] text-ink-mute">depois de 7 dias de teste gratuito</p>
          <ul className="mx-auto mt-7 max-w-xs space-y-2.5 text-left text-[13.5px] text-ink-soft">
            {[
              'Encomendas ilimitadas, sem comissões',
              'Loja, receção em tempo real e impressão',
              'Promoções, cupões e zonas de entrega',
              'Cancela quando quiseres, sem fidelização',
            ].map((li) => (
              <li key={li} className="flex gap-3">
                <span className="text-brand-dark">—</span>
                {li}
              </li>
            ))}
          </ul>
          <a
            href={`${DASHBOARD_URL}/register`}
            className="mt-9 inline-flex items-center gap-2.5 rounded-lg bg-brand-dark px-7 py-3.5 text-[14.5px] font-semibold text-white transition-colors hover:bg-brand-ink"
          >
            Criar a minha loja <ArrowRight size={16} />
          </a>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <Faq />

      {/* ---------- contacto ---------- */}
      <Contact />

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-7 text-[12px] text-ink-mute">
          <span className="flex items-center gap-1.5">
            <Flame size={13} className="text-brand" />
            <span className="font-display text-[13px] font-semibold text-ink-soft">Menooo</span>
          </span>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <a href="/termos" className="hover:text-ink">Termos</a>
            <a href="/privacidade" className="hover:text-ink">Privacidade</a>
            <a
              href="https://www.livroreclamacoes.pt/Inicio/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink"
            >
              Livro de Reclamações
            </a>
            <a href="mailto:geral@menooo.com" className="hover:text-ink">geral@menooo.com</a>
          </nav>
          <span>© {new Date().getFullYear()} — encomendas online para restaurantes</span>
        </div>
      </footer>
    </main>
  );
}
