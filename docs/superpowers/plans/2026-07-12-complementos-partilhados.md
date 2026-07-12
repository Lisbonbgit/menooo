# Grupos de Complementos Reutilizáveis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grupos de opções (`ModifierGroup`) passam a pertencer ao tenant e anexam-se a vários produtos via junção; dashboard ganha abas "Vista geral" / "Personalizações" com biblioteca editável.

**Architecture:** Migração SQL data-preserving (grupo→tenant + junção 1:1 com o estado atual); API mantém o formato JSON `modifierGroups` nos consumidores (storefront intocado); dashboard edita grupos só na biblioteca e anexa/desanexa no produto.

**Tech Stack:** NestJS + Prisma (Postgres), Next 15 + React Query (dashboard). Sem dependências novas.

## Global Constraints

- Sem Postgres local: migração escrita à mão em `prisma/migrations/<timestamp>_shared_modifier_groups/migration.sql` (timestamp manual, estilo `20260712120000`); aplica-se no servidor com `prisma migrate deploy`.
- O formato JSON devolvido a storefront/checkout NÃO muda: `modifierGroups: [{ id, name, required, minSelect, maxSelect, modifiers: [...] }]`.
- IDs de `Modifier` não mudam na migração (validação do checkout intacta).
- Verificação local por tarefa: `pnpm --filter @comanda/api typecheck` (ou dashboard) — runtime só em homologação.
- Textos do dashboard em PT-PT, tom atual ("Anexar grupo", "usado em N produtos").

---

### Task 1: Schema + migração + leitura adaptada

**Files:**
- Modify: `apps/api/prisma/schema.prisma:273-317` (Product/ModifierGroup) + relações em Tenant
- Create: `apps/api/prisma/migrations/20260712120000_shared_modifier_groups/migration.sql`
- Modify: `apps/api/src/modules/catalog/catalog.service.ts:56-68,158-215`
- Modify: `apps/api/src/modules/orders/orders.service.ts:75-97`
- Modify: `apps/api/src/modules/catalog/dto/modifier.dto.ts` (remover `sortOrder` dos DTOs de grupo)

**Interfaces:**
- Produces: modelos Prisma `ModifierGroup { tenantId }` e `ProductModifierGroup { productId, groupId, sortOrder }`; helper privado `withModifierGroups(product)` no CatalogService que mapeia `modifierGroupLinks` → `modifierGroups`.

- [ ] **Step 1: Schema.** Em `ModifierGroup`: substituir `productId/product` por `tenantId/tenant Tenant @relation(..., onDelete: Cascade)`, remover `sortOrder`, acrescentar `productLinks ProductModifierGroup[]` e `@@index([tenantId])`. Em `Product`: `modifierGroups ModifierGroup[]` → `modifierGroupLinks ProductModifierGroup[]`. Em `Tenant`: acrescentar `modifierGroups ModifierGroup[]`. Novo modelo:

```prisma
// liga um grupo reutilizável a um produto (ordem por produto)
model ProductModifierGroup {
  id        String        @id @default(cuid())
  productId String
  product   Product       @relation(fields: [productId], references: [id], onDelete: Cascade)
  groupId   String
  group     ModifierGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  sortOrder Int           @default(0)

  @@unique([productId, groupId])
  @@index([productId])
  @@index([groupId])
}
```

- [ ] **Step 2: Migração SQL** (backfill antes de apertar constraints):

