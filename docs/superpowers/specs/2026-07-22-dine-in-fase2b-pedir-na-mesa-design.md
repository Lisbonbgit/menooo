# Dine-in Fase 2b — Pedir na mesa + conta da mesa — Design

**Data:** 2026-07-22
**Ramo:** `matheus-dine-in-fase2b`
**Estado:** aprovado no brainstorming; a aguardar revisão do spec.

## 1. Contexto

A Fase 2a (mesas de sala + QR + menu de Sala **só leitura** na rota `/[slug]/mesa/[qrToken]`)
está no main. A 2b fecha o dine-in: o cliente **pede** a partir do menu da mesa; o pedido entra
como `DINE_IN` ligado à mesa; os pedidos acumulam numa **conta da mesa** (sessão) que o staff fecha
no fim; a cozinha/receção mostra "Mesa X". Sem morada, sem contacto, sem pagamento online (paga-se
no balcão).

**Decisões do utilizador:** conta da mesa = **tab** (sessão que o staff fecha); o cliente **não se
identifica** (a mesa é a identidade); modelo de sessão = entidade `TableSession` (decidido).

## 2. Âmbito

**Entra:** `OrderType.DINE_IN`; `TableSession`; ligação `Order`↔mesa/sessão; endpoint de pedido na
mesa; ciclo abrir/fechar da sessão; **isolamento de menu** no `createPublicOrder` (delivery↔Sala);
interruptor "aceitar pedidos na mesa" por loja; carrinho + confirmação no menu da mesa; vista
"mesas abertas" + fechar; cozinha/receção mostra "Mesa X".

**Não entra:** pagamento processado pelo Menooo (paga-se no balcão); dividir a conta; o cliente ver
o total da mesa (só o staff vê; o cliente acompanha o SEU pedido pela página de acompanhamento);
Fase 3 (2 impressoras) e 4 (revamp).

## 3. Modelo de dados

- `OrderType` ganha **`DINE_IN`** (enum aditivo).
- `Tenant` ganha `dineInOrderingEnabled Boolean @default(false)` — o dono liga "aceitar pedidos na
  mesa" nas Definições; **desligado (default): a página da mesa fica só-leitura como na 2a.**
- Nova entidade **`TableSession`** (a conta):
  ```prisma
  model TableSession {
    id          String   @id @default(cuid())
    tenantId    String
    tenant      Tenant   @relation(...)
    dineTableId String
    dineTable   DineTable @relation(...)
    status      String   @default("OPEN") // OPEN | CLOSED
    openedAt    DateTime @default(now())
    closedAt    DateTime?
    orders      Order[]
    @@index([tenantId, status])
    @@index([dineTableId])
  }
  ```
  **Uma sessão OPEN por mesa** — imposto por advisory lock por mesa na criação do pedido (padrão do
  `createPublic` das reservas), ou índice único parcial `WHERE status='OPEN'` (na migração SQL).
- `Order` ganha `dineTableId String?` + `tableSessionId String?` (nulos em delivery/levantamento) +
  as relações; `DineTable` e `TableSession` ganham `orders Order[]`.
- **Pedido dine-in**: `type = DINE_IN`, `customerName` auto = o nome da mesa (ex. "Mesa 5"),
  `customerPhone = ''` (a mesa é a identidade — sem contacto), sem morada, `paymentMethod = CASH`
  (pago no balcão).

Migração **aditiva** (enum novo, colunas nullable, tabela nova, flag com default). `pg_dump` antes.

## 4. Isolamento de menu (corrige o gap da Fase 1)

O `createPublicOrder` (delivery/levantamento) e o novo pedido de mesa passam a **validar que os
produtos pertencem ao menu certo**: ao carregar os produtos, filtrar por `category.menu.type` =
`DELIVERY` para delivery/levantamento, `DINE_IN` para a mesa. Um produto do menu errado cai no erro
"Produto indisponível" já existente. (Extrair o cálculo de linhas/preços partilhado para um helper,
para o pedido de mesa não duplicar a lógica do `createPublicOrder`.)

## 5. Fluxo do cliente (storefront, na rota `/[slug]/mesa/[qrToken]`)

