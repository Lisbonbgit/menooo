# Dine-in Fase 2b — Pedir na mesa + conta da mesa — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O cliente pede a partir do menu da mesa; o pedido entra como `DINE_IN` ligado à mesa e a uma conta aberta que o staff fecha; a cozinha vê "Mesa X".

**Architecture:** `OrderType.DINE_IN` + `TableSession` (uma aberta por mesa) + `Order.dineTableId/tableSessionId`. Um endpoint público de pedido na mesa (resolve por slug+token, abre/usa a sessão, isola o menu de Sala) reutiliza o cálculo de preços do `createPublicOrder` extraído para um helper. Corrige o isolamento de menu do `createPublicOrder` (delivery↔Sala). Painel: vista "mesas abertas" + fechar; Receção mostra "Mesa X".

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL (apps/api); Next.js 14 + React Query v5 (apps/dashboard, apps/storefront); Jest + e2e para a API.

## Global Constraints

- **PT-PT** em todo o texto visível e mensagens de erro.
- **Isolamento de menu (obrigatório):** um pedido `DINE_IN` só aceita produtos do menu **Sala**; delivery/levantamento só do **Delivery**. Fetch com `category: { menu: { type } }`; produto do menu errado → erro "Produto indisponível".
- **Isolamento de QR (da 2a) mantém-se:** o pedido na mesa resolve **slug+token juntos** → 404 se não bater; e exige `dineInOrderingEnabled` da loja (senão recusa; a página fica só-leitura).
- **Cliente na mesa NÃO se identifica:** o pedido dine-in fica `customerName` = o nome da mesa (ex. "Mesa 5"), `customerPhone = ''`, sem morada, `paymentMethod = CASH` (paga no balcão; Menooo não processa pagamento).
- **Uma sessão OPEN por mesa** — imposta por advisory lock por mesa (`pg_advisory_xact_lock(hashtext(dineTableId))`, padrão do `createPublic` das reservas) + índice único parcial `WHERE status='OPEN'`.
- **Fluxo de estados dine-in = levantamento:** `READY→COMPLETED` (sem `OUT_FOR_DELIVERY`); o `nextActions` já faz "else → Concluir".
- **DRY:** extrair o cálculo de linhas/preços partilhado; reutilizar `cart-store` + `ProductOptions` no storefront; NÃO duplicar.
- **Migração aditiva** (enum novo, colunas nullable, tabela nova, flag default false). `pg_dump` antes.
- Stack local: DB `:5433`, API `:3001/api`, dashboard `:3002`, storefront `:3000`. PATH: `export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"`. Deploy exige o utilizador NOMEAR `root@187.124.4.163`; NUNCA e2e contra produção. Validar por mutação.

---

## Estrutura de ficheiros

**Backend (apps/api):**
- `prisma/schema.prisma` — `OrderType.DINE_IN`; `Tenant.dineInOrderingEnabled`; `TableSession`; `Order.dineTableId/tableSessionId`; relações inversas.
- `prisma/migrations/<ts>_dine_in_orders/migration.sql` — criar à mão.
- `src/modules/orders/order-items.util.ts` — **Criar**: helper `buildOrderItems` (cálculo de linhas/preços).
- `src/modules/orders/orders.service.ts` — usar o helper + isolamento de menu no `createPublicOrder`.
- `src/modules/dine-tables/dine-tables.service.ts` — `createDineInOrder`, `listOpenSessions`, `closeSession`.
- `src/modules/dine-tables/public-dine-order.controller.ts` — **Criar**: `POST /public/stores/:slug/mesa/:qrToken/orders`.
- `src/modules/dine-tables/dine-tables.controller.ts` — `GET /table-sessions?status=open`, `PATCH /table-sessions/:id/close`.
- `src/modules/dine-tables/dto/dine-order.dto.ts` — **Criar**.
- `src/modules/tenants/*` — expor `dineInOrderingEnabled` em `/tenants/me` e no update de definições; expor no `getPublicBySlug`.
- `scripts/e2e-dine-in-orders.mjs` — **Criar**.

