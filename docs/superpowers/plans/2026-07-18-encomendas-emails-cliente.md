# Encomendas — emails ao cliente por estado (Fase A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o restaurante muda o estado de uma encomenda no painel, o cliente é avisado por email — em quatro momentos (aceite, pronto, concluído, cancelado/recusado).

**Architecture:** O `OrdersService.updateStatus` já é o único ponto por onde passam as transições de estado. Depois de gravar o estado e emitir o socket, dispara o email **fire-and-forget** (`.catch()` que só loga — o email nunca derruba a mudança de estado), injetando o `MailService` (`@Global`, sem importar módulo). O `MailService` ganha 4 métodos de encomenda no molde de marca que já existe. A verificação autoritativa do disparo vive num spec unitário novo (`orders.service.spec.ts`) com o `MailService` mockado — porque os testes e2e ligam a uma API a correr noutro processo e **não** conseguem espiar o transporter in-process.

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL · nodemailer (transporte `json` nos testes) · Jest (ts-jest) · scripts e2e `.mjs` sobre HTTP.

## Global Constraints

- **Fire-and-forget:** o email **nunca** derruba a mudança de estado — sempre `void this.afterStatusChange(...).catch((e) => this.logger.error(...))`. (spec §3)
- **Só 4 transições enviam email:** `ACCEPTED`, `READY`, `COMPLETED`, e `REJECTED`/`CANCELLED` (partilham o mesmo email). `PREPARING` e `OUT_FOR_DELIVERY` **não** enviam. (spec §2)
- **Condicional a `order.customerEmail`:** sem email (encomendas manuais/telefone) → não envia, sem erro. (spec §3)
- **Sem teto anti-spam:** os emails de encomenda **não** passam pelo `overRecipientLimit` (o teto de 5/24h das reservas). São disparados pelo restaurante, não pelo cliente. Usam `this.send()` direto. (spec §4)
- **Nº mostrado ao cliente = `Order.number`** (sequencial legível por tenant), nunca o `id` cuid. (spec §2)
- **Texto adapta-se ao `OrderType`** (`PICKUP` vs `DELIVERY`), sobretudo no email de `READY`. (spec §2)
- **Escapar sempre o input do cliente** com `this.esc()` nos templates HTML. (padrão existente do MailService)
- **PT-PT** em todo o texto visível ao cliente.
- **Sem `rejectionReason`:** o schema `Order` não tem campo de motivo e o `updateStatus(status)` não o recebe — o email de cancelado **omite** o motivo (spec §2 dizia «se existir»; não existe). Não adicionar o campo (fora de âmbito).

---

## File Structure

- **`apps/api/src/modules/mail/mail.service.ts`** (modificar) — 4 métodos novos (`sendOrderAccepted`, `sendOrderReady`, `sendOrderCompleted`, `sendOrderCancelled`) + o tipo exportado `OrderMailInfo` + 2 helpers privados (`money`, `orderItems`). Responsabilidade: renderizar e enviar o HTML de marca. NÃO chama `overRecipientLimit`.
- **`apps/api/src/modules/mail/mail.service.spec.ts`** (modificar) — novo `describe` a provar: os 4 métodos renderizam e chamam `sendMail`; o texto de `READY` difere PICKUP/DELIVERY; o input do cliente é escapado; e **não** há teto (8 envios ao mesmo destinatário → 8 `sendMail`).
- **`apps/api/src/modules/orders/orders.service.ts`** (modificar) — injetar `MailService` + `Logger`; método privado `afterStatusChange(order, status)` que constrói o `OrderMailInfo` (busca os campos da loja no `tenant`) e chama o método certo; disparado fire-and-forget no fim de `updateStatus`.
- **`apps/api/src/modules/orders/orders.service.spec.ts`** (criar) — a verificação autoritativa do disparo: cada transição chama (ou não) o método certo; guard do `customerEmail`; fire-and-forget (um throw do mail não parte o `updateStatus`); o `info` de `READY` leva o `type`.
- **`apps/api/scripts/e2e-encomendas.mjs`** (criar) — smoke HTTP: criar encomenda → percorrer os estados → cada `PATCH` devolve 200 e o estado persiste (regressão: o fire-and-forget não parte a máquina de estados). Não afirma emails (impossível sobre HTTP — ver nota na Task 3).
- **`apps/api/package.json`** (modificar) — script `e2e:encomendas` (opcional, a par dos outros e2e).

**Nada muda no `OrdersModule`** — o `MailModule` é `@Global()` e já exporta o `MailService`; a injeção resolve sozinha.

---

## Task 1: MailService — 4 métodos de encomenda + tipo + helpers

**Files:**
- Modify: `apps/api/src/modules/mail/mail.service.ts`
- Test: `apps/api/src/modules/mail/mail.service.spec.ts`

