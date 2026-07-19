# Dine-in Fase 1 — Catálogo de Sala (menus separados) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada loja passa a ter dois catálogos totalmente separados — "Delivery" (o atual) e "Sala" (novo, vazio) — geríveis no painel, sem mudar nada para o cliente de delivery.

**Architecture:** Nova entidade `Menu` (tipo `DELIVERY` | `DINE_IN`) por loja; `Category` e `ModifierGroup` ganham `menuId`; o `Product` herda o menu da sua categoria. Uma migração aditiva põe todo o catálogo atual no menu Delivery e cria o menu Sala vazio. Os endpoints de catálogo passam a receber o **tipo** de menu (`?menu=`/`?type=`, omissão = Delivery); o serviço resolve o `menuId` a partir de `(tenantId, type)`. O painel ganha um seletor Delivery/Sala que fica com toda a gestão existente.

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL (apps/api); Next.js 14 + React Query + zustand (apps/dashboard); testes e2e por script Node (apps/api/scripts).

## Global Constraints

- **PT-PT** em todo o texto visível e mensagens de erro.
- **Migração aditiva e preserva dados**: nada de apagar; backfill com **ids determinísticos** (`'mnu_dlv_'||tenantId`, `'mnu_din_'||tenantId`) e `ON CONFLICT DO NOTHING` (re-executável). `@default(cuid())` **não** cria default na BD — todo o INSERT em SQL sintetiza o id à mão.
- **Não regride o storefront de delivery**: `GET /public/stores/:slug/menu` **sem `type`** devolve exatamente o menu Delivery de hoje.
- **O cliente nunca envia um `menuId` cru** — envia o **tipo** (`delivery`|`dine_in`); o serviço resolve o `menuId` por `(tenantId, type)`. Tudo continua scoped por `tenantId`.
- **`Product` não tem `menuId`** — o menu do produto é o da sua categoria.
- **Deploy** exige o utilizador NOMEAR o host `root@187.124.4.163`; `pg_dump` antes; NUNCA correr e2e contra produção.
- **Validar por mutação**: um teste verde não vale até se o ver vermelho pela razão certa.
- Stack local: DB `:5433`, API `http://localhost:3001/api`. `node` e `pnpm` em `~/.local/node/bin` e `~/Library/pnpm` (exportar PATH).

---

## Estrutura de ficheiros

**Backend (apps/api):**
- `prisma/schema.prisma` — Modelo `Menu` + enum `MenuType`; `menuId` em `Category` e `ModifierGroup`; `menus Menu[]` em `Tenant`.
- `prisma/migrations/<ts>_dine_in_menus/migration.sql` — Criar (à mão) com o backfill.
- `src/modules/catalog/menu-type.util.ts` — **Criar**: `parseMenuType(raw?)`.
- `src/modules/catalog/catalog.service.ts` — `resolveMenuId`; scoping por menu em list/create/reorder de categorias/produtos/grupos; guardas cross-menu; `getPublicMenu` com tipo.
- `src/modules/catalog/catalog.controller.ts` — `@Query('menu')` nas rotas de leitura/criação/reorder.
- `src/modules/catalog/public-catalog.controller.ts` — `@Query('type')` no menu público.
- `prisma/seed.ts` e `scripts/refresh-demo.mjs` — criar/usar o menu Delivery.
- `scripts/e2e-catalogo.mjs` — verificações novas de scoping/guardas.

**Frontend (apps/dashboard):**
- `src/lib/types.ts` — `export type MenuType = 'delivery' | 'dine_in'`.
- `src/lib/catalog-hooks.ts` — todos os hooks passam a receber `menu` (default `'delivery'`).
- `src/app/menu/page.tsx` — estado `menuAtivo` + seletor Delivery/Sala; threading.
- `src/app/menu/PersonalizacoesTab.tsx` — recebe `menu` por prop.

---

## Task 1: Backend — modelo `Menu`, migração e catálogo por menu

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_dine_in_menus/migration.sql`
- Create: `apps/api/src/modules/catalog/menu-type.util.ts`
- Modify: `apps/api/src/modules/catalog/catalog.service.ts`
- Modify: `apps/api/src/modules/catalog/catalog.controller.ts`
- Modify: `apps/api/src/modules/catalog/public-catalog.controller.ts`
- Modify: `apps/api/prisma/seed.ts`, `apps/api/scripts/refresh-demo.mjs`
- Test: `apps/api/scripts/e2e-catalogo.mjs`

**Interfaces:**
- Produces (para a Task 2 / frontend):
  - `GET /catalog/categories?menu=delivery|dine_in` → categorias do menu.
  - `POST /catalog/categories?menu=…` (corpo `{name, sortOrder?}`) → cria no menu.
  - `PUT /catalog/categories/reorder?menu=…` (corpo `{ids}`).
  - `GET /catalog/products?menu=…&categoryId=…`; `POST /catalog/products` (menu derivado da `categoryId`).
  - `GET /catalog/modifier-groups?menu=…`; `POST /catalog/modifier-groups?menu=…`.
  - `GET /public/stores/:slug/menu?type=delivery|dine_in` (sem `type` = delivery).
  - Sem `menu`/`type` → **delivery** em todos.

- [ ] **Step 1: Editar o schema — enum, modelo `Menu`, `menuId` nos filhos**

Em `apps/api/prisma/schema.prisma`, adicionar o enum e o modelo (junto aos outros de catálogo):

```prisma
enum MenuType {
  DELIVERY // menu da loja online (entrega + levantamento) — o atual
  DINE_IN  // menu servido ao cliente à mesa (via QR, Fase 2)
}

