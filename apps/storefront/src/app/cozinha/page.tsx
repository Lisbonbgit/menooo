import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'App de cozinha — Menooo',
  description:
    'Instala a app de cozinha do Menooo no tablet do restaurante: recebe as encomendas e imprime o talão na impressora de rede.',
  // Página de instalação, não de angariação: fora do índice e do sitemap.
  robots: { index: false, follow: false },
};

// O APK é servido pela API em /uploads (não sob /api). `||` e não `??`: o build
// pode injetar '' e o `??` não o apanharia. Nome versionado de propósito — o
// /uploads tem cache immutable de 7 dias, logo cada versão nova precisa de URL nova.
const APK_VERSION = '1.0.0';
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'https://api.menooo.com').replace(/\/api\/?$/, '');
const APK_URL = `${API_BASE}/uploads/menooo-cozinha-${APK_VERSION}.apk`;

const PASSOS = [
  {
    n: '1',
    titulo: 'Descarrega no tablet',
    texto:
      'Abre esta página no browser do próprio tablet da cozinha, não no computador. O ficheiro tem de ficar no tablet onde a app vai correr.',
  },
  {
    n: '2',
    titulo: 'Permite a instalação',
    texto:
      'O Android vai avisar que a app não vem da Play Store e perguntar se confias nesta origem. É esperado — ainda não está publicada. Autoriza o browser a instalar apps e volta atrás.',
  },
  {
    n: '3',
    titulo: 'Emparelha com o restaurante',
    texto:
      'Na app, escreve o código de emparelhamento. O código gera-se no painel, em Definições → App de cozinha, e só serve uma vez.',
  },
  {
    n: '4',
    titulo: 'Aponta a impressora',
    texto:
      'Em Impressão, escreve o IP da impressora térmica e carrega em Testar. A impressora tem de estar na mesma rede do tablet.',
  },
];

export default function CozinhaPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-ink-mute">
        Tablet de cozinha
      </p>
      <h1 className="font-display text-3xl font-semibold leading-tight">App de cozinha</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
        Mostra as encomendas em tempo real no tablet do balcão e imprime o talão na
        impressora térmica da tua rede — sem computador e sem programas extra.
      </p>

      <a
        href={APK_URL}
        className="mt-8 inline-flex items-center rounded-xl bg-brand px-6 py-3.5 text-[15px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99]"
      >
        Descarregar para Android
      </a>
      <p className="mt-3 text-[13px] text-ink-mute">
        Android 5.1 ou mais recente. Ainda não está na Play Store — instala-se
        diretamente.
      </p>

      <ol className="mt-12 space-y-7">
        {PASSOS.map((p) => (
          <li key={p.n} className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line text-[13px] font-semibold">
              {p.n}
            </span>
            <div>
              <h2 className="text-[15px] font-semibold">{p.titulo}</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{p.texto}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-12 rounded-xl border border-line p-5">
        <h2 className="text-[14px] font-semibold">A impressora não imprime?</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
          O tablet e a impressora têm de estar na mesma rede — a do restaurante, não a de
          convidados. Se o teste disser que a impressora não respondeu, confirma o IP; se
          disser que a ligação foi recusada, o IP está certo e o que falha é a porta, que
          quase sempre é a 9100.
        </p>
      </div>
    </main>
  );
}