**Interfaces:**
- Consumes: helpers privados já existentes no MailService — `this.send(to, subject, bodyHtml)`, `this.h(text)`, `this.p(text)`, `this.cta(label, url)`, `this.esc(s)`; e o `STORE_URL()` no topo do ficheiro (`() => process.env.STORE_URL ?? 'https://menooo.com'`).
- Produces (a Task 2 depende destas assinaturas EXATAS):
  ```ts
  export interface OrderMailInfo {
    number: number;                 // Order.number (nº legível)
    type: OrderType;                // 'PICKUP' | 'DELIVERY'
    restaurantName: string;         // tenant.name
    slug: string;                   // tenant.slug (link "pedir novamente")
    storePhone?: string | null;     // tenant.phone (email de cancelado)
    storeAddress?: string | null;   // "morada, cidade" composta (READY pickup)
    items: { name: string; quantity: number; lineTotal: number }[];
    total: number;                  // euros
  }
  // Todos: (to: string, customerName: string, info: OrderMailInfo) => Promise<void>
  sendOrderAccepted(to, customerName, info)
  sendOrderReady(to, customerName, info)
  sendOrderCompleted(to, customerName, info)
  sendOrderCancelled(to, customerName, info)
  ```

- [ ] **Step 1: Escrever os testes que falham (mail.service.spec.ts)**

Abre `apps/api/src/modules/mail/mail.service.spec.ts`. No topo, garante o import do enum: `import { OrderType } from '@prisma/client';` (adiciona à linha de imports existente se não estiver lá). No fim do ficheiro, ANTES do último `});` que fecha o describe principal — na verdade FORA dele, ao nível de topo — acrescenta um novo bloco. O ficheiro já faz `import { MailService } from './mail.service';` e usa o padrão `SMTP_HOST=json` + spy no `transporter.sendMail`. Replica esse setup:

```ts
describe('MailService — emails de encomenda', () => {
  let svc: MailService;
  let sendMail: jest.SpyInstance;

  const info = (over: Partial<Parameters<MailService['sendOrderAccepted']>[2]> = {}) => ({
    number: 42,
    type: OrderType.PICKUP,
    restaurantName: 'Pizzaria Demo',
    slug: 'pizzaria-demo',
    storePhone: '912345678',
    storeAddress: 'Rua das Flores 1, Lisboa',
    items: [{ name: 'Margherita', quantity: 2, lineTotal: 17 }],
    total: 17,
    ...over,
  });

  beforeEach(() => {
    process.env.SMTP_HOST = 'json';
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    svc = new MailService();
    sendMail = jest
      .spyOn(
        (svc as unknown as { transporter: { sendMail: () => Promise<unknown> } }).transporter,
        'sendMail',
      )
      .mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SMTP_HOST;
  });

  it('os 4 métodos enviam um email cada, com o nº do pedido no assunto', async () => {
    await svc.sendOrderAccepted('ana@x.pt', 'Ana', info());
    await svc.sendOrderReady('ana@x.pt', 'Ana', info());
    await svc.sendOrderCompleted('ana@x.pt', 'Ana', info());
    await svc.sendOrderCancelled('ana@x.pt', 'Ana', info());
    expect(sendMail).toHaveBeenCalledTimes(4);
    for (const call of sendMail.mock.calls) {
      expect(call[0].subject).toContain('42');
    }
  });

  it('READY diz «levantar» num PICKUP e «a caminho» numa DELIVERY', async () => {
    await svc.sendOrderReady('ana@x.pt', 'Ana', info({ type: OrderType.PICKUP }));
    const pickupHtml = sendMail.mock.calls[0][0].html as string;
    expect(pickupHtml.toLowerCase()).toContain('levantar');

    sendMail.mockClear();
    await svc.sendOrderReady('ana@x.pt', 'Ana', info({ type: OrderType.DELIVERY }));
    const deliveryHtml = sendMail.mock.calls[0][0].html as string;
    expect(deliveryHtml.toLowerCase()).toContain('caminho');
  });

  it('o email de concluído tem o botão "Pedir novamente" com o link da loja', async () => {
    await svc.sendOrderCompleted('ana@x.pt', 'Ana', info({ slug: 'pizzaria-demo' }));
    const html = sendMail.mock.calls[0][0].html as string;
    expect(html).toContain('/pizzaria-demo');
    expect(html).toContain('Pedir novamente');
  });

  it('escapa o nome do cliente (anti-injeção no template)', async () => {
    await svc.sendOrderAccepted('ana@x.pt', '<script>x</script>', info());
    const html = sendMail.mock.calls[0][0].html as string;
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('NÃO têm teto por destinatário: 8 emails ao mesmo cliente saem os 8', async () => {
    for (let i = 0; i < 8; i++) {
      await svc.sendOrderAccepted('ana@x.pt', 'Ana', info());
    }
    expect(sendMail).toHaveBeenCalledTimes(8); // contraste: reservas cortam ao 5.º
  });
});
```

Confirma que o `Logger` está importado no ficheiro (o describe existente já o usa: `import { Logger } from '@nestjs/common';`). Se não estiver, adiciona.

- [ ] **Step 2: Correr os testes e confirmar que falham**