```sql
-- Grupos de complementos reutilizáveis: o grupo passa a pertencer ao tenant
-- e liga-se a produtos por junção. Cada grupo existente fica anexado 1:1.
ALTER TABLE "ModifierGroup" ADD COLUMN "tenantId" TEXT;

CREATE TABLE "ProductModifierGroup" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductModifierGroup_pkey" PRIMARY KEY ("id")
);

UPDATE "ModifierGroup" g SET "tenantId" = p."tenantId"
FROM "Product" p WHERE p."id" = g."productId";

INSERT INTO "ProductModifierGroup" ("id", "productId", "groupId", "sortOrder")
SELECT 'pmg_' || g."id", g."productId", g."id", g."sortOrder" FROM "ModifierGroup" g;

ALTER TABLE "ModifierGroup" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ModifierGroup" DROP CONSTRAINT "ModifierGroup_productId_fkey";
ALTER TABLE "ModifierGroup" DROP COLUMN "productId";
ALTER TABLE "ModifierGroup" DROP COLUMN "sortOrder";

CREATE INDEX "ModifierGroup_tenantId_idx" ON "ModifierGroup"("tenantId");
CREATE UNIQUE INDEX "ProductModifierGroup_productId_groupId_key"
  ON "ProductModifierGroup"("productId", "groupId");
CREATE INDEX "ProductModifierGroup_productId_idx" ON "ProductModifierGroup"("productId");
CREATE INDEX "ProductModifierGroup_groupId_idx" ON "ProductModifierGroup"("groupId");

ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Antes de fechar: confirmar no SQL da migração inicial (`00000000000000_init/migration.sql`) o nome real da constraint `ModifierGroup_productId_fkey`.

- [ ] **Step 3: `pnpm --filter @comanda/api exec prisma generate`** → client novo.

- [ ] **Step 4: catalog.service.ts (leituras).** `getProduct`: include `modifierGroupLinks { orderBy: { sortOrder: 'asc' }, include: { group: { include: { modifiers: { orderBy: { sortOrder: 'asc' } } } } } }` e devolver `{ ...rest, modifierGroups: links.map((l) => l.group) }`. `getPublicMenu`: mesmo include dentro de products + mapeamento por produto. `ensureModifierGroup`: `where: { id, tenantId }`. `ensureModifier`: `where: { id, group: { tenantId } }`.

- [ ] **Step 5: orders.service.ts.** Include → `modifierGroupLinks: { include: { group: { include: { modifiers: true } } } }`; mapa de válidos → `product.modifierGroupLinks.flatMap((l) => l.group.modifiers)`.

- [ ] **Step 6: DTOs.** Remover `sortOrder` de `CreateModifierGroupDto`/`UpdateModifierGroupDto` (o grupo já não tem ordem própria). `createModifierGroup` no service perde `productId` e `sortOrder` (assinatura nova na Task 2).

- [ ] **Step 7:** `pnpm --filter @comanda/api typecheck` → sem erros (o controller ainda compila porque a assinatura nova entra na Task 2 — se rebentar, a Task 2 é feita no mesmo commit).

- [ ] **Step 8: Commit** `git commit -m "Complementos: grupos passam a tenant-level com junção a produtos (migração data-preserving)"`.

### Task 2: API — biblioteca + anexar/desanexar

**Files:**
- Modify: `apps/api/src/modules/catalog/catalog.service.ts:98-152`
- Modify: `apps/api/src/modules/catalog/catalog.controller.ts:90-137`

**Interfaces:**
- Produces (service): `listModifierGroups(tenantId)` → grupos com `modifiers` + `usedIn: number`; `createModifierGroup(tenantId, dto)`; `attachModifierGroup(tenantId, productId, groupId)`; `detachModifierGroup(tenantId, productId, groupId)`.
- Produces (rotas): `GET/POST /catalog/modifier-groups`, `PATCH/DELETE /catalog/modifier-groups/:id`, `POST/DELETE /catalog/products/:productId/modifier-groups/:groupId`. A rota antiga `POST /catalog/products/:productId/modifier-groups` desaparece.

- [ ] **Step 1: Service.**

```ts
async listModifierGroups(tenantId: string) {
  const groups = await this.prisma.modifierGroup.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
    include: {
      modifiers: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { productLinks: true } },
    },
  });
  return groups.map(({ _count, ...g }) => ({ ...g, usedIn: _count.productLinks }));
}

createModifierGroup(tenantId: string, dto: CreateModifierGroupDto) {
  return this.prisma.modifierGroup.create({
    data: {
      tenantId,
      name: dto.name,
      required: dto.required ?? false,
      minSelect: dto.minSelect ?? 0,
      maxSelect: dto.maxSelect ?? 1,
    },
  });
}