**Frontend:**
- `apps/storefront/src/app/[slug]/mesa/[qrToken]/MesaMenuClient.tsx` — carrinho + ProductOptions + confirmar.
- `apps/storefront/src/lib/store-hooks.ts` — `useTable` já existe; o pedido usa `api.post`.
- `apps/dashboard/src/app/settings/page.tsx` — toggle "Aceitar pedidos na mesa".
- `apps/dashboard/src/app/orders/page.tsx` — OrderCard mostra "Mesa X" no dine-in.
- `apps/dashboard/src/components/OpenTables.tsx` + `apps/dashboard/src/lib/dine-tables-hooks.ts` — vista "mesas abertas" + fechar.

---

## Task 1: Schema + isolamento de menu + helper de preços

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `orders.service.ts`
- Create: migration; `apps/api/src/modules/orders/order-items.util.ts`
- Modify: `apps/api/scripts/e2e-encomendas.mjs` (check de isolamento)

**Interfaces:**
- Produces: `OrderType.DINE_IN`; `Tenant.dineInOrderingEnabled`; `TableSession`; `Order.dineTableId?/tableSessionId?`. `buildOrderItems(products, items) → { itemsData, subtotalCents, vatLines }` (para a Task 2). `createPublicOrder` passa a exigir produtos do menu Delivery.

- [ ] **Step 1: Schema**

Em `apps/api/prisma/schema.prisma`:
- `enum OrderType { DELIVERY PICKUP DINE_IN }`.
- `Tenant`: `dineInOrderingEnabled Boolean @default(false)` + `tableSessions TableSession[]`.
- `DineTable`: `sessions TableSession[]` + `orders Order[]`.
- `Order`: `dineTableId String?` + `dineTable DineTable? @relation(fields:[dineTableId], references:[id])`; `tableSessionId String?` + `tableSession TableSession? @relation(...)`. (nullable; delivery/levantamento não têm.)
- Novo modelo:
```prisma
model TableSession {
  id          String    @id @default(cuid())
  tenantId    String
  tenant      Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  dineTableId String
  dineTable   DineTable @relation(fields: [dineTableId], references: [id], onDelete: Cascade)
  status      String    @default("OPEN")
  openedAt    DateTime  @default(now())
  closedAt    DateTime?
  orders      Order[]
  @@index([tenantId, status])
  @@index([dineTableId])
}
```

- [ ] **Step 2: Migração aditiva (à mão) + aplicar**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd apps/api
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_dine_in_orders"
cat > "prisma/migrations/${TS}_dine_in_orders/migration.sql" <<'SQL'
ALTER TYPE "OrderType" ADD VALUE 'DINE_IN';
ALTER TABLE "Tenant" ADD COLUMN "dineInOrderingEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "TableSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "dineTableId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TableSession_tenantId_status_idx" ON "TableSession"("tenantId","status");
CREATE INDEX "TableSession_dineTableId_idx" ON "TableSession"("dineTableId");
CREATE UNIQUE INDEX "TableSession_one_open_per_table" ON "TableSession"("dineTableId") WHERE "status" = 'OPEN';
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_dineTableId_fkey" FOREIGN KEY ("dineTableId") REFERENCES "DineTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD COLUMN "dineTableId" TEXT;
ALTER TABLE "Order" ADD COLUMN "tableSessionId" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_dineTableId_fkey" FOREIGN KEY ("dineTableId") REFERENCES "DineTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
SQL
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```
**Nota:** `ALTER TYPE ... ADD VALUE` não pode correr na mesma transação que o usa; como está numa migração isolada (só DDL), o `migrate deploy` aplica-a bem. Esperado: `migration applied`.

- [ ] **Step 3: Extrair o helper de preços**

Criar `apps/api/src/modules/orders/order-items.util.ts` movendo o cálculo de linhas do `createPublicOrder` (linhas 87-128 do `orders.service.ts`) para uma função pura:
```ts
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toCents, fromCents } from './money.util'; // OU inline as fns se viverem no service — manter a MESMA fonte

