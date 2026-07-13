# Homepage que vende ao dono (Item 2)

**Data:** 2026-07-13 · **Estado:** aprovado pelo Matheus

## Objetivo

Acrescentar à landing (`apps/storefront/src/app/page.tsx`) as secções que faltam
para converter o dono de restaurante: prova social, comparação de custos vs
apps de delivery, FAQ com objeções reais e contacto humano. O title/descrição/OG
já foram feitos no Item 3.

## Ordem no funil

… hero → factos → foto cozinha → da encomenda ao talão → funcionalidades →
foto balcão → como funciona → **① Prova social** → **② Comparação de custos** →
preço (existente) → **③ FAQ** → **④ Contacto** → footer.

## Secções

### ① Prova social
Cartão editorial com citação atribuída à **Lenha e Brasa**, espaço para foto
(placeholder por agora), assinatura "— Lenha e Brasa". **Regra de honestidade:**
sem métrica inventada; a citação é um rascunho a validar com o dono antes de ir
público (depoimentos falsos com nome de empresa real são proibidos pela lei de
defesa do consumidor). Marcar claramente no código como conteúdo a confirmar.

### ② Comparação de custos (tabela fixa)
Título forte ("As apps ficam com 30% + IVA. O Menooo com 0%."). Tabela com 3
linhas de faturação e o custo real das apps = faturação × 30% × 1,23 (comissão
de 30% + IVA de 23% sobre a comissão):

| Faturas/mês | Comissão 30% | IVA 23% | Custo apps | Menooo | Poupas |
|---|---|---|---|---|---|
| €1.000 | €300 | €69 | €369 | €9,90 | ~€359 |
| €2.000 | €600 | €138 | €738 | €9,90 | ~€728 |
| €4.000 | €1.200 | €276 | €1.476 | €9,90 | ~€1.466 |

Nota honesta por baixo: "Comissão de referência ~30%; cada app cobra a sua."
Responsiva: scroll horizontal em mobile (contentor `overflow-x-auto`).

### ③ FAQ (acordeão nativo `<details>`, sem JS)
- **Como recebo o dinheiro?** — Pagamento direto ao restaurante, na entrega ou
  levantamento (dinheiro/cartão à porta). Cada euro é teu. MB Way e pagamento
  online a chegar em breve.
- **E se não tiver impressora térmica?** — Funciona à mesma: imprime em qualquer
  impressora pelo browser, ou vês no tablet/telemóvel. A térmica é opcional.
- **Preciso de perceber de informática?** — Não. Montas o menu como quem escreve
  uma mensagem; ajudamos no arranque.
- **Posso cancelar quando quiser?** — Sim, sem fidelização; mantéms o acesso até
  ao fim do período pago.
- **Quanto tempo demora a aprovação?** — Menos de 2h em dias úteis.

### ④ Contacto
Faixa "Falas com gente, não com uma página." + email **geral@menooo.com**
(botão mailto). Sem WhatsApp (decisão do utilizador).

## Técnica
- Tudo em `page.tsx` + componentes pequenos em `src/app/_landing/` se ajudar
  (ex.: `Faq.tsx`, `CostTable.tsx`). Server components; a FAQ usa `<details>`
  (sem JS). Sem dependências novas.
- Linguagem editorial existente (espresso/creme/paper/ink/brand); respeitar o
  passe anti-"cara de IA" (sem emojis, sombras achatadas, kickers maiúsculos).

## Fora de âmbito
- Calculadora interativa (ficou tabela fixa), WhatsApp, alterações ao preço.
- Item 4 (onboarding) e Item 5 (MB Way no painel, notificações, SEO) — a "menos
  de 2h" e o "MB Way brevemente" entram só como copy da FAQ aqui.

## Critérios de sucesso
- As 4 secções na linguagem da página, sem quebrar o layout mobile.
- Nenhum número inventado como facto; a prova social marcada como a validar.
- FAQ abre/fecha sem JS; tabela não causa scroll horizontal na página (só no
  seu contentor).