Run: `cd apps/api && SMTP_HOST=json npx jest mail.service --silent`
Expected: FAIL — `svc.sendOrderAccepted is not a function` (e os restantes métodos).

- [ ] **Step 3: Implementar os helpers e os 4 métodos (mail.service.ts)**

Abre `apps/api/src/modules/mail/mail.service.ts`. Garante que o `OrderType` está importado do Prisma no topo (adiciona `import { OrderType } from '@prisma/client';` se ainda não existir). Adiciona o tipo exportado junto ao `ReservationMailInfo` (perto da linha 17):

```ts
export interface OrderMailInfo {
  number: number;
  type: OrderType;
  restaurantName: string;
  slug: string;
  storePhone?: string | null;
  storeAddress?: string | null;
  items: { name: string; quantity: number; lineTotal: number }[];
  total: number;
}
```

Junto aos outros helpers privados (a seguir ao `graceLine`, ~linha 175), acrescenta:

```ts
/** Formata euros em pt-PT: 17 → "17,00 €". */
private money(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} €`;
}

/** Tabela simples dos itens da encomenda (HTML inline, sem estilos externos). */
private orderItems(items: OrderMailInfo['items']): string {
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:4px 0;color:#2B211A;font-size:14px;font-family:Arial,Helvetica,sans-serif;">${i.quantity}× ${this.esc(i.name)}</td>` +
        `<td style="padding:4px 0;color:#2B211A;font-size:14px;font-family:Arial,Helvetica,sans-serif;text-align:right;white-space:nowrap;">${this.money(i.lineTotal)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 14px;border-top:1px dashed #EBE1D3;border-bottom:1px dashed #EBE1D3;">${rows}</table>`;
}
```

Na secção dos emails do ciclo de vida (a seguir aos métodos de reserva, no fim do ficheiro antes do `}` da classe), acrescenta os 4 métodos:

```ts
// ==========================================================================
// Emails de encomenda (estado mudado pelo restaurante — SEM teto por destinatário)
// ==========================================================================

async sendOrderAccepted(to: string, customerName: string, info: OrderMailInfo) {
  await this.send(
    to,
    `Pedido nº ${info.number} aceite — ${this.esc(info.restaurantName)}`,
    this.h('Pedido aceite!') +
      this.p(
        `Olá ${this.esc(customerName)}, o teu pedido nº <strong>${info.number}</strong> foi aceite e está em preparação.`,
      ) +
      this.p('Avisamos-te por email assim que estiver pronto.') +
      this.orderItems(info.items) +
      this.p(`Total: <strong>${this.money(info.total)}</strong>`),
  );
}

async sendOrderReady(to: string, customerName: string, info: OrderMailInfo) {
  const corpo =
    info.type === OrderType.PICKUP
      ? this.p(
          `Olá ${this.esc(customerName)}, o teu pedido nº <strong>${info.number}</strong> está pronto para levantares!`,
        ) +
        (info.storeAddress
          ? this.p(`Levanta em: <strong>${this.esc(info.storeAddress)}</strong>`)
          : '')
      : this.p(
          `Olá ${this.esc(customerName)}, o teu pedido nº <strong>${info.number}</strong> está pronto e vai a caminho!`,
        );
  await this.send(
    to,
    `Pedido nº ${info.number} pronto — ${this.esc(info.restaurantName)}`,
    this.h('O teu pedido está pronto!') + corpo,
  );
}

async sendOrderCompleted(to: string, customerName: string, info: OrderMailInfo) {
  await this.send(
    to,
    `Obrigado! Pedido nº ${info.number} — ${this.esc(info.restaurantName)}`,
    this.h('Bom apetite!') +
      this.p(
        `Olá ${this.esc(customerName)}, obrigado pela tua encomenda na <strong>${this.esc(info.restaurantName)}</strong>.`,
      ) +
      this.p('Esperamos que gostes. Quando quiseres repetir, é a um clique de distância.') +
      this.cta('Pedir novamente', `${STORE_URL()}/${info.slug}`),
  );
}

async sendOrderCancelled(to: string, customerName: string, info: OrderMailInfo) {
  await this.send(
    to,
    `Pedido nº ${info.number} cancelado — ${this.esc(info.restaurantName)}`,
    this.h('Pedido cancelado') +
      this.p(
        `Olá ${this.esc(customerName)}, lamentamos — o teu pedido nº <strong>${info.number}</strong> foi cancelado pelo restaurante.`,
      ) +
      this.p(
        info.storePhone
          ? `Para esclarecimentos, contacta a ${this.esc(info.restaurantName)}: <strong>${this.esc(info.storePhone)}</strong>.`
          : `Para esclarecimentos, contacta a ${this.esc(info.restaurantName)}.`,
      ),
  );
}
```

- [ ] **Step 4: Correr os testes e confirmar que passam**

Run: `cd apps/api && SMTP_HOST=json npx jest mail.service --silent`
Expected: PASS — todos os testes de mail (os antigos das reservas + os 5 novos de encomenda) verdes.

- [ ] **Step 5: Confirmar que compila**

Run: `cd apps/api && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
cd apps/api && git add src/modules/mail/mail.service.ts src/modules/mail/mail.service.spec.ts
git commit -m "feat(mail): 4 emails de encomenda (aceite/pronto/concluído/cancelado)