model Menu {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  type      MenuType
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  categories     Category[]
  modifierGroups ModifierGroup[]

  @@unique([tenantId, type])
  @@index([tenantId])
}
```

No modelo `Category`, adicionar (a seguir a `tenant`):
```prisma
  menuId    String
  menu      Menu    @relation(fields: [menuId], references: [id], onDelete: Cascade)
```
e o índice `@@index([menuId])` junto ao `@@index([tenantId])`.

No modelo `ModifierGroup`, adicionar (a seguir a `tenant`):
```prisma
  menuId    String
  menu      Menu    @relation(fields: [menuId], references: [id], onDelete: Cascade)
```
e `@@index([menuId])`.

No modelo `Tenant`, adicionar à lista de relações: `menus Menu[]`.

- [ ] **Step 2: Gerar a migração em modo --create-only e escrever o SQL de backfill à mão**

```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd apps/api
pnpm exec prisma migrate dev --create-only --name dine_in_menus
```

Substituir **todo** o conteúdo de `prisma/migrations/<ts>_dine_in_menus/migration.sql` por:

```sql
-- CreateEnum
CREATE TYPE "MenuType" AS ENUM ('DELIVERY', 'DINE_IN');

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "MenuType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Menu_tenantId_idx" ON "Menu"("tenantId");
CREATE UNIQUE INDEX "Menu_tenantId_type_key" ON "Menu"("tenantId", "type");

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: um menu de cada tipo por tenant (ids determinísticos → re-executável)
INSERT INTO "Menu" ("id", "tenantId", "type", "createdAt", "updatedAt")
SELECT 'mnu_dlv_' || t."id", t."id", 'DELIVERY', now(), now() FROM "Tenant" t
ON CONFLICT ("tenantId", "type") DO NOTHING;
INSERT INTO "Menu" ("id", "tenantId", "type", "createdAt", "updatedAt")
SELECT 'mnu_din_' || t."id", t."id", 'DINE_IN', now(), now() FROM "Tenant" t
ON CONFLICT ("tenantId", "type") DO NOTHING;

-- Category.menuId: nullable → backfill (menu Delivery da loja) → NOT NULL + FK + índice
ALTER TABLE "Category" ADD COLUMN "menuId" TEXT;
UPDATE "Category" SET "menuId" = 'mnu_dlv_' || "tenantId";
ALTER TABLE "Category" ALTER COLUMN "menuId" SET NOT NULL;
CREATE INDEX "Category_menuId_idx" ON "Category"("menuId");
ALTER TABLE "Category" ADD CONSTRAINT "Category_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ModifierGroup.menuId: idem
ALTER TABLE "ModifierGroup" ADD COLUMN "menuId" TEXT;
UPDATE "ModifierGroup" SET "menuId" = 'mnu_dlv_' || "tenantId";
ALTER TABLE "ModifierGroup" ALTER COLUMN "menuId" SET NOT NULL;
CREATE INDEX "ModifierGroup_menuId_idx" ON "ModifierGroup"("menuId");
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Aplicar a migração e regenerar o cliente**

```bash
cd apps/api
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```
Esperado: `migration applied` sem drift; `generate` recria os tipos com `Menu`/`MenuType`.

- [ ] **Step 4: Verificar que a migração preservou os dados (mutação)**

```bash
cd apps/api
node -e "
const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient();
(async()=>{
  const semMenu = await p.category.count({ where: { menuId: undefined } }).catch(()=>'(coluna criada)');
  const orfas = await p.\$queryRawUnsafe('SELECT count(*)::int AS n FROM \"Category\" WHERE \"menuId\" IS NULL');
  const dlv = await p.menu.count({ where: { type: 'DELIVERY' } });
  const din = await p.menu.count({ where: { type: 'DINE_IN' } });
  const tenants = await p.tenant.count();
  const catsDelivery = await p.category.count({ where: { menu: { type: 'DELIVERY' } } });
  const catsTotal = await p.category.count();
  console.log('categorias órfãs (menuId NULL):', orfas[0].n, '(esperado 0)');
  console.log('menus DELIVERY:', dlv, '| DINE_IN:', din, '| tenants:', tenants, '(dlv==din==tenants)');
  console.log('categorias no Delivery:', catsDelivery, '/ total', catsTotal, '(iguais → nada na Sala)');
  await p.\$disconnect();
})();"
```
Esperado: `órfãs = 0`; `dlv == din == tenants`; `catsDelivery == catsTotal`.