type ProdWithMods = Prisma.ProductGetPayload<{
  include: { modifierGroupLinks: { include: { group: { include: { modifiers: true } } } } };
}>;
export interface OrderItemInput { productId: string; quantity: number; modifierIds?: string[] }

export function buildOrderItems(products: ProdWithMods[], items: OrderItemInput[]) {
  const productMap = new Map(products.map((p) => [p.id, p]));
  let subtotalCents = 0;
  const itemsData: Prisma.OrderItemCreateWithoutOrderInput[] = [];
  const vatLines: { lineCents: number; vatRate: number }[] = [];
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) throw new BadRequestException(`Produto indisponível: ${item.productId}`);
    const validModifiers = new Map(
      product.modifierGroupLinks.flatMap((l) => l.group.modifiers).map((m) => [m.id, m]),
    );
    let unitCents = toCents(product.price);
    const chosenModifiers: Prisma.OrderItemModifierCreateWithoutOrderItemInput[] = [];
    for (const modId of item.modifierIds ?? []) {
      const mod = validModifiers.get(modId);
      if (!mod) throw new BadRequestException(`Opção inválida para "${product.name}".`);
      unitCents += toCents(mod.priceDelta);
      chosenModifiers.push({ name: mod.name, priceDelta: mod.priceDelta });
    }
    const lineCents = unitCents * item.quantity;
    subtotalCents += lineCents;
    vatLines.push({ lineCents, vatRate: product.vatRate });
    itemsData.push({
      productId: product.id, name: product.name, quantity: item.quantity,
      unitPrice: fromCents(unitCents), total: fromCents(lineCents), vatRate: product.vatRate,
      modifiers: chosenModifiers.length ? { create: chosenModifiers } : undefined,
    });
  }
  return { itemsData, subtotalCents, vatLines };
}
```
(Se `toCents`/`fromCents` forem privados do service, exportá-los de um `money.util.ts` partilhado e usar a MESMA fonte nos dois sítios — não copiar.) Em `createPublicOrder`, substituir o loop 87-128 por `const { itemsData, subtotalCents, vatLines } = buildOrderItems(products, dto.items);`.

- [ ] **Step 4: Isolamento de menu no `createPublicOrder`**

No fetch de produtos (linha 81-84), acrescentar o filtro do menu Delivery:
```ts
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds }, tenantId: tenant.id, active: true,
        category: { menu: { type: 'DELIVERY' } },
      },
      include: { modifierGroupLinks: { include: { group: { include: { modifiers: true } } } } },
    });
```
Assim um produto da Sala pedido pelo checkout de delivery cai no "Produto indisponível".

- [ ] **Step 5: e2e do isolamento (delivery não pede Sala)**

Em `apps/api/scripts/e2e-encomendas.mjs`, adicionar um check: criar (via prisma no setup do script, ou via os endpoints de catálogo) um produto no menu **Sala** da loja de teste; tentar `POST /public/stores/:slug/orders` (DELIVERY) com esse productId → **400 "Produto indisponível"**. Correr por mutação (tirar o filtro → o check fica verde a errar).

- [ ] **Step 6: Build + tsc + e2e**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/api build && pnpm --filter @comanda/api exec tsc --noEmit
pkill -9 -f "dist/main" 2>/dev/null; sleep 1; (cd apps/api && node dist/main > /tmp/2b-api.log 2>&1 &); sleep 7
curl -s -o /dev/null -w "health %{http_code}\n" localhost:3001/api/health
node apps/api/scripts/e2e-encomendas.mjs 2>&1 | tail -6
```
Esperado: build/tsc limpos; e2e verde incl. o check novo de isolamento e os antigos (o helper não mudou o comportamento).

- [ ] **Step 7: Commit**
```bash
git add apps/api/prisma apps/api/src/modules/orders apps/api/scripts/e2e-encomendas.mjs
git commit -m "feat(dine-in): schema DINE_IN + TableSession + isolamento de menu no createPublicOrder"
```

---

## Task 2: Pedido na mesa + sessão (backend)