Métodos sendOrderAccepted/Ready/Completed/Cancelled no molde de marca
existente. READY adapta o texto ao OrderType (levantar vs a caminho).
Sem teto por destinatário (disparados pelo restaurante, não pelo cliente).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: OrdersService — disparar o email certo por transição (fire-and-forget)

**Files:**
- Modify: `apps/api/src/modules/orders/orders.service.ts`
- Test: `apps/api/src/modules/orders/orders.service.spec.ts` (criar)

**Interfaces:**
- Consumes (da Task 1): `MailService.sendOrderAccepted/Ready/Completed/Cancelled(to, customerName, info: OrderMailInfo)` e o tipo `OrderMailInfo`.
- Consumes (já existentes): `this.prisma.order.findFirst`, `this.prisma.order.update`, `this.prisma.tenant.findUnique`, `this.gateway.emitOrderUpdated`, `this.getForTenant(tenantId, id)` (devolve o pedido com `items`).
- Produces: nada para tasks seguintes (o e2e da Task 3 usa só os endpoints HTTP).

**Contexto do `updateStatus` atual** (`apps/api/src/modules/orders/orders.service.ts:220`):
```ts
async updateStatus(tenantId: string, id: string, status: OrderStatus) {
  const order = await this.prisma.order.findFirst({ where: { id, tenantId } });
  if (!order) throw new NotFoundException('Encomenda não encontrada.');
  if (order.status === status) return this.getForTenant(tenantId, id);
  if (!TRANSITIONS[order.status].includes(status)) {
    throw new BadRequestException(`Transição inválida: ${order.status} → ${status}.`);
  }
  await this.prisma.order.update({ where: { id }, data: { status } });
  const updated = await this.getForTenant(tenantId, id);
  this.gateway.emitOrderUpdated(tenantId, updated);
  return updated;
}
```
O construtor atual é `constructor(private readonly prisma, private readonly gateway, private readonly promotions)`.

- [ ] **Step 1: Escrever o spec que falha (orders.service.spec.ts)**

Cria `apps/api/src/modules/orders/orders.service.spec.ts`. Instancia o serviço diretamente com mocks (à imagem do `mail.service.spec.ts`, sem módulo Nest). O `MailService` mockado é o "spy" autoritativo do disparo.