- [ ] **Step 5: Criar `menu-type.util.ts`**

`apps/api/src/modules/catalog/menu-type.util.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import { MenuType } from '@prisma/client';

/** Converte o parâmetro público (`delivery`|`dine_in`) para o enum; omisso = DELIVERY. */
export function parseMenuType(raw?: string): MenuType {
  if (!raw || raw === 'delivery') return MenuType.DELIVERY;
  if (raw === 'dine_in') return MenuType.DINE_IN;
  throw new BadRequestException('Menu inválido (usa "delivery" ou "dine_in").');
}
```

- [ ] **Step 6: `catalog.service.ts` — `resolveMenuId` + scoping + guardas**

Adicionar o import do `MenuType`:
```ts
import { MenuType, Prisma } from '@prisma/client';
```

Adicionar o helper privado (junto às verificações de propriedade):
```ts
  /** Resolve (e cria se faltar) o menu da loja para um tipo. Idempotente pelo unique (tenantId,type). */
  private async resolveMenuId(tenantId: string, type: MenuType): Promise<string> {
    const menu = await this.prisma.menu.upsert({
      where: { tenantId_type: { tenantId, type } },
      create: { tenantId, type },
      update: {},
    });
    return menu.id;
  }
```

Substituir os métodos abaixo (mantendo os restantes iguais):

```ts
  async listCategories(tenantId: string, menuType: MenuType) {
    const menuId = await this.resolveMenuId(tenantId, menuType);
    return this.prisma.category.findMany({
      where: { tenantId, menuId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(tenantId: string, menuType: MenuType, dto: CreateCategoryDto) {
    const menuId = await this.resolveMenuId(tenantId, menuType);
    return this.prisma.category.create({
      data: { tenantId, menuId, name: dto.name, sortOrder: dto.sortOrder ?? 0 },
    });
  }

  async reorderCategories(tenantId: string, menuType: MenuType, ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('IDs repetidos.');
    const menuId = await this.resolveMenuId(tenantId, menuType);
    return this.prisma.$transaction(async (tx) => {
      const total = await tx.category.count({ where: { tenantId, menuId } });
      const owned = await tx.category.count({ where: { id: { in: ids }, tenantId, menuId } });
      if (owned !== ids.length || owned !== total) {
        throw new BadRequestException('A lista tem de conter todas as categorias do menu, sem repetidos.');
      }
      for (const [i, id] of ids.entries()) {
        await tx.category.updateMany({ where: { id, tenantId, menuId }, data: { sortOrder: i } });
      }
      return { reordered: ids.length };
    });
  }

  listProducts(tenantId: string, menuType: MenuType, categoryId?: string) {
    return this.prisma.product.findMany({
      where: {
        tenantId,
        category: { menu: { tenantId, type: menuType } },
        ...(categoryId ? { categoryId } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async listModifierGroups(tenantId: string, menuType: MenuType) {
    const menuId = await this.resolveMenuId(tenantId, menuType);
    const groups = await this.prisma.modifierGroup.findMany({
      where: { tenantId, menuId },
      orderBy: { name: 'asc' },
      include: {
        modifiers: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { productLinks: true } },
      },
    });
    return groups.map(({ _count, ...g }) => ({ ...g, usedIn: _count.productLinks }));
  }

  async createModifierGroup(tenantId: string, menuType: MenuType, dto: CreateModifierGroupDto) {
    const minSelect = dto.minSelect ?? 0;
    const maxSelect = dto.maxSelect ?? 1;
    this.assertGroupLimits(minSelect, maxSelect);
    const menuId = await this.resolveMenuId(tenantId, menuType);
    return this.prisma.modifierGroup.create({
      data: { tenantId, menuId, name: dto.name, required: dto.required ?? false, minSelect, maxSelect },
    });
  }
```

Substituir `updateProduct` (guarda cross-menu ao mudar de categoria):
```ts
  async updateProduct(tenantId: string, id: string, dto: UpdateProductDto) {
    const current = await this.ensureProduct(tenantId, id);
    const data: Prisma.ProductUncheckedUpdateInput = { ...dto };
    if (dto.categoryId && dto.categoryId !== current.categoryId) {
      const [newCat, curCat] = await Promise.all([
        this.ensureCategory(tenantId, dto.categoryId),
        this.prisma.category.findUnique({ where: { id: current.categoryId } }),
      ]);
      if (newCat.menuId !== curCat?.menuId) {
        throw new BadRequestException('Não podes mover um produto para uma categoria de outro menu.');
      }
      const last = await this.prisma.product.aggregate({
        where: { tenantId, categoryId: dto.categoryId },
        _max: { sortOrder: true },
      });
      data.sortOrder = (last._max.sortOrder ?? -1) + 1;
    } else if (dto.categoryId) {
      await this.ensureCategory(tenantId, dto.categoryId);
    }
    return this.prisma.product.update({ where: { id }, data });
  }
```