- Com "aceitar pedidos na mesa" **ligado**, o `MesaMenuClient` (2a) ganha **carrinho**: botão "+" nos
  produtos, o modal `ProductOptions` (tamanhos/extras, reutilizado da loja), uma barra de carrinho, e
  **"Confirmar pedido"** — **sem** contacto, morada, horário nem pagamento.
- Confirmar → `POST /public/stores/:slug/mesa/:qrToken/orders { items[], notes? }` → cria o pedido
  `DINE_IN` (abre a sessão da mesa se for o 1º; senão junta-se à aberta) → limpa o carrinho →
  **redireciona para a página de acompanhamento** (o pedido tem `trackToken`, feature já live).
- Pode pedir mais (volta ao menu) → junta-se à **mesma conta**.
- O endpoint resolve a mesa **por slug+token juntos** (isolamento da 2a mantém-se) e exige
  `dineInOrderingEnabled`; senão 404/403 neutro.

## 6. A conta da mesa (sessão)

- **Abrir:** no 1º pedido de uma mesa sem sessão OPEN, cria uma `TableSession` OPEN (atómico, com
  advisory lock por mesa para dois primeiros-pedidos simultâneos não abrirem duas).
- **Acumular:** os pedidos seguintes da mesa ligam-se à sessão OPEN.
- **Fechar:** o staff fecha no painel → `PATCH /table-sessions/:id/close` (OWNER/STAFF, `@TenantId`,
  `updateMany({id, tenantId})`) → `status=CLOSED`, `closedAt=now`. Paga-se no balcão — o Menooo
  **não processa o pagamento**, só regista a conta fechada. Fechar não força o estado dos pedidos
  (terminam sozinhos na cozinha); avisa se houver pedidos ainda por concluir, mas permite.

## 7. Painel

- **Vista "Mesas abertas"** (nova — aba própria ou secção na Receção): `GET /table-sessions?status=open`
  devolve as sessões abertas com os seus pedidos + **total acumulado**; por mesa, **"Fechar mesa"**.
  Atualiza com os eventos de pedido que a Receção já recebe (socket) ou por refetch.
- **Receção/cozinha:** os pedidos `DINE_IN` mostram **"Mesa X"** (em vez de Entrega/Take-away — a
  `Order` traz o nome da mesa via `dineTable`), e seguem o fluxo tipo **levantamento**: as
  `TRANSITIONS` do dine-in vão `READY→COMPLETED` (sem `OUT_FOR_DELIVERY`), e o `nextActions` já faz
  "else → Concluir". Impressão automática igual (o pedido chega por `order.created`).

## 8. Testes

- **Isolamento de menu (obrigatório):** um pedido de delivery com um produto da **Sala** → erro; um
  pedido de mesa com um produto do **Delivery** → erro.
- **Sessão:** 1º pedido abre a sessão; 2º pedido da mesma mesa junta-se (mesma `tableSessionId`);
  dois primeiros-pedidos concorrentes não abrem duas sessões (advisory lock).
- **Fechar:** fechar a sessão → CLOSED; um pedido novo na mesa depois de fechar → abre sessão nova.
- **Gate:** com `dineInOrderingEnabled=false`, o endpoint de pedido recusa (a página fica só-leitura).
- **Dine-in order:** contacto auto "Mesa X", sem morada, `DINE_IN`, `trackToken` presente; chega à
  Receção/cozinha marcado "Mesa X"; fluxo READY→COMPLETED.
- **Isolamento do QR (2a) mantém-se:** pedir com o slug de outro restaurante → 404.
- e2e (`e2e-dine-in-orders.mjs`) + browser.

## 9. Fora de âmbito / riscos

- Sem pagamento no Menooo, sem dividir conta, sem o cliente ver o total da mesa.
- **Sessão pendurada:** se o staff nunca fechar, um cliente novo na mesa junta-se à conta antiga
  (inerente a qualquer tab). Mitigação simples: a vista "mesas abertas" mostra `openedAt`/tempo, e o
  staff fecha; um auto-fecho ao fim do dia pode entrar depois (fora de âmbito agora).
- Migração aditiva; `pg_dump` antes.
- Reutilizar o `cart-store` (por slug) e o `ProductOptions` do storefront — não duplicar.