async attachModifierGroup(tenantId: string, productId: string, groupId: string) {
  await this.ensureProduct(tenantId, productId);
  await this.ensureModifierGroup(tenantId, groupId);
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

async detachModifierGroup(tenantId: string, productId: string, groupId: string) {
  await this.ensureProduct(tenantId, productId);
  const { count } = await this.prisma.productModifierGroup.deleteMany({
    where: { productId, groupId },
  });
  if (count === 0) throw new NotFoundException('Grupo não está anexado a este produto.');
  return { detached: true };
}
```

(Importar `ConflictException` de `@nestjs/common`.)

- [ ] **Step 2: Controller.** Substituir o bloco "Grupos de modificadores":

```ts
@Get('modifier-groups')
listModifierGroups(@TenantId() tenantId: string) {
  return this.catalog.listModifierGroups(tenantId);
}

@Post('modifier-groups')
createModifierGroup(@TenantId() tenantId: string, @Body() dto: CreateModifierGroupDto) {
  return this.catalog.createModifierGroup(tenantId, dto);
}

// PATCH/DELETE modifier-groups/:id mantêm-se como estão

@Post('products/:productId/modifier-groups/:groupId')
attachModifierGroup(
  @TenantId() tenantId: string,
  @Param('productId') productId: string,
  @Param('groupId') groupId: string,
) {
  return this.catalog.attachModifierGroup(tenantId, productId, groupId);
}

@Delete('products/:productId/modifier-groups/:groupId')
detachModifierGroup(
  @TenantId() tenantId: string,
  @Param('productId') productId: string,
  @Param('groupId') groupId: string,
) {
  return this.catalog.detachModifierGroup(tenantId, productId, groupId);
}
```

- [ ] **Step 3:** `pnpm --filter @comanda/api typecheck && pnpm --filter @comanda/api build` → verdes.
- [ ] **Step 4: Commit** `git commit -m "Complementos: API de biblioteca (usedIn) e anexar/desanexar em produtos"`.

### Task 3: Dashboard — types e hooks

**Files:**
- Modify: `apps/dashboard/src/lib/types.ts:15-22`
- Modify: `apps/dashboard/src/lib/catalog-hooks.ts:96-161`

**Interfaces:**
- Produces: `ModifierGroupWithUsage = ModifierGroup & { usedIn: number }`; hooks `useModifierGroups()`, `useCreateModifierGroup({name, required, maxSelect})`, `useUpdateModifierGroup({id, ...campos})`, `useDeleteModifierGroup({id})`, `useAttachGroup({productId, groupId})`, `useDetachGroup({productId, groupId})`, `useCreateModifier({groupId, name, priceDelta})`, `useDeleteModifier({id})`.
- Regra de invalidação: mutações da biblioteca invalidam `['modifier-groups']` E o prefixo `['product']` (todos os detalhes abertos); anexar/desanexar invalida `['product', productId]` e `['modifier-groups']` (usedIn).

- [ ] **Step 1: types.ts** — acrescentar `export type ModifierGroupWithUsage = ModifierGroup & { usedIn: number };`
- [ ] **Step 2: hooks** — reescrever a secção "Grupos de opções":

```ts
export function useModifierGroups() {
  return useQuery({
    queryKey: ['modifier-groups'],
    queryFn: async () =>
      (await api.get<ModifierGroupWithUsage[]>('/catalog/modifier-groups')).data,
  });
}

export function useCreateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, required, maxSelect }: { name: string; required: boolean; maxSelect: number }) =>
      (await api.post('/catalog/modifier-groups', { name, required, minSelect: required ? 1 : 0, maxSelect })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}

export function useUpdateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; required?: boolean; minSelect?: number; maxSelect?: number }) =>
      (await api.patch(`/catalog/modifier-groups/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useDeleteModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) =>
      (await api.delete(`/catalog/modifier-groups/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useAttachGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, groupId }: { productId: string; groupId: string }) =>
      (await api.post(`/catalog/products/${productId}/modifier-groups/${groupId}`)).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['product', vars.productId] });
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
    },
  });
}

export function useDetachGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, groupId }: { productId: string; groupId: string }) =>
      (await api.delete(`/catalog/products/${productId}/modifier-groups/${groupId}`)).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['product', vars.productId] });
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
    },
  });
}