Substituir `attachModifierGroup` (guarda cross-menu: grupo e produto no mesmo menu):
```ts
  async attachModifierGroup(tenantId: string, productId: string, groupId: string) {
    await this.ensureProduct(tenantId, productId);
    const group = await this.ensureModifierGroup(tenantId, groupId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { category: true },
    });
    if (product!.category.menuId !== group.menuId) {
      throw new BadRequestException('Esse grupo de opções é de outro menu.');
    }
    const last = await this.prisma.productModifierGroup.aggregate({
      where: { productId },
      _max: { sortOrder: true },
    });
    try {
      return await this.prisma.productModifierGroup.create({
        data: { productId, groupId, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('Este grupo já está anexado ao produto.');
      }
      throw e;
    }
  }
```

Substituir `getPublicMenu` (tipo, leitura sem escrita):
```ts
  async getPublicMenu(slug: string, menuType: MenuType) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { account: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE' || !isSubscriptionUsable(tenant.account)) {
      throw new NotFoundException('Loja não encontrada.');
    }
    const menu = await this.prisma.menu.findUnique({
      where: { tenantId_type: { tenantId: tenant.id, type: menuType } },
    });
    if (!menu) return []; // loja nova sem este menu ainda → vazio
    const categories = await this.prisma.category.findMany({
      where: { tenantId: tenant.id, menuId: menu.id, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        products: {
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: CatalogService.GROUP_LINKS_INCLUDE,
        },
      },
    });
    return categories.map((cat) => ({
      ...cat,
      products: cat.products.map((p) => CatalogService.flattenGroups(p)),
    }));
  }
```

(Nota: `createProduct`, `reorderProducts`, `getProduct`, `deleteProduct`, `updateCategory`,
`deleteCategory`, `updateModifierGroup`, `deleteModifierGroup`, `detachModifierGroup`,
`createModifier`, `updateModifier`, `deleteModifier` **não mudam** — o menu deriva da
categoria/produto/grupo pelo `:id`.)

- [ ] **Step 7: `catalog.controller.ts` — passar o `menu` (omissão = delivery)**

Adicionar o import: `import { parseMenuType } from './menu-type.util';`

Alterar as assinaturas/corpos destas rotas (as outras ficam iguais):
```ts
  @Get('categories')
  listCategories(@TenantId() tenantId: string, @Query('menu') menu?: string) {
    return this.catalog.listCategories(tenantId, parseMenuType(menu));
  }

  @Post('categories')
  createCategory(
    @TenantId() tenantId: string,
    @Body() dto: CreateCategoryDto,
    @Query('menu') menu?: string,
  ) {
    return this.catalog.createCategory(tenantId, parseMenuType(menu), dto);
  }

  @Put('categories/reorder')
  reorderCategories(
    @TenantId() tenantId: string,
    @Body() dto: ReorderCategoriesDto,
    @Query('menu') menu?: string,
  ) {
    return this.catalog.reorderCategories(tenantId, parseMenuType(menu), dto.ids);
  }

  @Get('products')
  listProducts(
    @TenantId() tenantId: string,
    @Query('categoryId') categoryId?: string,
    @Query('menu') menu?: string,
  ) {
    return this.catalog.listProducts(tenantId, parseMenuType(menu), categoryId);
  }

  @Get('modifier-groups')
  listModifierGroups(@TenantId() tenantId: string, @Query('menu') menu?: string) {
    return this.catalog.listModifierGroups(tenantId, parseMenuType(menu));
  }

  @Post('modifier-groups')
  createModifierGroup(
    @TenantId() tenantId: string,
    @Body() dto: CreateModifierGroupDto,
    @Query('menu') menu?: string,
  ) {
    return this.catalog.createModifierGroup(tenantId, parseMenuType(menu), dto);
  }
```

- [ ] **Step 8: `public-catalog.controller.ts` — tipo no menu público**

```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';
import { parseMenuType } from './menu-type.util';

@ApiTags('public')
@Controller('public/stores')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Menu completo da loja. Sem `type` → Delivery (retrocompatível com o storefront). */
  @Public()
  @Get(':slug/menu')
  getMenu(@Param('slug') slug: string, @Query('type') type?: string) {
    return this.catalog.getPublicMenu(slug, parseMenuType(type));
  }
}
```

- [ ] **Step 9: Atualizar `seed.ts` e `refresh-demo.mjs` (menu Delivery)**

Em `apps/api/prisma/seed.ts`, antes de criar categorias, garantir o menu Delivery da loja e usá-lo:
```ts
  // menu Delivery da loja (Fase 1 dine-in: categorias/produtos pertencem a um menu)
  const menuDelivery = await prisma.menu.upsert({
    where: { tenantId_type: { tenantId: tenant.id, type: 'DELIVERY' } },
    create: { tenantId: tenant.id, type: 'DELIVERY' },
    update: {},
  });
  await prisma.menu.upsert({
    where: { tenantId_type: { tenantId: tenant.id, type: 'DINE_IN' } },
    create: { tenantId: tenant.id, type: 'DINE_IN' },
    update: {},
  });
```
e acrescentar `menuId: menuDelivery.id` ao `data` de **cada** `prisma.category.create(...)`.
Fazer o mesmo padrão em `apps/api/scripts/refresh-demo.mjs` (garantir o menu Delivery e pôr
`menuId` em cada categoria criada; usar `type: 'DELIVERY'` como string).

