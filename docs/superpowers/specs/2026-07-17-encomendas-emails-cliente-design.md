# Encomendas — emails ao cliente por estado

**Data:** 2026-07-17
**Ramo:** a criar, a partir do estado em produção
**Estado:** design aprovado pelo utilizador; falta revisão adversarial + revisão final

> Hoje o cliente que encomenda **nunca recebe email nenhum** — o módulo de encomendas nem conhece
> o `MailService` (ao contrário das reservas). A encomenda já guarda o `customerEmail` (o checkout
> recolhe-o) e o SMTP está ligado em produção (Resend). Falta só disparar o email quando o estado
> muda. **Fase A:** os emails de estado. **Fase B (à parte):** o questionário de feedback.

## 1. Objetivo

Quando o restaurante muda o estado de uma encomenda no painel, o cliente é avisado por email.
Quatro momentos, cada um com a informação que interessa ao cliente naquele ponto.

## 2. Estados e emails (aprovados)

O `OrderStatus` (verificado): `PENDING → ACCEPTED → PREPARING → READY → OUT_FOR_DELIVERY →
COMPLETED`, mais `REJECTED` e `CANCELLED`. A transição passa toda por `orders.service.ts
updateStatus` (linha ~220), que já valida o grafo `TRANSITIONS`.

Enviam email **4** transições (as outras — `PREPARING`, `OUT_FOR_DELIVERY` — **não**, para não
encher a caixa; o «em preparação» é dito dentro do email de aceite):

| Estado ao entrar | Email | Texto (adapta-se ao `OrderType`) |
|---|---|---|
| **ACCEPTED** | Pedido aceite | «O teu pedido nº X foi aceite e está em preparação. Avisamos-te quando estiver pronto.» + resumo dos itens + total |
| **READY** | Pedido pronto | **PICKUP:** «Está pronto para levantares!» + morada da loja. **DELIVERY:** «Está pronto e vai a caminho!» |
| **COMPLETED** | Concluído | «Bom apetite! Obrigado pela tua encomenda.» + botão **"Pedir novamente"** (link `STORE_URL/<slug>`). *(feedback → Fase B)* |
| **REJECTED** ou **CANCELLED** | Não avançou | «O teu pedido nº X foi cancelado pelo restaurante.» + o `rejectionReason`/motivo se existir + o telefone da loja para contacto |

> O nº do pedido mostrado ao cliente é o **`Order.number`** (verificado: «número sequencial por
> tenant, legível») — não o `id` cuid. É o mesmo número que o restaurante vê, logo os dois falam
> a mesma língua.

## 3. Arquitetura

- **Disparo pós-commit, fire-and-forget.** Em `updateStatus`, depois de o estado gravar (e do
  `emitOrderUpdated`/socket que já existe), chamar o email num `.catch()` que só loga — **o email
  nunca derruba a mudança de estado**. É exatamente o padrão do `afterCreate`/`afterCancel` das
  reservas.
- **O `MailModule` é `@Global()`** (verificado) — basta **injetar o `MailService`** no
  `OrdersService`, sem importar módulo nenhum.
- **`MailService` ganha os métodos de encomenda** (`sendOrderAccepted`, `sendOrderReady`,
  `sendOrderCompleted`, `sendOrderCancelled`), no molde de marca que já existe (`this.h/p/cta`).
  Cada um recebe o essencial (nº, itens, total, tipo, morada/telefone da loja, slug) e adapta o
  texto ao `OrderType`.
- **Condicional a `order.customerEmail`.** Sem email (manuais/telefone) → não envia, sem erro. Um
  `if (order.customerEmail)` antes de cada chamada, como o `afterCreate` das reservas faz.

## 4. Anti-spam — o que NÃO fazer

Estes emails **não** passam pelo teto de 5/24h por destinatário que a R3 pôs nas reservas. Razão:
esse teto existe porque a reserva é disparada pelo **cliente** (vetor de bombing). O email de
encomenda é disparado pelo **restaurante** ao mudar o estado — o cliente não o controla. Um
cliente fiel que faça 2 pedidos no mesmo dia geraria 8 emails; aplicar o teto de 5 fá-lo-ia
**perder** avisos legítimos do 2.º pedido. → usam o `send()` direto, sem `overRecipientLimit`.

*(O risco inverso — um restaurante a clicar nos estados repetidamente — é limitado: o grafo de
transições só avança, e `updateStatus` faz `if (order.status === status) return` sem reenviar. Um
email por transição, no máximo 4 por pedido.)*

## 5. Idempotência — não reenviar o mesmo email

O `updateStatus` já tem `if (order.status === status) return` — logo re-clicar o mesmo estado não
reenvia. Mas uma transição A→B→A→B (se o grafo o permitir nalgum par) reenviaria. **Verificar o
`TRANSITIONS`:** o grafo é só-avança (`PENDING→ACCEPTED→PREPARING→READY→…`), sem retrocessos, logo
cada estado é atingido uma vez por pedido — não é preciso um flag «email já enviado». Se algum dia
o grafo permitir voltar atrás, aí sim. Documentar a suposição.

## 6. Testes

- **E2e (`e2e-*.mjs` das encomendas, ou acrescentar):** com `SMTP_HOST=json` (o transporte de
  teste do nodemailer que os testes de mail já usam), criar uma encomenda ONLINE e percorrer
  `ACCEPTED → READY → COMPLETED`, confirmando que **cada** transição chama o `send` (espiar o
  transporter, como o `mail.service.spec.ts` faz) com o assunto certo; `REJECTED` a partir de
  `PENDING` também; uma encomenda **sem email** (manual) → **nenhum** send; e o texto de `READY`
  difere entre `PICKUP` e `DELIVERY`.
- **Unit (`mail.service.spec.ts`):** os 4 métodos novos renderizam sem rebentar e escapam o input
  do cliente (`esc()`); os de encomenda **não** consomem o balde de reservas (não chamam
  `overRecipientLimit`).
- **Regressões:** mudar o estado de uma encomenda continua a funcionar mesmo com o SMTP desligado
  (o `.catch` fire-and-forget); os emails de reserva e de conta intactos.
- **Browser/manual:** com `SMTP_HOST=json`, ler o log e ver os 4 emails a saírem ao percorrer os
  estados de um pedido de teste; confirmar que o de `READY` diz «levantar» num pickup e «a
  caminho» numa entrega.

## 7. Fora de âmbito (Fase B e v2)

- **Questionário de feedback** (a página de estrelas+comentário → email ao restaurante, e o botão
  no email de «entregue») — **Fase B**, spec próprio.
- Emails em `PREPARING` e `OUT_FOR_DELIVERY` (decisão: não, para não encher a caixa).
- SMS/push · rastreamento de entregador · reenviar um email à mão · preferências de opt-out do
  cliente (transacionais, não marketing — não requerem opt-out por agora).