**Files:**
- Modify: `apps/api/src/modules/dine-tables/dine-tables.service.ts`, `dine-tables.controller.ts`
- Create: `apps/api/src/modules/dine-tables/public-dine-order.controller.ts`, `dto/dine-order.dto.ts`
- Modify: `apps/api/src/modules/dine-tables/dine-tables.module.ts` (registar o controller novo, injetar o que precisar — PrismaService, OrdersGateway)
- Create: `apps/api/scripts/e2e-dine-in-orders.mjs`

**Interfaces:**
- Consumes (Task 1): `buildOrderItems`, `OrderType.DINE_IN`, `TableSession`, `Order.dineTableId/tableSessionId`, `Tenant.dineInOrderingEnabled`.
- Produces: `POST /public/stores/:slug/mesa/:qrToken/orders {items[],notes?}` → a `Order` criada (com `trackToken`); `GET /table-sessions?status=open` → sessões abertas com orders+total; `PATCH /table-sessions/:id/close`.

- [ ] **Step 1: DTO**

Criar `apps/api/src/modules/dine-tables/dto/dine-order.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { OrderItemInputDto } from '../../orders/dto/create-order.dto';

export class CreateDineOrderDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];
  @IsOptional() @IsString() @MaxLength(280) notes?: string;
}
```

- [ ] **Step 2: `createDineInOrder` no serviço**

Em `dine-tables.service.ts` (injetar `OrdersGateway` no construtor, como o `OrdersService` faz):
```ts
  async createDineInOrder(slug: string, qrToken: string, dto: CreateDineOrderDto) {
    const table = await this.prisma.dineTable.findFirst({
      where: { qrToken, active: true, tenant: { slug, status: 'ACTIVE' } },
      select: { id: true, name: true, tenantId: true, tenant: { select: { account: true, dineInOrderingEnabled: true } } },
    });
    if (!table || !isSubscriptionUsable(table.tenant.account)) throw new NotFoundException('Mesa não encontrada.');
    if (!table.tenant.dineInOrderingEnabled) throw new BadRequestException('Esta loja ainda não aceita pedidos na mesa.');

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId: table.tenantId, active: true, category: { menu: { type: 'DINE_IN' } } },
      include: { modifierGroupLinks: { include: { group: { include: { modifiers: true } } } } },
    });
    const { itemsData, subtotalCents, vatLines } = buildOrderItems(products, dto.items);
    let vatCents = 0;
    for (const l of vatLines) vatCents += Math.round((l.lineCents * l.vatRate) / (100 + l.vatRate));

    const order = await this.prisma.$transaction(async (tx) => {
      // uma sessão OPEN por mesa: serializar por mesa
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${table.id}))`;
      let session = await tx.tableSession.findFirst({ where: { dineTableId: table.id, status: 'OPEN' } });
      if (!session) session = await tx.tableSession.create({ data: { tenantId: table.tenantId, dineTableId: table.id } });
      const last = await tx.order.findFirst({ where: { tenantId: table.tenantId }, orderBy: { number: 'desc' }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;
      return tx.order.create({
        data: {
          tenantId: table.tenantId, number, type: 'DINE_IN',
          customerName: table.name, customerPhone: '',
          dineTableId: table.id, tableSessionId: session.id,
          paymentMethod: 'CASH',
          subtotal: fromCents(subtotalCents), deliveryFee: 0, discount: 0,
          total: fromCents(subtotalCents), vatTotal: fromCents(vatCents),
          notes: dto.notes, items: { create: itemsData },
        },
        include: { items: { include: { modifiers: true } } },
      });
    });
    this.gateway.emitNewOrder(table.tenantId, order);
    return order;
  }