```ts
import { Logger } from '@nestjs/common';
import { OrderStatus, OrderType } from '@prisma/client';
import { OrdersService } from './orders.service';

type AnyFn = jest.Mock;

function make() {
  const base = {
    id: 'o1',
    tenantId: 't1',
    number: 42,
    type: OrderType.PICKUP,
    status: OrderStatus.PENDING,
    customerName: 'Ana',
    customerEmail: 'ana@x.pt',
    total: 17,
    items: [{ name: 'Margherita', quantity: 2, total: 17, modifiers: [] }],
  };
  const prisma = {
    order: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'Pizzaria Demo',
        slug: 'pizzaria-demo',
        phone: '912345678',
        address: 'Rua das Flores 1',
        city: 'Lisboa',
      }),
    },
  };
  const gateway = { emitOrderUpdated: jest.fn() };
  const promotions = {};
  const mail = {
    sendOrderAccepted: jest.fn().mockResolvedValue(undefined),
    sendOrderReady: jest.fn().mockResolvedValue(undefined),
    sendOrderCompleted: jest.fn().mockResolvedValue(undefined),
    sendOrderCancelled: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new OrdersService(prisma as any, gateway as any, promotions as any, mail as any);
  return { svc, prisma, gateway, mail, base };
}

// Deixa correr o microtask do fire-and-forget antes de afirmar.
const flush = () => new Promise((r) => setImmediate(r));

describe('OrdersService.updateStatus — emails por transição', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('PENDING→ACCEPTED envia sendOrderAccepted com o nº e o email do cliente', async () => {
    const { svc, prisma, mail, base } = make();
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...base, status: OrderStatus.PENDING }) // leitura-guarda
      .mockResolvedValue({ ...base, status: OrderStatus.ACCEPTED }); // getForTenant
    await svc.updateStatus('t1', 'o1', OrderStatus.ACCEPTED);
    await flush();
    expect(mail.sendOrderAccepted).toHaveBeenCalledTimes(1);
    expect(mail.sendOrderAccepted).toHaveBeenCalledWith(
      'ana@x.pt',
      'Ana',
      expect.objectContaining({ number: 42, type: OrderType.PICKUP }),
    );
  });

  it('ACCEPTED→PREPARING não envia email nenhum', async () => {
    const { svc, prisma, mail, base } = make();
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...base, status: OrderStatus.ACCEPTED })
      .mockResolvedValue({ ...base, status: OrderStatus.PREPARING });
    await svc.updateStatus('t1', 'o1', OrderStatus.PREPARING);
    await flush();
    expect(mail.sendOrderAccepted).not.toHaveBeenCalled();
    expect(mail.sendOrderReady).not.toHaveBeenCalled();
    expect(mail.sendOrderCompleted).not.toHaveBeenCalled();
    expect(mail.sendOrderCancelled).not.toHaveBeenCalled();
  });

  it('READY→COMPLETED envia sendOrderCompleted', async () => {
    const { svc, prisma, mail, base } = make();
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...base, status: OrderStatus.READY })
      .mockResolvedValue({ ...base, status: OrderStatus.COMPLETED });
    await svc.updateStatus('t1', 'o1', OrderStatus.COMPLETED);
    await flush();
    expect(mail.sendOrderCompleted).toHaveBeenCalledTimes(1);
  });

  it('PENDING→REJECTED envia sendOrderCancelled', async () => {
    const { svc, prisma, mail, base } = make();
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...base, status: OrderStatus.PENDING })
      .mockResolvedValue({ ...base, status: OrderStatus.REJECTED });
    await svc.updateStatus('t1', 'o1', OrderStatus.REJECTED);
    await flush();
    expect(mail.sendOrderCancelled).toHaveBeenCalledTimes(1);
  });

  it('sem customerEmail → não envia (encomenda manual/telefone)', async () => {
    const { svc, prisma, mail, base } = make();
    const semEmail = { ...base, customerEmail: null };
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...semEmail, status: OrderStatus.PENDING })
      .mockResolvedValue({ ...semEmail, status: OrderStatus.ACCEPTED });
    await svc.updateStatus('t1', 'o1', OrderStatus.ACCEPTED);
    await flush();
    expect(mail.sendOrderAccepted).not.toHaveBeenCalled();
  });

  it('fire-and-forget: um erro no email NÃO parte o updateStatus', async () => {
    const { svc, prisma, mail, base } = make();
    mail.sendOrderAccepted.mockRejectedValue(new Error('SMTP em baixo'));
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...base, status: OrderStatus.PENDING })
      .mockResolvedValue({ ...base, status: OrderStatus.ACCEPTED });
    const res = await svc.updateStatus('t1', 'o1', OrderStatus.ACCEPTED);
    await flush();
    expect(res).toEqual(expect.objectContaining({ status: OrderStatus.ACCEPTED }));
  });

  it('READY leva o type no info (para o texto diferir PICKUP/DELIVERY)', async () => {
    const { svc, prisma, mail, base } = make();
    const delivery = { ...base, type: OrderType.DELIVERY };
    prisma.order.findFirst
      .mockResolvedValueOnce({ ...delivery, status: OrderStatus.PREPARING })
      .mockResolvedValue({ ...delivery, status: OrderStatus.READY });
    await svc.updateStatus('t1', 'o1', OrderStatus.READY);
    await flush();
    expect(mail.sendOrderReady).toHaveBeenCalledWith(
      'ana@x.pt',
      'Ana',
      expect.objectContaining({ type: OrderType.DELIVERY }),
    );
  });
});
```

- [ ] **Step 2: Correr o spec e confirmar que falha**

Run: `cd apps/api && npx jest orders.service --silent`
Expected: FAIL — o construtor do `OrdersService` só aceita 3 argumentos (o 4.º `mail` é `undefined`), logo `mail.sendOrderAccepted` nunca é chamado / TypeError no compile do teste. (Se o ts-jest recusar o 4.º argumento, é o sinal de que falta a Task 2.)

- [ ] **Step 3: Injetar MailService + Logger e disparar o email (orders.service.ts)**

Abre `apps/api/src/modules/orders/orders.service.ts`.

1. No import do `@nestjs/common` (linha 1), acrescenta `Logger`:
   ```ts
   import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
   ```
2. Acrescenta o import do MailService e do tipo (a seguir aos imports existentes, ~linha 8):
   ```ts
   import { MailService, OrderMailInfo } from '../mail/mail.service';
   ```
3. Estende o construtor (linha ~31) com o `mail` e um `logger`:
   ```ts
   private readonly logger = new Logger(OrdersService.name);

   constructor(
     private readonly prisma: PrismaService,
     private readonly gateway: OrdersGateway,
     private readonly promotions: PromotionsService,
     private readonly mail: MailService,
   ) {}
   ```
4. No fim do `updateStatus` (antes do `return updated;`, linha ~235), dispara fire-and-forget:
   ```ts
   this.gateway.emitOrderUpdated(tenantId, updated);
   void this.afterStatusChange(updated, status).catch((e) =>
     this.logger.error(`email de encomenda (${status}) falhou: ${e?.message ?? e}`),
   );
   return updated;
   ```