- [ ] **Step 10: Compilar a API e o typecheck**

```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/api build
pnpm --filter @comanda/api exec tsc --noEmit
```
Esperado: ambos sem erros.

- [ ] **Step 11: Escrever as verificações e2e de scoping (TDD) e vê-las FALHAR antes do fim**

Antes de correr, arrancar a stack local limpa:
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda/apps/api
pkill -9 -f "dist/main" 2>/dev/null; sleep 1
(node --enable-source-maps dist/main > /tmp/dinein-api.log 2>&1 &); sleep 7
curl -s -o /dev/null -w "health %{http_code}\n" localhost:3001/api/health
```

No `apps/api/scripts/e2e-catalogo.mjs`, dentro do `try` do `main()` (depois do login e antes do
`finally`), acrescentar um bloco novo. Guardar ids criados em `created` para o cleanup:
```js
    // =========================================================================
    // N. Menus separados (Fase 1 dine-in): isolamento Delivery vs Sala
    // =========================================================================
    console.log('— N. menus separados');
    const catSala = await req('POST', `/catalog/categories?menu=dine_in`, {
      token, body: { name: `Sala ${RUN}` },
    });
    check('criar categoria na Sala → 201', catSala.status === 201, `got ${catSala.status}`);
    created.catSala = catSala.json?.id;

    const listaDelivery = await req('GET', `/catalog/categories?menu=delivery`, { token });
    check(
      'categoria da Sala NÃO aparece no Delivery',
      Array.isArray(listaDelivery.json) && !listaDelivery.json.some((c) => c.id === created.catSala),
    );
    const listaSala = await req('GET', `/catalog/categories?menu=dine_in`, { token });
    check(
      'categoria da Sala aparece na Sala',
      Array.isArray(listaSala.json) && listaSala.json.some((c) => c.id === created.catSala),
    );

    // produto na Sala não aparece na lista de produtos do Delivery
    const prodSala = await req('POST', `/catalog/products`, {
      token, body: { categoryId: created.catSala, name: `PSala ${RUN}`, price: 5 },
    });
    check('criar produto na Sala → 201', prodSala.status === 201, `got ${prodSala.status}`);
    created.prodSala = prodSala.json?.id;
    const prodsDelivery = await req('GET', `/catalog/products?menu=delivery`, { token });
    check(
      'produto da Sala NÃO aparece nos produtos do Delivery',
      Array.isArray(prodsDelivery.json) && !prodsDelivery.json.some((p) => p.id === created.prodSala),
    );

    // guarda: grupo da Sala não anexa a produto do Delivery
    const grpSala = await req('POST', `/catalog/modifier-groups?menu=dine_in`, {
      token, body: { name: `GSala ${RUN}`, required: false, maxSelect: 1 },
    });
    created.grpSala = grpSala.json?.id;
    // `created.catA`/produto do Delivery são criados mais acima no script; usar um produto do Delivery.
    const algumProdDelivery = (prodsDelivery.json ?? [])[0]?.id;
    if (algumProdDelivery) {
      const attach = await req(
        'POST', `/catalog/products/${algumProdDelivery}/modifier-groups/${created.grpSala}`, { token },
      );
      check('anexar grupo da Sala a produto do Delivery → 400', attach.status === 400, `got ${attach.status}`);
    }

    // público: sem type = Delivery; type=dine_in mostra a Sala
    const pubDelivery = await req('GET', `/public/stores/pizzaria-demo/menu`, {});
    check('menu público sem type = Delivery (200)', pubDelivery.status === 200, `got ${pubDelivery.status}`);
    check(
      'menu público (delivery) NÃO tem a categoria da Sala',
      Array.isArray(pubDelivery.json) && !pubDelivery.json.some((c) => c.id === created.catSala),
    );
```

No `finally`, apagar o criado (a Sala não tem histórico, apaga limpo):
```js
    if (created.prodSala) await prisma.product.delete({ where: { id: created.prodSala } }).catch(() => {});
    if (created.grpSala) await prisma.modifierGroup.delete({ where: { id: created.grpSala } }).catch(() => {});
    if (created.catSala) await prisma.category.delete({ where: { id: created.catSala } }).catch(() => {});