```
(importar `buildOrderItems`, `fromCents`, `OrdersGateway`, `isSubscriptionUsable`. Registar `OrdersModule`/gateway no `DineTablesModule` conforme necessário — ver como o `OrdersModule` exporta o gateway.)

- [ ] **Step 3: `listOpenSessions` + `closeSession`**
```ts
  async listOpenSessions(tenantId: string) {
    const sessions = await this.prisma.tableSession.findMany({
      where: { tenantId, status: 'OPEN' },
      orderBy: { openedAt: 'asc' },
      include: {
        dineTable: { select: { name: true } },
        orders: { select: { id: true, number: true, status: true, total: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    return sessions.map((s) => ({
      id: s.id, table: s.dineTable.name, openedAt: s.openedAt,
      orders: s.orders.map((o) => ({ ...o, total: Number(o.total) })),
      total: s.orders.reduce((a, o) => a + Number(o.total), 0),
    }));
  }
  async closeSession(tenantId: string, id: string) {
    const r = await this.prisma.tableSession.updateMany({ where: { id, tenantId, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
    if (r.count === 0) throw new NotFoundException('Conta não encontrada ou já fechada.');
    return { ok: true };
  }
```

- [ ] **Step 4: Controllers**

Criar `public-dine-order.controller.ts`:
```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DineTablesService } from './dine-tables.service';
import { CreateDineOrderDto } from './dto/dine-order.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('public')
@Controller('public/stores')
export class PublicDineOrderController {
  constructor(private readonly tables: DineTablesService) {}
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':slug/mesa/:qrToken/orders')
  create(@Param('slug') slug: string, @Param('qrToken') qrToken: string, @Body() dto: CreateDineOrderDto) {
    return this.tables.createDineInOrder(slug, qrToken, dto);
  }
}
```
Em `dine-tables.controller.ts` (dono/staff), adicionar `GET /table-sessions` (`?status=open` → listOpenSessions) e `PATCH /table-sessions/:id/close`, com `@Roles(OWNER,STAFF)` + `@TenantId()`. Registar `PublicDineOrderController` no módulo.

- [ ] **Step 5: e2e**

Criar `apps/api/scripts/e2e-dine-in-orders.mjs` (self-contained: cria tenant/menu-Sala/mesa; ativa `dineInOrderingEnabled`; cleanup no `finally`). Cobrir:
```
- gate OFF: dineInOrderingEnabled=false → POST mesa/orders → 400
- ligar; POST mesa/orders {item Sala} → 201, type DINE_IN, customerName="Mesa X", trackToken presente, tableSessionId presente
- 2º POST na mesma mesa → MESMO tableSessionId (conta acumula)
- isolamento de menu: POST mesa/orders com um produto do DELIVERY → 400 "Produto indisponível"
- isolamento de QR: POST /public/stores/<slugB>/mesa/<tokenDeA>/orders → 404
- GET /table-sessions?status=open → 1 sessão, total = soma dos pedidos
- PATCH /table-sessions/:id/close → ok; GET open → 0
- novo POST depois de fechar → nova sessão (id diferente)
```

- [ ] **Step 6: Build + tsc + e2e**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/api build && pnpm --filter @comanda/api exec tsc --noEmit
pkill -9 -f "dist/main" 2>/dev/null; sleep 1; (cd apps/api && node dist/main > /tmp/2b-api.log 2>&1 &); sleep 7
node apps/api/scripts/e2e-dine-in-orders.mjs 2>&1 | tail -8
```
Esperado: verde, com o isolamento de menu, o de QR, e a sessão a acumular/fechar.

- [ ] **Step 7: Commit**
```bash
git add apps/api/src/modules/dine-tables apps/api/scripts/e2e-dine-in-orders.mjs
git commit -m "feat(dine-in): pedido na mesa + conta da mesa (TableSession abre/acumula/fecha)"
```

---

## Task 3: Storefront — carrinho + confirmar no menu da mesa

**Files:**
- Modify: `apps/storefront/src/app/[slug]/mesa/[qrToken]/MesaMenuClient.tsx`
- Modify (se preciso): `apps/storefront/src/lib/store-hooks.ts` (expor `dineInOrderingEnabled` do store), `apps/api` `getPublicBySlug` (incluir a flag) — coordenar com o backend.

**Interfaces:**
- Consumes (Task 2): `POST /public/stores/:slug/mesa/:qrToken/orders {items,notes?}` → order com `trackToken`. Precisa de saber se `dineInOrderingEnabled` (do `useStore(slug)` — adicionar a flag à projeção pública `getPublicBySlug` se ainda não estiver).

- [ ] **Step 1: Expor `dineInOrderingEnabled` no store público**

Confirmar/adicionar `dineInOrderingEnabled` à projeção de `GET /public/stores/:slug` (`getPublicBySlug` no catalog/tenants service) e ao tipo `Store` do storefront (`apps/storefront/src/lib/types.ts`).

- [ ] **Step 2: Carrinho + confirmar no `MesaMenuClient`**

No `MesaMenuClient.tsx`, quando `store.data?.dineInOrderingEnabled`:
- Reutilizar o padrão do `StoreClient.tsx`: `useCartStore`, `quickAdd` (produto sem grupos → addItem; com grupos → abrir `ProductOptions`), `<ProductOptions>` e uma barra de carrinho (reutilizar `CartBar` OU uma barra própria com "Confirmar pedido").
- "Confirmar pedido" → `await api.post(\`/public/stores/${slug}/mesa/${qrToken}/orders\`, { items: items.map(i=>({productId:i.productId, quantity:i.quantity, modifierIds:i.modifiers.map(m=>m.id)})), notes })` → `clear()` do carrinho → `router.push(\`/${slug}/pedido/${data.trackToken}\`)` (a página de acompanhamento).
- Com a flag **desligada**, manter o comportamento da 2a (só leitura).
- NÃO tocar no `StoreClient` (loja de delivery).

- [ ] **Step 3: Typecheck + build**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/storefront exec tsc --noEmit && pnpm --filter @comanda/storefront build
```
Esperado: sem erros. (Dev: se der "Cannot find module vendor-chunks/…", `rm -rf apps/storefront/.next`.)

- [ ] **Step 4: Commit**
```bash
git add apps/storefront/src apps/api/src
git commit -m "feat(storefront): pedir na mesa (carrinho + confirmar) na rota da mesa"
```

---

## Task 4: Painel — mesas abertas + Receção "Mesa X" + toggle

**Files:**
- Create: `apps/dashboard/src/components/OpenTables.tsx`
- Modify: `apps/dashboard/src/lib/dine-tables-hooks.ts` (hooks das sessões), `apps/dashboard/src/app/orders/page.tsx` (OrderCard "Mesa X" + a vista), `apps/dashboard/src/app/settings/page.tsx` (toggle), `apps/dashboard/src/lib/orders-hooks.ts`/types (Order += dineTable, type DINE_IN)

**Interfaces:**
- Consumes (Task 2): `GET /table-sessions?status=open`, `PATCH /table-sessions/:id/close`. A `Order` da lista traz `dineTable {name}` (adicionar ao include do `listForTenant`).

- [ ] **Step 1: Order traz o nome da mesa**

Em `apps/api/.../orders.service.ts` `listForTenant`/`getForTenant`, adicionar ao `include`: `dineTable: { select: { name: true } }`. No tipo `Order` do dashboard (`apps/dashboard/src/lib/types.ts`), `type` inclui `'DINE_IN'` e `dineTable?: { name: string } | null`.

- [ ] **Step 2: Receção mostra "Mesa X"**

Em `apps/dashboard/src/app/orders/page.tsx`, no cabeçalho do `OrderCard` (onde mostra `order.type === 'DELIVERY' ? 'Entrega' : 'Take-away'`), tratar `DINE_IN`: ícone de mesa (ex. `Utensils` de lucide) + `Mesa {order.dineTable?.name}`. O `nextActions` já faz "else → Concluir" (dine-in = como levantamento) — confirmar que `READY` no dine-in dá "Concluir" (não "Enviar"): a condição é `order.type === 'DELIVERY' ? Enviar : Concluir`, logo DINE_IN já cai no Concluir. ✓

- [ ] **Step 3: Hooks + vista "Mesas abertas"**

Em `dine-tables-hooks.ts`: `useOpenSessions()` (`GET /table-sessions?status=open`, queryKey `['open-sessions']`, refetch no evento de pedido — ou `refetchInterval`) e `useCloseSession()` (`PATCH /table-sessions/:id/close`, invalida `['open-sessions']`).
Criar `OpenTables.tsx`: lista as sessões abertas (mesa, tempo aberto, pedidos com nº/estado, **total**), botão **"Fechar mesa"** (com confirmação). Montá-la na Receção (uma secção/aba "Mesas abertas") ou numa aba própria — seguir o padrão da página de orders.

- [ ] **Step 4: Toggle "Aceitar pedidos na mesa"**

Em `apps/dashboard/src/app/settings/page.tsx`, acrescentar um `Toggle` "Aceitar pedidos na mesa" ligado a `form.dineInOrderingEnabled` (espelhar `acceptsDelivery`), e incluir o campo no load (`/tenants/me`) e no submit (update de definições). Confirmar que o backend (`tenants` update DTO + service) aceita `dineInOrderingEnabled`.

- [ ] **Step 5: Typecheck + build**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/dashboard exec tsc --noEmit && pnpm --filter @comanda/dashboard build
pnpm --filter @comanda/api build && pnpm --filter @comanda/api exec tsc --noEmit
```
Esperado: sem erros.

- [ ] **Step 6: Commit**
```bash
git add apps/dashboard/src apps/api/src
git commit -m "feat(dashboard): mesas abertas + fechar + Receção mostra Mesa X + toggle pedidos na mesa"
```

---

## Task 5: Verificação integrada (browser)

- [ ] **Step 1: Fluxo completo**

Stack a correr; demo com menu de **Sala** com produtos (semear se vazio) e `dineInOrderingEnabled` ligado (via toggle nas Definições). Criar uma mesa (2a) e abrir o URL da mesa:
- Ligar "Aceitar pedidos na mesa" nas Definições → a página da mesa passa a ter carrinho (com desligado, fica só-leitura).
- Adicionar produtos, "Confirmar pedido" → cai na página de acompanhamento; o pedido aparece na **Receção marcado "Mesa X"**; avançar até Concluir (sem "A caminho").
- Pedir 2ª vez na mesma mesa → junta-se à conta; na vista **"Mesas abertas"** aparece a mesa com os 2 pedidos + total; **"Fechar mesa"** → sai das abertas.
- **Isolamento:** com o slug de outro restaurante no URL da mesa → "Mesa não encontrada"; pedir um produto de Delivery pela mesa (forjar) → recusa.

Limpar os dados de teste no fim.

- [ ] **Step 2: Handoff** — revisão adversarial final e depois merge+deploy (o utilizador NOMEIA o host; `pg_dump` antes; migração aditiva).

---

## Self-review (cobertura do spec)

- **§3 Modelo (DINE_IN, TableSession, Order links, flag)** → Task 1 Steps 1-2. ✓
- **§4 Isolamento de menu** → Task 1 Step 4 (delivery) + Task 2 Step 2 (dine-in Sala); testes Task 1 Step 5 + Task 2 Step 5. ✓
- **§5 Fluxo do cliente (carrinho, confirmar, tracking)** → Task 3. ✓
- **§6 Sessão (abrir/acumular/fechar, advisory lock, uma aberta por mesa)** → Task 2 Steps 2-3 + migração (índice parcial). ✓
- **§7 Painel (mesas abertas + fechar; Receção Mesa X; fluxo levantamento)** → Task 4. ✓
- **§8 Testes (isolamento menu+QR, sessão, fechar, gate, dine-in order)** → Task 1 Step 5, Task 2 Step 5, Task 5. ✓

**Consistência de tipos:** `buildOrderItems(products, items)→{itemsData,subtotalCents,vatLines}` (Task 1 ↔ Task 2); `TableSession.status 'OPEN'|'CLOSED'`; `Order.dineTableId/tableSessionId` + `dineTable{name}`; `CreateDineOrderDto{items,notes}`; endpoints `POST :slug/mesa/:qrToken/orders`, `GET /table-sessions?status=open`, `PATCH /table-sessions/:id/close`; `dineInOrderingEnabled` (schema ↔ /tenants/me ↔ getPublicBySlug ↔ storefront ↔ settings toggle).
