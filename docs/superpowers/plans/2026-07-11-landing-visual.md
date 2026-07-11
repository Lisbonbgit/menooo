# Landing com Prova Visual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enriquecer a landing do Menooo (`apps/storefront/src/app/page.tsx`) com prova visual do produto: impressora térmica animada no hero, secção "Da encomenda ao talão" (telemóvel + tablet + talão) e duas faixas fotográficas de ambiente.

**Architecture:** Página continua a ser um server component; animações de scroll ficam num pequeno client component reutilizável (`Reveal`). Mockups são JSX + Tailwind com os tokens existentes (espresso/cream/paper/ink/brand). Fotos locais em `public/landing/`, servidas por `next/image`.

**Tech Stack:** Next 15 (app router), Tailwind 3.4, lucide-react. Sem dependências novas.

## Global Constraints

- Sem novas dependências npm.
- Tokens de cor/tipografia existentes; nada de cores hard-coded fora dos tokens (exceto os já usados no ficheiro, ex. #E05A1E no glow).
- Todas as animações têm fallback `prefers-reduced-motion: reduce` → estado final.
- Sem scroll horizontal em 375px; sem layout shift no hero.
- Verificação por tarefa: `pnpm --filter @comanda/storefront lint && pnpm --filter @comanda/storefront typecheck` + verificação visual no browser.

---

### Task 1: Fotos de ambiente

**Files:**
- Create: `apps/storefront/public/landing/cozinha.jpg` (~1600px, tons quentes, cozinha profissional/forno)
- Create: `apps/storefront/public/landing/balcao.jpg` (~1600px, balcão/takeaway/entrega)

**Interfaces:**
- Produces: dois JPEG locais consumidos pela Task 4 via `next/image` (`/landing/cozinha.jpg`, `/landing/balcao.jpg`).

- [ ] Escolher 2 fotos no Unsplash (licença Unsplash, uso comercial livre) com dominante quente/escura que aceite overlay espresso.
- [ ] Descarregar com `curl -L -o apps/storefront/public/landing/<nome>.jpg "https://images.unsplash.com/photo-<id>?w=1600&q=70&fm=jpg"` (o parâmetro `w=1600&q=70` já devolve o tamanho certo).
- [ ] Confirmar peso ≤ 350 KB cada (`ls -lh`); se maior, reduzir `q`.
- [ ] Commit: `git add apps/storefront/public/landing && git commit -m "Landing: fotos de ambiente (cozinha, balcão)"`.

### Task 2: Reveal (client component) + keyframes

**Files:**
- Create: `apps/storefront/src/app/_landing/Reveal.tsx`
- Modify: `apps/storefront/src/app/globals.css` (novos keyframes)

**Interfaces:**
- Produces: `<Reveal className delay>` — client component que adiciona a classe `is-inview` quando entra no viewport (IntersectionObserver, `threshold: 0.25`, dispara uma vez). Filhos com classes `reveal-*` animam quando o pai tem `is-inview`.

- [ ] Criar `Reveal.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';

export function Reveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={clsx(className, inView && 'is-inview')}>
      {children}
    </div>
  );
}
```

- [ ] Acrescentar a `globals.css` (depois do bloco `.stagger`): keyframes `printFeed` (talão a sair: `clip-path: inset(0 0 100% 0)` → `inset(0)` com translateY), `orderIn` (cartão de pedido a entrar: translateY+scale+opacity), `ringPulse` (anel do alarme), e utilitários `.reveal-print`, `.reveal-order`, `.reveal-fade` que só animam sob `.is-inview`; bloco `@media (prefers-reduced-motion: reduce)` que desliga tudo (estado final).
- [ ] `pnpm --filter @comanda/storefront lint && pnpm --filter @comanda/storefront typecheck` → sem erros.
- [ ] Commit: `git commit -m "Landing: Reveal + keyframes de impressão/pedido"`.

### Task 3: PrinterHero — impressora térmica animada

**Files:**
- Create: `apps/storefront/src/app/_landing/PrinterHero.tsx`
- Modify: `apps/storefront/src/app/page.tsx` (substituir o bloco "talão de cozinha", linhas ~117–172)

**Interfaces:**
- Consumes: keyframes da Task 2 (`printFeed` corre no load do hero — não precisa de Reveal, anima ao montar).
- Produces: `<PrinterHero />` — server component; corpo da impressora (barra escura com ranhura, LED `bg-brand` a pulsar, etiqueta "Menooo Print") + talão existente a sair da ranhura com a animação `printFeed` (~2.2s, ease-out). Reserva a altura final (sem CLS): o contentor tem `min-h` igual ao talão completo.

- [ ] Criar `PrinterHero.tsx` movendo o JSX do talão atual (scallops incluídos) para dentro; envolver num contentor `overflow-hidden` sob a ranhura; aplicar classe `animate-[printFeed_2.2s_cubic-bezier(0.22,1,0.36,1)_0.4s_both]` (via classe utilitária `.print-anim` em globals.css para permitir o override reduced-motion).
- [ ] Em `page.tsx`, importar e substituir o bloco antigo por `<PrinterHero />`.
- [ ] Lint + typecheck; verificação visual: talão imprime ao carregar, sem CLS, hero ok a 375px.
- [ ] Commit: `git commit -m "Landing: hero com impressora térmica a imprimir o talão"`.

### Task 4: PhotoBand — faixas fotográficas

**Files:**
- Create: `apps/storefront/src/app/_landing/PhotoBand.tsx`
- Modify: `apps/storefront/src/app/page.tsx` (inserir faixa 1 após a faixa de factos; faixa 2 entre funcionalidades e "como funciona")

**Interfaces:**
- Consumes: fotos da Task 1.
- Produces: `<PhotoBand src alt kicker title sub>` — server component; `next/image` `fill` num contentor `h-[420px]` (mobile `h-[340px]`), overlay `bg-espresso/70` + gradiente, texto em `font-display` creme centrado à esquerda, kicker laranja uppercase.

- [ ] Criar `PhotoBand.tsx` com `Image` (`sizes="100vw"`, `quality={70}`), overlay duplo (cor + gradiente vertical) e slot de texto.
- [ ] Inserir na página: faixa 1 (`/landing/cozinha.jpg`, kicker "Para quem está no balcão", título "Feito para o balcão, não para o back-office.") e faixa 2 (`/landing/balcao.jpg`, kicker "Zero comissões", título "Cada euro vendido é do restaurante.").
- [ ] Lint + typecheck; verificação visual (texto legível sobre as fotos, contraste AA).
- [ ] Commit: `git commit -m "Landing: faixas fotográficas de ambiente"`.

### Task 5: OrderFlow — "Da encomenda ao talão"

**Files:**
- Create: `apps/storefront/src/app/_landing/OrderFlow.tsx`
- Modify: `apps/storefront/src/app/page.tsx` (nova secção entre a faixa 1 e as funcionalidades)

**Interfaces:**
- Consumes: `Reveal` + keyframes da Task 2.
- Produces: `<OrderFlow />` — server component (usa `Reveal` internamente); grid 3 colunas (stack em mobile) com: telemóvel (moldura arredondada, mini-loja: nome da loja, chips de categorias, 2 cartões de produto com preço e botão +, barra de carrinho "Ver carrinho · 34,50 €"), tablet (moldura landscape, header "Pedidos — ao vivo", coluna de cartões onde o cartão "#42 · Novo" entra com `orderIn` + badge com `ringPulse` e "🔔"), talão compacto (reutiliza visual do talão com scallops, rotate ligeiro). Cada painel com número (01/02/03) e legenda.

- [ ] Criar `OrderFlow.tsx`; os três painéis dentro de `<Reveal>` com atrasos escalonados (`.reveal-order` com `animation-delay` 0/0.15/0.3s).
- [ ] Inserir secção em `page.tsx` com kicker "Da encomenda ao talão" e título "O pedido cai no balcão. O talão sai sozinho.".
- [ ] Lint + typecheck; verificação visual: animações disparam ao fazer scroll até à secção; nada de scroll horizontal a 375px.
- [ ] Commit: `git commit -m "Landing: secção 'Da encomenda ao talão' (telemóvel, tablet, talão)"`.

### Task 6: Verificação final

- [ ] `pnpm --filter @comanda/storefront lint && pnpm --filter @comanda/storefront typecheck && pnpm --filter @comanda/storefront build` → tudo verde.
- [ ] Browser: desktop 1280 e mobile 375 — hero imprime, secções revelam, fotos carregam lazy, footer ok.
- [ ] Emular `prefers-reduced-motion: reduce` → tudo estático no estado final.
- [ ] Rever contraste dos textos sobre fotos (AA).
- [ ] Commit final se houver ajustes.