```
(e declarar `catSala/prodSala/grpSala: null` no objeto `created` no topo de `main`.)

Correr **antes** de o backend estar activado seria impossível (o schema é pré-requisito); a
prova por mutação faz-se assim: com o `parseMenuType` a devolver **sempre** DELIVERY
temporariamente (editar o util para `return MenuType.DELIVERY`), correr e ver **FALHAR** o
check "categoria da Sala aparece na Sala" (porque tudo cai no Delivery). Depois repor o
`parseMenuType` correto.

```bash
node scripts/e2e-catalogo.mjs 2>&1 | tail -8
```
Esperado (com o util correto): todos os checks novos ✓, e os antigos continuam ✓.

- [ ] **Step 12: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/modules/catalog apps/api/prisma/seed.ts apps/api/scripts/refresh-demo.mjs apps/api/scripts/e2e-catalogo.mjs
git commit -m "feat(catalog): menus separados (Delivery/Sala) — modelo, migração e API por menu"
```

---

## Task 2: Frontend — seletor de menu e hooks por menu

**Files:**
- Modify: `apps/dashboard/src/lib/types.ts`
- Modify: `apps/dashboard/src/lib/catalog-hooks.ts`
- Modify: `apps/dashboard/src/app/menu/page.tsx`
- Modify: `apps/dashboard/src/app/menu/PersonalizacoesTab.tsx`

**Interfaces:**
- Consumes (da Task 1): os endpoints `?menu=`/`?type=`.
- Produces: hooks `useCategories(menu)`, `useProducts(menu)`, `useModifierGroups(menu)`, e todas as
  mutações com `menu: MenuType = 'delivery'`; o tipo `MenuType`.

- [ ] **Step 1: Tipo `MenuType`**

Em `apps/dashboard/src/lib/types.ts`, acrescentar:
```ts
export type MenuType = 'delivery' | 'dine_in';
```

- [ ] **Step 2: `catalog-hooks.ts` — todos os hooks recebem `menu` (default 'delivery')**

Substituir o ficheiro por esta versão (o `menu` entra na `queryKey`, no pedido e nas
invalidações; o default `'delivery'` mantém consumidores atuais — ex.: OnboardingChecklist — a
apontar ao Delivery):
```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';
import type { Category, MenuType, ModifierGroupWithUsage, Product } from './types';

// ----- Categorias -----
export function useCategories(menu: MenuType = 'delivery') {
  return useQuery({
    queryKey: ['categories', menu],
    queryFn: async () => (await api.get<Category[]>('/catalog/categories', { params: { menu } })).data,
  });
}

export function useCreateCategory(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      (await api.post<Category>('/catalog/categories', { name }, { params: { menu } })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories', menu] }),
  });
}

export function useUpdateCategory(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      (await api.patch<Category>(`/catalog/categories/${id}`, { name })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories', menu] }),
  });
}

export function useDeleteCategory(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/catalog/categories/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories', menu] });
      qc.invalidateQueries({ queryKey: ['products', menu] });
    },
  });
}

// ----- Produtos -----
export function useProducts(menu: MenuType = 'delivery') {
  return useQuery({
    queryKey: ['products', menu],
    queryFn: async () => (await api.get<Product[]>('/catalog/products', { params: { menu } })).data,
  });
}

export interface CreateProductInput {
  categoryId: string;
  name: string;
  price: number;
  description?: string;
  vatRate?: number;
}

export function useCreateProduct(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProductInput) =>
      (await api.post<Product>('/catalog/products', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', menu] }),
  });
}

export function useToggleProduct(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await api.patch<Product>(`/catalog/products/${id}`, { active })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', menu] }),
  });
}

export type UpdateProductInput = { id: string } & Partial<{
  name: string;
  price: number;
  description: string;
  categoryId: string;
  imageUrl: string;
  active: boolean;
  vatRate: number;
}>;

export function useUpdateProduct(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateProductInput) =>
      (await api.patch<Product>(`/catalog/products/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', menu] }),
  });
}

export function useDeleteProduct(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/catalog/products/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', menu] }),
  });
}

/** Reordena os produtos de UMA categoria em lote (otimista na cache ['products', menu]). */
export function useReorderProducts(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ categoryId, ids }: { categoryId: string; ids: string[] }) =>
      (await api.put('/catalog/products/reorder', { categoryId, ids })).data,
    onMutate: async ({ categoryId, ids }) => {
      await qc.cancelQueries({ queryKey: ['products', menu] });
      const anterior = qc.getQueryData<Product[]>(['products', menu]);
      qc.setQueryData<Product[]>(['products', menu], (old) => {
        if (!old) return old;
        const daCategoria = new Map(
          old.filter((p) => p.categoryId === categoryId).map((p) => [p.id, p]),
        );
        const reordenados = ids
          .map((id, i) => {
            const p = daCategoria.get(id);
            return p ? { ...p, sortOrder: i } : undefined;
          })
          .filter((p): p is Product => p !== undefined);
        let i = 0;
        return old.map((p) => (p.categoryId === categoryId ? reordenados[i++] ?? p : p));
      });
      return { anterior };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.anterior) qc.setQueryData(['products', menu], ctx.anterior);
      toast.error('Não foi possível reordenar os produtos.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['products', menu] }),
  });
}

