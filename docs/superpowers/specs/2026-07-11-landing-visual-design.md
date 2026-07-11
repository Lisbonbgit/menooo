# Landing Menooo — prova visual do produto

**Data:** 2026-07-11 · **Estado:** aprovado pelo Matheus (design + download de fotos)

## Objetivo

Tornar a página de vendas (`apps/storefront/src/app/page.tsx`) mais elaborada e
apelativa para donos de restaurantes, mostrando o produto **a funcionar** —
impressão do talão, cozinha/balcão a receber o pedido — em vez de apenas o
descrever. Manter a identidade editorial existente (espresso, creme, paper,
laranja da marca) e a estrutura atual; enriquecer, não redesenhar.

## Decisões do utilizador

1. **Visuais mistos:** fotos reais de ambiente (Unsplash, licença comercial
   gratuita) + mockups do produto construídos em código.
2. **Âmbito:** enriquecer a página atual, sem mudar a direção visual.

## Estrutura da página (nova ordem)

1. **Hero — impressora térmica animada.** O talão atual passa a sair de uma
   impressora térmica desenhada em código (corpo escuro, ranhura, LED laranja).
   Animação de impressão ao carregar: o papel desce e o conteúdo revela-se
   (clip-path/height + translate). Com `prefers-reduced-motion`, renderiza o
   estado final estático. O conteúdo do talão existente mantém-se.
2. **Faixa de factos** (mantém-se como está).
3. **Faixa fotográfica 1 — cozinha.** Foto real de cozinha/forno em tons
   quentes, largura total, com overlay espresso (gradiente + mistura de cor
   para casar com a paleta) e frase forte: "Feito para o balcão, não para o
   back-office."
4. **Nova secção "Da encomenda ao talão"** — três mockups em código, lado a
   lado (empilhados em mobile), cada um com legenda curta:
   - **Telemóvel do cliente:** mini-loja fiel ao storefront (categorias,
     produto com preço, botão adicionar, barra de carrinho).
   - **Tablet do balcão:** ecrã de pedidos do dashboard onde um cartão de
     pedido novo entra com animação e badge de alarme a pulsar.
   - **Talão impresso:** versão compacta do talão, fechando o ciclo.
   Animações disparadas por IntersectionObserver quando a secção entra no ecrã.
5. **Funcionalidades** (6 itens, mantém-se).
6. **Faixa fotográfica 2 — balcão/entrega.** Foto real com overlay e mensagem
   "0% comissões — cada euro é teu."
7. **Como funciona** (mantém-se).
8. **Preço** (mantém-se).
9. **Footer** (mantém-se).

## Fotos

- 2 fotos do Unsplash (uso comercial livre, sem atribuição obrigatória),
  descarregadas para `apps/storefront/public/landing/` em resolução ~1600px,
  servidas com `next/image` (lazy, sizes correto).
- Critério de escolha: tons quentes/escuros que aceitem overlay espresso;
  cozinha profissional (faixa 1) e balcão/takeaway (faixa 2).

## Técnica

- Sem dependências novas. React server component com pequenos client
  components onde há IntersectionObserver.
- Animações CSS (keyframes em globals.css ou CSS module), todas com fallback
  `prefers-reduced-motion: reduce` → estado final.
- Mobile-first; mockups nunca causam scroll horizontal.
- Tokens de cor existentes do Tailwind (espresso, cream, paper, ink, brand).

## Fora de âmbito

- Testemunhos/social proof, alterações a preço ou copy das secções mantidas,
  alterações ao dashboard/storefront reais.

## Critérios de sucesso

- A página comunica visualmente impressão + receção de pedidos sem ler texto.
- Lighthouse/CWV não degradam de forma visível (imagens otimizadas, lazy).
- Sem layout shift no hero; animações suaves a 60fps; reduced-motion respeitado.