export function useCreateModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, name, priceDelta }: { groupId: string; name: string; priceDelta: number }) =>
      (await api.post(`/catalog/modifier-groups/${groupId}/modifiers`, { name, priceDelta })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}

export function useDeleteModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) =>
      (await api.delete(`/catalog/modifiers/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['product'] });
    },
  });
}
```

(Importar `ModifierGroupWithUsage` de `./types`. `useProductDetail` fica igual.)

- [ ] **Step 3:** `pnpm --filter @comanda/dashboard typecheck` — vai FALHAR no `menu/page.tsx` (assinaturas antigas). Esperado; a Task 4 conserta. Não fazer commit ainda se vermelho — Tasks 3+4 podem partilhar commit.

### Task 4: Dashboard — abas e biblioteca

**Files:**
- Create: `apps/dashboard/src/app/menu/PersonalizacoesTab.tsx`
- Modify: `apps/dashboard/src/app/menu/page.tsx`

**Interfaces:**
- Consumes: hooks da Task 3.
- Produces: `<PersonalizacoesTab />` (biblioteca completa); `MenuPage` com estado `tab: 'geral' | 'personalizacoes'`; `OptionsEditor` reescrito como painel de anexação com prop `onGoToLibrary: () => void` (drill: MenuPage → ProductRow → OptionsEditor).

- [ ] **Step 1: PersonalizacoesTab.tsx.** Mover para aqui `AddModifierChip` (de page.tsx) e construir: form de criação no topo (nome + checkbox obrigatório + select máx. escolhas — mesmo markup do form atual de grupo), lista `useModifierGroups()` em cartões: cabeçalho com nome, badges obrigatório/`até N` (markup atual), badge `usado em N produtos` (`bg-cream text-ink-soft`; "sem produtos" quando 0), chips de opções com X (useDeleteModifier) + `AddModifierChip` (useCreateModifier), apagar grupo com `confirm` que inclui a contagem: `Apagar "${g.name}"? Está em ${g.usedIn} produto(s) — as opções desaparecem desses produtos.`. Estado vazio: "Ainda não tens grupos. Cria o primeiro — por exemplo Tamanho ou Extras — e depois anexa-o aos produtos na Vista geral."
- [ ] **Step 2: page.tsx.** Estado `const [tab, setTab] = useState<'geral' | 'personalizacoes'>('geral')`; segmented control por baixo do título (dois botões, ativo `bg-brand text-white`, inativo `border-line text-ink-soft`); o form "Nova categoria" nas actions só na aba geral. `OptionsEditor` reescrito: `useProductDetail` + `useModifierGroups` + attach/detach; lista de grupos anexados (nome, badges, chips só-leitura SEM botão X nas opções), botão desanexar por grupo (X no cabeçalho, `confirm` leve "Desanexar não apaga o grupo da biblioteca"), `<select>` "Anexar grupo…" com os grupos ainda não anexados + botão anexar, atalho `Editar na biblioteca →` que chama `onGoToLibrary`. Remover imports/hooks não usados.
- [ ] **Step 3:** `pnpm --filter @comanda/dashboard typecheck && pnpm --filter @comanda/dashboard build` → verdes.
- [ ] **Step 4: Commit** `git commit -m "Complementos: abas no menu (Vista geral/Personalizações) com biblioteca reutilizável"`.

### Task 5: Verificação e revisão

- [ ] `pnpm --filter @comanda/api build && pnpm --filter @comanda/dashboard build && pnpm --filter @comanda/storefront build` → verdes.
- [ ] Grep de regressões: `grep -rn "modifierGroups" apps/api/src` — só usos mapeados; `grep -rn "modifier-groups" apps/dashboard/src` — só rotas novas.
- [ ] Revisão multi-agente do diff (correção, segurança multi-tenant, UX) e aplicar achados confirmados.
- [ ] Nota de deploy: no VPS, `prisma migrate deploy` corre antes do arranque da API (confirmar no Dockerfile/compose se já é automático).
- [ ] Commit final de ajustes.