5. Adiciona o método privado logo a seguir ao `updateStatus`:
   ```ts
   /**
    * Pós-transição: avisa o cliente por email. Fire-and-forget — o chamador faz `.catch`, aqui
    * nunca lançamos por causa de um email. Só 4 transições enviam (ACCEPTED/READY/COMPLETED e
    * REJECTED|CANCELLED); PREPARING e OUT_FOR_DELIVERY são silenciosas (o «em preparação» é dito
    * no email de aceite). Sem customerEmail (encomendas manuais) → não envia.
    */
   private async afterStatusChange(
     order: Prisma.OrderGetPayload<{ include: { items: { include: { modifiers: true } } } }>,
     status: OrderStatus,
   ) {
     if (!order.customerEmail) return;
     const dispara =
       status === OrderStatus.ACCEPTED ||
       status === OrderStatus.READY ||
       status === OrderStatus.COMPLETED ||
       status === OrderStatus.REJECTED ||
       status === OrderStatus.CANCELLED;
     if (!dispara) return;

     const tenant = await this.prisma.tenant.findUnique({
       where: { id: order.tenantId },
       select: { name: true, slug: true, phone: true, address: true, city: true },
     });
     if (!tenant) return;

     const info: OrderMailInfo = {
       number: order.number,
       type: order.type,
       restaurantName: tenant.name,
       slug: tenant.slug,
       storePhone: tenant.phone,
       storeAddress: [tenant.address, tenant.city].filter(Boolean).join(', ') || null,
       items: order.items.map((i) => ({
         name: i.name,
         quantity: i.quantity,
         lineTotal: Number(i.total),
       })),
       total: Number(order.total),
     };

     switch (status) {
       case OrderStatus.ACCEPTED:
         return this.mail.sendOrderAccepted(order.customerEmail, order.customerName, info);
       case OrderStatus.READY:
         return this.mail.sendOrderReady(order.customerEmail, order.customerName, info);
       case OrderStatus.COMPLETED:
         return this.mail.sendOrderCompleted(order.customerEmail, order.customerName, info);
       case OrderStatus.REJECTED:
       case OrderStatus.CANCELLED:
         return this.mail.sendOrderCancelled(order.customerEmail, order.customerName, info);
     }
   }
   ```
   (`Prisma` já está importado no ficheiro, linha 2.)

- [ ] **Step 4: Correr o spec e confirmar que passa**

Run: `cd apps/api && npx jest orders.service --silent`
Expected: PASS — os 7 testes verdes.

- [ ] **Step 5: Confirmar que compila e que os testes de mail continuam verdes**

Run: `cd apps/api && npx tsc --noEmit && SMTP_HOST=json npx jest mail.service orders.service --silent`
Expected: sem erros de tipos; todos os testes de mail + orders verdes.

- [ ] **Step 6: Commit**

```bash
cd apps/api && git add src/modules/orders/orders.service.ts src/modules/orders/orders.service.spec.ts
git commit -m "feat(orders): avisar o cliente por email a cada mudança de estado

updateStatus dispara o email certo por transição (aceite/pronto/concluído/
cancelado), fire-and-forget: um erro no SMTP nunca parte a mudança de estado.
Sem customerEmail (encomendas manuais) não envia. MailService é @Global,
basta injetá-lo.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: E2e smoke da máquina de estados (regressão)

**Files:**
- Create: `apps/api/scripts/e2e-encomendas.mjs`
- Modify: `apps/api/package.json` (script `e2e:encomendas`)

**Porquê só smoke (e não afirmar emails):** os scripts e2e ligam-se por HTTP a uma API a correr noutro processo (`API_URL ?? http://localhost:3001/api`). Não conseguem espiar o `transporter` in-process — essa verificação é a do `orders.service.spec.ts` (Task 2). O valor deste e2e é **de regressão**: provar que percorrer os estados por HTTP continua a devolver 200 e a persistir o estado **mesmo com o disparo de email fire-and-forget no caminho**. A confirmação visual dos 4 emails a saírem é o passo manual no fim (ver Step 6).

**Interfaces (endpoints usados):**
- `POST /auth/login` → `{ accessToken }` (dono da demo: `dono@pizzaria-demo.pt` / `demo1234`).
- `GET /catalog/products` (com token) → para obter um `productId` real.
- `POST /public/stores/:slug/orders` (público) → cria a encomenda; body mínimo abaixo.
- `PATCH /orders/:id/status` (com token) `{ status }` → avança o estado.
- `GET /orders/:id` (com token) → confirma o estado persistido.

- [ ] **Step 1: Escrever o script e2e**

Cria `apps/api/scripts/e2e-encomendas.mjs`. Modela o cabeçalho no `e2e-reservas.mjs` (mesmo `BASE`, mesmo helper `req`, mesmo `check`).