/** Reordena as CATEGORIAS de um menu (otimista na cache ['categories', menu]). */
export function useReorderCategories(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) =>
      (await api.put('/catalog/categories/reorder', { ids }, { params: { menu } })).data,
    onMutate: async ({ ids }) => {
      await qc.cancelQueries({ queryKey: ['categories', menu] });
      const anterior = qc.getQueryData<Category[]>(['categories', menu]);
      qc.setQueryData<Category[]>(['categories', menu], (old) => {
        if (!old) return old;
        const byId = new Map(old.map((c) => [c.id, c]));
        return ids
          .map((id, i) => {
            const c = byId.get(id);
            return c ? { ...c, sortOrder: i } : undefined;
          })
          .filter((c): c is Category => c !== undefined);
      });
      return { anterior };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.anterior) qc.setQueryData(['categories', menu], ctx.anterior);
      toast.error('Não foi possível reordenar as categorias.');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['categories', menu] }),
  });
}

// ----- Grupos de opções (biblioteca por menu) -----
export function useProductDetail(id: string, enabled = true) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: async () => (await api.get<Product>(`/catalog/products/${id}`)).data,
    enabled,
  });
}

export function useModifierGroups(menu: MenuType = 'delivery') {
  return useQuery({
    queryKey: ['modifier-groups', menu],
    queryFn: async () =>
      (await api.get<ModifierGroupWithUsage[]>('/catalog/modifier-groups', { params: { menu } })).data,
  });
}

export function useCreateModifierGroup(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, required, maxSelect }: { name: string; required: boolean; maxSelect: number }) =>
      (
        await api.post(
          '/catalog/modifier-groups',
          { name, required, minSelect: required ? 1 : 0, maxSelect },
          { params: { menu } },
        )
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups', menu] }),
  });
}

export function useUpdateModifierGroup(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      required?: boolean;
      minSelect?: number;
      maxSelect?: number;
    }) => (await api.patch(`/catalog/modifier-groups/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useDeleteModifierGroup(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) =>
      (await api.delete(`/catalog/modifier-groups/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useAttachGroup(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, groupId }: { productId: string; groupId: string }) =>
      (await api.post(`/catalog/products/${productId}/modifier-groups/${groupId}`)).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['product', vars.productId] });
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
    },
  });
}

export function useDetachGroup(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, groupId }: { productId: string; groupId: string }) =>
      (await api.delete(`/catalog/products/${productId}/modifier-groups/${groupId}`)).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['product', vars.productId] });
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
    },
  });
}

