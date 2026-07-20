# Página de acompanhamento do pedido — Design

**Data:** 2026-07-20
**Ramo:** `matheus-acompanhamento-pedido`
**Estado:** aprovado no brainstorming; a aguardar revisão do spec.

## 1. Contexto e objetivo

O cliente que faz uma encomenda no Menooo passa a ter uma **página pública para
acompanhar o estado do pedido ao vivo** (Recebido → Aceite → Em preparação → Pronto →
A caminho/Entregue). É a alternativa **grátis e para todos** ao SMS/WhatsApp (que custam por
mensagem). Os emails de estado já existem (live); esta página junta-se a eles.

Requisitos do utilizador:
- **Logo depois de fazer o pedido**, o cliente é levado para esta página.
- **Todos os emails** do pedido (aceite/pronto/entregue/cancelado) levam sempre o **link** para
  esta página.
- A página é **só de leitura** (mostra o estado; sem cancelar — decisão do utilizador).

## 2. Âmbito

**Entra:**
- Token de acompanhamento por `Order` + endpoint público de leitura.
- Rota nova no storefront `/[slug]/pedido/[token]` que mostra o estado + resumo e **atualiza
  sozinha** (sondagem).
- Redirecionamento do checkout para a página, logo após submeter.
- Botão "Acompanhar o pedido" em **todos** os emails de estado.

**Não entra:** cancelar/editar o pedido pelo cliente, tempo estimado (ETA), SMS/WhatsApp/push.
Funciona já para **entrega e levantamento**; o dine-in (Fase 2) reutiliza a mesma página.

## 3. Modelo de dados

`Order` ganha um token de acompanhamento:
```prisma
  trackToken String @unique @default(cuid())
```
- `@default(cuid())` → os pedidos NOVOS (criados via Prisma Client) recebem o token
  automaticamente.
- **Migração aditiva com backfill** (o `@default(cuid())` NÃO cria default na BD): `ADD COLUMN`
  nullable → `UPDATE "Order" SET "trackToken" = 'trk_' || md5("id")` (determinístico e único,
  pois `id` é único) → `SET NOT NULL` + índice único. Pedidos históricos ficam com token válido
  (não recebem emails novos, mas a coluna fica consistente). `pg_dump` antes.

## 4. Endpoint público

`GET /public/orders/:token` (no `PublicOrdersController`, `@Public()`, `@Throttle` generoso —
ex. 60/min — porque a página faz sondagem):
- Resolve o pedido por `trackToken`; **404 neutro** se não existir.
- Devolve uma **projeção mínima**, só o que a página precisa e que o próprio cliente já conhece:
  `number`, `status`, `type`, `restaurantName`, `slug`, `createdAt`, `items` (name/quantity),
  `total`. **NÃO** expõe telefone nem morada (reduz a sensibilidade de um link só de leitura).
- Sem autenticação: o `trackToken` (cuid, não-adivinhável) é a credencial do link.

**Segurança:** como a página é só de leitura e a projeção não expõe telefone/morada, o token vai
no caminho do URL (padrão dos "track your order"). Um link vazado mostra apenas o estado/itens do
próprio pedido — dano baixo (contrasta com o link da reserva, que permite cancelar e por isso usa
fragmento `#`).

## 5. Storefront — a página

`apps/storefront/src/app/[slug]/pedido/[token]/page.tsx` (+ componente cliente), ao lado da
`[slug]/reserva/[code]`. Reutiliza `StoreTheme`/tema da loja.
- Busca `GET /public/orders/:token` com React Query e `refetchInterval` ~10s; **pára a sondagem**
  quando o estado é terminal (COMPLETED/REJECTED/CANCELLED).
- Cabeçalho: nome da loja + `#número`; quando o pedido acabou de ser feito (vem do checkout),
  mostra "Encomenda enviada!".
- **Linha de estados** que se acende até ao estado atual:
  - DELIVERY: Recebido → Aceite → Em preparação → Pronto → **A caminho** → Entregue.
  - PICKUP: Recebido → Aceite → Em preparação → **Pronto para levantar** → Concluído (sem "A caminho").
  - REJECTED → "Pedido recusado"; CANCELLED → "Pedido cancelado" (estado terminal negativo, distinto).
- Resumo: artigos (quantidade × nome) + total + tipo. Rodapé com "Pedir novamente" (link para a loja).
- O mapa estado→passo é um **util puro** (`order-status.util.ts`) — testável em unit.

## 6. Checkout — redirecionar para a página

Hoje, ao submeter, o `CheckoutClient` (`apps/storefront/.../checkout/CheckoutClient.tsx`) faz
`POST /public/stores/:slug/orders`, limpa o carrinho e mostra um ecrã "Encomenda enviada!"
estático. Muda para:
- A resposta do `POST` passa a incluir o `trackToken` do pedido criado (o `createPublicOrder` já
  devolve a `Order`, que agora tem o campo).
- No sucesso: `clear()` do carrinho + **redireciona** para `/[slug]/pedido/[trackToken]`.
- O ecrã estático "Encomenda enviada!" deixa de ser necessário (o cabeçalho da página de
  acompanhamento cobre-o).

## 7. Emails — link em todos

`OrderMailInfo` (`mail.service.ts:36`) ganha `trackUrl: string`. No `afterStatusChange`
(`orders.service.ts:251`), preencher `trackUrl = ${STORE_URL}/${slug}/pedido/${order.trackToken}`
(o `order` que ali chega já tem o `trackToken`). Em **cada** email de estado
(`sendOrderAccepted`/`Ready`/`Completed`/`Cancelled`) acrescentar
`this.cta('Acompanhar o pedido', info.trackUrl)` — o helper `cta` já existe. `STORE_URL` já é usado
noutros emails.

## 8. Testes

- **Migração** preserva dados: contagem de `Order` igual; nenhum pedido sem `trackToken`; tokens únicos.
- **e2e** (`e2e-acompanhamento.mjs` ou estender o de encomendas): criar pedido público → obter
  `trackToken` da resposta → `GET /public/orders/:token` devolve PENDING + itens + total; avançar
  estado (staff) → a projeção reflete o novo estado; **token inválido → 404 neutro**; a projeção
  **não** traz telefone/morada.
- **Unit** do `order-status.util` (mapa estado→passos por tipo, incl. o ramo PICKUP sem "A caminho"
  e os terminais negativos). Validar por mutação.

## 9. Fora de âmbito / riscos

- Sem cancelar/editar pelo cliente (só leitura), sem ETA, sem SMS/WhatsApp/push.
- Migração aditiva com backfill — o único ponto sensível; mitigado por ids determinísticos,
  `pg_dump`, e o teste de preservação.
- A sondagem a 10s é suficiente (o restaurante muda o estado em minutos); evita a complexidade de
  um socket público autenticado.
- O dine-in (Fase 2) reutilizará esta página tal como está (o pedido de mesa também terá `trackToken`).