```js
/**
 * E2e das ENCOMENDAS — smoke da máquina de estados (Fase A dos emails).
 *
 * Requer a stack local: DB :5433 + API em http://localhost:3001 (watch).
 * NÃO afirma emails: os scripts e2e ligam a uma API noutro processo e não
 * espiam o transporter. O disparo por transição é coberto por
 * orders.service.spec.ts. Aqui provamos que percorrer os estados por HTTP
 * continua 200 + persistente (regressão do fire-and-forget).
 *
 * A loja tem de estar ABERTA para o checkout público passar. Se a demo
 * estiver fechada à hora do teste, o create devolve 400 "loja fechada" —
 * o script avisa e sai 0 (skip), não falha.
 */
const BASE = process.env.API_URL ?? 'http://localhost:3001/api';
const SLUG = process.env.DEMO_SLUG ?? 'pizzaria-demo';
const EMAIL = process.env.DEMO_EMAIL ?? 'dono@pizzaria-demo.pt';
const PASS = process.env.DEMO_PASS ?? 'demo1234';

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* respostas sem corpo */
  }
  return { status: res.status, json };
}

async function main() {
  console.log('— login do dono da demo');
  const login = await req('POST', '/auth/login', { body: { email: EMAIL, password: PASS } });
  check('login 200', login.status === 200, `got ${login.status}`);
  const token = login.json?.accessToken;
  if (!token) {
    console.log('  sem token — abortar');
    process.exit(1);
  }

  console.log('— obter um produto real');
  const prods = await req('GET', '/catalog/products', { token });
  check('GET produtos 200', prods.status === 200, `got ${prods.status}`);
  const productId = prods.json?.[0]?.id;
  if (!productId) {
    console.log('  demo sem produtos — abortar');
    process.exit(1);
  }

  console.log('— criar encomenda pública (PICKUP, com email)');
  const create = await req('POST', `/public/stores/${SLUG}/orders`, {
    body: {
      type: 'PICKUP',
      customerName: 'Cliente E2E',
      customerPhone: '912000000',
      customerEmail: 'cliente.e2e@exemplo.pt',
      paymentMethod: 'CASH',
      items: [{ productId, quantity: 1 }],
    },
  });
  if (create.status === 400) {
    console.log(`  loja fechada/checkout recusado (${JSON.stringify(create.json)}) — SKIP, sem falha`);
    console.log(`\n${pass} passed, ${fail} failed (create em skip)`);
    process.exit(fail === 0 ? 0 : 1);
  }
  check('POST encomenda 201/200', create.status === 201 || create.status === 200, `got ${create.status}`);
  const orderId = create.json?.id;
  check('encomenda tem id', !!orderId);
  check('encomenda tem number legível', typeof create.json?.number === 'number');

  const setStatus = async (status) => {
    const r = await req('PATCH', `/orders/${orderId}/status`, { token, body: { status } });
    check(`PATCH ${status} → 200`, r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
    const g = await req('GET', `/orders/${orderId}`, { token });
    check(`estado persistido = ${status}`, g.json?.status === status, `got ${g.json?.status}`);
  };

  console.log('— percorrer ACCEPTED → PREPARING → READY → COMPLETED');
  await setStatus('ACCEPTED');
  await setStatus('PREPARING');
  await setStatus('READY');
  await setStatus('COMPLETED');

  console.log('— transição inválida é recusada (COMPLETED → ACCEPTED)');
  const bad = await req('PATCH', `/orders/${orderId}/status`, { token, body: { status: 'ACCEPTED' } });
  check('transição inválida → 400', bad.status === 400, `got ${bad.status}`);

  console.log('— um 2.º pedido para o caminho REJECTED (PENDING → REJECTED)');
  const create2 = await req('POST', `/public/stores/${SLUG}/orders`, {
    body: {
      type: 'PICKUP',
      customerName: 'Cliente E2E 2',
      customerPhone: '912000001',
      customerEmail: 'cliente.e2e2@exemplo.pt',
      paymentMethod: 'CASH',
      items: [{ productId, quantity: 1 }],
    },
  });
  if (create2.status === 201 || create2.status === 200) {
    const rej = await req('PATCH', `/orders/${create2.json.id}/status`, { token, body: { status: 'REJECTED' } });
    check('PATCH REJECTED → 200', rej.status === 200, `got ${rej.status}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Acrescentar o script npm**

Em `apps/api/package.json`, na secção `scripts`, a par dos outros e2e, acrescenta:
```json
"e2e:encomendas": "node scripts/e2e-encomendas.mjs",
```

- [ ] **Step 3: Garantir a stack local (DB + API com SMTP_HOST=json)**

Se a DB não estiver a correr: `cd apps/api && node scripts/embedded-db.mjs serve &` (espera pela porta 5433).
Arranca a API com o transporte de email de teste, redirigindo o log para um ficheiro (necessário no Step 6):
```bash
cd apps/api && pkill -9 -f "dist/main" 2>/dev/null; pnpm build && SMTP_HOST=json node dist/main > /tmp/e2e-enc-api.log 2>&1 &
```
Espera o health: `curl -s -o /dev/null -w "%{http_code}" localhost:3001/api/health` → `200`.

- [ ] **Step 4: Correr o e2e**

Run: `cd apps/api && node scripts/e2e-encomendas.mjs`
Expected: `... passed, 0 failed` (ou o SKIP explícito se a demo estiver fechada — nesse caso, ver a nota do Step 5).