export function useCreateModifier(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, name, priceDelta }: { groupId: string; name: string; priceDelta: number }) =>
      (await api.post(`/catalog/modifier-groups/${groupId}/modifiers`, { name, priceDelta })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useDeleteModifier(menu: MenuType = 'delivery') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => (await api.delete(`/catalog/modifiers/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups', menu] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}
```

- [ ] **Step 3: `page.tsx` — estado `menuAtivo` + seletor + threading**

Em `apps/dashboard/src/app/menu/page.tsx`:

1. Importar o tipo: no import de `@/lib/types`, acrescentar `MenuType`.
2. No topo de `MenuPage`, adicionar o estado (antes das chamadas aos hooks):
```tsx
  const [menuAtivo, setMenuAtivo] = useState<MenuType>('delivery');
```
3. Passar `menuAtivo` aos hooks do topo:
```tsx
  const categories = useCategories(menuAtivo);
  const products = useProducts(menuAtivo);
  const createCategory = useCreateCategory(menuAtivo);
  const reorderCategories = useReorderCategories(menuAtivo);
```
4. Renderizar o seletor de menu **acima** das abas Vista geral/Personalizações (antes do
   `<div className="mb-5 flex w-fit gap-1 ...">`):
```tsx
      <div className="mb-4 flex w-fit gap-1 rounded-xl border border-line bg-white p-1 shadow-card">
        {(
          [
            ['delivery', 'Delivery'],
            ['dine_in', 'Sala'],
          ] as [MenuType, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setMenuAtivo(id)}
            className={
              'rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors ' +
              (menuAtivo === id ? 'bg-brand text-white' : 'text-ink-soft hover:bg-cream')
            }
          >
            {label}
          </button>
        ))}
      </div>
```
5. Passar `menu={menuAtivo}` à `<PersonalizacoesTab />` (linha ~151):
   `<PersonalizacoesTab menu={menuAtivo} />`.
6. Threading nas sub-componentes que chamam hooks de catálogo (`CategorySection` e o modal de
   edição de produto): acrescentar uma prop `menu: MenuType` a cada uma, passar `menuAtivo` de
   `MenuPage`, e lá dentro chamar os hooks com `menu` — `useReorderProducts(menu)`,
   `useUpdateProduct(menu)`, `useToggleProduct(menu)`, `useDeleteProduct(menu)`,
   `useCreateProduct(menu)`, `useUpdateCategory(menu)`, `useDeleteCategory(menu)`,
   `useAttachGroup(menu)`, `useDetachGroup(menu)`, `useModifierGroups(menu)` conforme o que cada
   uma usar. (O default `'delivery'` evita partir compilação enquanto se faz o threading.)

- [ ] **Step 4: `PersonalizacoesTab.tsx` — receber `menu` por prop**

Acrescentar a prop e passá-la aos hooks:
```tsx
import type { MenuType } from '@/lib/types';
// ...
export function PersonalizacoesTab({ menu = 'delivery' }: { menu?: MenuType }) {
  const groups = useModifierGroups(menu);
  // e passar `menu` a useCreateModifierGroup(menu), useUpdateModifierGroup(menu),
  // useDeleteModifierGroup(menu), useCreateModifier(menu), useDeleteModifier(menu),
  // useAttachGroup(menu), useDetachGroup(menu) — o que este componente e os seus filhos usarem.
```

- [ ] **Step 5: Typecheck + build do dashboard**

```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/dashboard exec tsc --noEmit
pnpm --filter @comanda/dashboard build
```
Esperado: sem erros de tipo (se faltar threading nalgum sub-componente, o default `'delivery'`
mantém a compilação, mas confirmar que os sítios visíveis usam `menuAtivo`).

- [ ] **Step 6: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda
git add apps/dashboard/src/lib/types.ts apps/dashboard/src/lib/catalog-hooks.ts apps/dashboard/src/app/menu
git commit -m "feat(menu): seletor Delivery/Sala no painel + hooks de catálogo por menu"
```

---

## Task 3: Verificação integrada e não-regressão

**Files:**
- Test: `apps/api/scripts/e2e-catalogo.mjs` (correr), verificação manual no browser.

- [ ] **Step 1: Suite e2e-catalogo completa (ambiente limpo)**

```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda/apps/api
pkill -9 -f "dist/main" 2>/dev/null; sleep 1
(node --enable-source-maps dist/main > /tmp/dinein-api.log 2>&1 &); sleep 7
curl -s -o /dev/null -w "health %{http_code}\n" localhost:3001/api/health
node scripts/e2e-catalogo.mjs 2>&1 | tail -6
```
Esperado: `X passed, 0 failed` (os antigos + os novos de scoping).

- [ ] **Step 2: Não-regressão do storefront de delivery (mutação de leitura)**

```bash
# o menu público sem type tem de ser IDÊNTICO ao de antes (categorias/produtos do Delivery)
curl -s "http://localhost:3001/api/public/stores/pizzaria-demo/menu" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('categorias:', j.length, '| 1º produto:', j[0]?.products?.[0]?.name);})"
# e o dine_in vazio (a demo nunca teve Sala)
curl -s "http://localhost:3001/api/public/stores/pizzaria-demo/menu?type=dine_in" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('categorias na Sala (esperado 0):', j.length);})"
```
Esperado: delivery com as categorias/produtos de sempre; Sala com `0`.

- [ ] **Step 3: Verificação no browser (o que os testes não veem)**

Arrancar dashboard (`pnpm --filter @comanda/dashboard dev`), login `dono@pizzaria-demo.pt`/`demo1234`,
ir a **Menu**:
- O seletor **Delivery / Sala** aparece; em Delivery vêem-se os produtos de sempre.
- Mudar para **Sala**: aparece vazio ("cria a primeira categoria").
- Criar uma categoria + produto na Sala; voltar a **Delivery** e confirmar que **não** lá está.
- Aba **Personalizações**: em Sala, a biblioteca é a da Sala (vazia); em Delivery, a de sempre.
- Apagar o que se criou na Sala para deixar a demo limpa.

- [ ] **Step 4: Commit (se houve ajustes) e handoff**

Sem alterações de código nesta task além de eventuais correções. Deixar o ramo pronto para a
revisão adversarial e, depois, o merge+deploy (que exige o utilizador NOMEAR o host
`root@187.124.4.163`; `pg_dump` antes por causa da migração).

---

## Self-review (cobertura do spec)

- **§3 Modelo** → Task 1 Steps 1 (schema), 6 (service). ✓
- **§4 Migração aditiva/backfill/determinística** → Task 1 Steps 2-4. ✓
- **§5 API por tipo, guardas, público** → Task 1 Steps 5-8, 11. ✓
- **§6 Painel (seletor, por menu, estado vazio)** → Task 2 Steps 3-4. ✓
- **§7 Compatibilidade/seed** → Task 1 Step 9; Task 3 Step 2. ✓
- **§8 Testes (preservação, isolamento, guardas, retrocompat, e2e)** → Task 1 Steps 4, 11; Task 3. ✓
- **§9 Fora de âmbito** → nada de QR/pedido/impressoras/revamp neste plano. ✓

**Consistência de tipos:** `parseMenuType(raw?) → MenuType`; serviço recebe `MenuType`; frontend
`MenuType = 'delivery'|'dine_in'`; query key `['<entidade>', menu]` igual entre query e mutações.