- [ ] **Step 5: Se o create der 400 «loja fechada» — abrir a demo e repetir**

O checkout público exige a loja aberta (`computeOpenNow`). Se o Step 4 imprimir o SKIP, garante horário aberto na demo e repete. O `OpeningHour` tem os campos `weekday` (0..6), `openMinute`, `closeMinute` (minutos desde a meia-noite):
```bash
cd apps/api && node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const t=await p.tenant.findFirst({where:{slug:'pizzaria-demo'}});await p.openingHour.deleteMany({where:{tenantId:t.id}});await p.openingHour.createMany({data:[0,1,2,3,4,5,6].map(d=>({tenantId:t.id,weekday:d,openMinute:0,closeMinute:1439}))});console.log('demo aberta 24/7');await p.\$disconnect();})();"
```
Depois repete o Step 4. **Nota:** isto altera o horário da demo; se quiseres o horário original de volta, corre `pnpm --filter @comanda/api exec node scripts/refresh-demo.mjs` (reconstrói a demo) OU guarda/repõe os `openingHour` antes/depois.

- [ ] **Step 6: Verificação MANUAL dos emails (a prova de integração)**

Com a API a correr sob `SMTP_HOST=json` (Step 3), o `MailService.send` loga `email enviado: "<assunto>" para <to>` a cada envio. Confirma os 4 emails do percurso do Step 4:
```bash
grep "email enviado" /tmp/e2e-enc-api.log
```
Expected: 4 linhas para `cliente.e2e@exemplo.pt` (aceite, pronto, concluído) — repara que o percurso ACCEPTED→PREPARING→READY→COMPLETED gera **3** emails (PREPARING é silencioso) — e 1 para `cliente.e2e2@exemplo.pt` (cancelado). Assuntos com «aceite», «pronto», «Obrigado», «cancelado». Confirma que o de «pronto» diz «levantar» (era PICKUP): abre o log e procura o corpo, ou repete com um pedido `DELIVERY` e vê «a caminho».

- [ ] **Step 7: Commit**

```bash
cd apps/api && git add scripts/e2e-encomendas.mjs package.json
git commit -m "test(orders): e2e smoke da máquina de estados das encomendas

Percorre ACCEPTED→PREPARING→READY→COMPLETED e PENDING→REJECTED por HTTP,
confirmando 200 + persistência (regressão do disparo de email fire-and-forget).
SKIP explícito se a loja estiver fechada à hora do teste.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §1 Objetivo (avisar por email a cada mudança de estado) → Task 2 (`afterStatusChange`). ✓
- §2 Estados e emails (4 transições, texto por OrderType, `Order.number`) → Task 1 (textos, READY PICKUP/DELIVERY) + Task 2 (mapa de transições, `number`). ✓
- §3 Arquitetura (fire-and-forget, `@Global` MailService, condicional a `customerEmail`) → Task 2 (Steps 3, o `.catch`, o guard). ✓
- §4 Anti-spam (SEM `overRecipientLimit`) → Task 1 (os métodos usam `send` direto) + teste dos 8 envios. ✓
- §5 Idempotência (grafo só-avança) → verificado no plano (TRANSITIONS confirmado só-avança); documentado no comentário do `afterStatusChange`. Sem flag «já enviado» (desnecessário). ✓
- §6 Testes (unit dos 4 métodos + escape + sem teto; unit por transição; regressão com SMTP desligado; manual com log) → Task 1 spec + Task 2 spec + Task 3 e2e + Step 6 manual. ✓
- §7 Fora de âmbito (feedback = Fase B; sem emails em PREPARING/OUT_FOR_DELIVERY) → respeitado (só 4 transições). ✓

**Desvio documentado:** o spec §2 previa «`rejectionReason`/motivo se existir». O schema `Order` **não** tem esse campo e o `updateStatus(status)` não o recebe — o email de cancelado omite o motivo. Sem adicionar campo (YAGNI, fora de âmbito). Registado nos Global Constraints.

**Desvio documentado:** o spec §6 pedia «espiar o transporter» no e2e. Impossível sobre HTTP (API noutro processo) — a verificação autoritativa do disparo mudou para `orders.service.spec.ts` (Mail mockado, in-process), e o e2e ficou smoke de regressão + confirmação manual pelo log (Step 6). Mais correto, não menos.

**2. Placeholder scan:** sem TBD/TODO/«handle edge cases». Todos os steps têm código real ou comandos exatos. ✓

**3. Type consistency:** `OrderMailInfo` definido na Task 1 e consumido na Task 2 com os mesmos campos (`number`, `type`, `restaurantName`, `slug`, `storePhone`, `storeAddress`, `items[{name,quantity,lineTotal}]`, `total`). Assinaturas `sendOrderAccepted/Ready/Completed/Cancelled(to, customerName, info)` idênticas entre as duas tasks e o spec. `afterStatusChange(order, status)` usa o payload do Prisma com `items.include.modifiers` (o mesmo shape do `getForTenant`). ✓
