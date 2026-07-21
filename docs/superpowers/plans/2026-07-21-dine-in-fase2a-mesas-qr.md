# Dine-in Fase 2a — Mesas de sala + QR + menu na mesa — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono cria mesas de sala com QR gerado pelo Menooo; o cliente lê o QR e vê o menu de Sala (só leitura) com a mesa identificada — sem nunca um QR servir outro restaurante.

**Architecture:** Modelo novo `DineTable` (separado das reservas) com `qrToken` único; CRUD do dono + endpoint público que resolve o QR por `slug`+`token` juntos; QR gerado client-side no painel; rota nova do storefront `/[slug]/mesa/[qrToken]` que mostra o menu de Sala (`?type=dine_in`, Fase 1) em modo só-leitura.

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL (apps/api); Next.js 14 + React Query v5 (apps/dashboard, apps/storefront); `qrcode` (novo, dashboard, client-side); Jest + e2e para a API.

## Global Constraints

- **SEGURANÇA (topo): um QR só serve o seu restaurante.** O endpoint público resolve **com `slug` E `qrToken` juntos** (`where: { qrToken, tenant: { slug } }`); se não bater → **404 neutro**. Teste obrigatório: `qrToken` de A com o slug de B → 404.
- **PT-PT** em todo o texto visível e mensagens de erro.
- **`DineTable.qrToken`** é `@unique` global; gerado por `@default(cuid())`; o QR é construído **sempre com o slug do próprio dono** (de `/tenants/me`).
- **Só leitura** nesta fase — sem carrinho, sem pedir (é a 2b). NÃO tocar no `StoreClient` (loja de delivery, caminho do dinheiro) — a página da mesa é um componente próprio.
- **Migração aditiva** (tabela nova, sem backfill). `pg_dump` antes do deploy.
- **Isolamento (tenancy)**: CRUD do dono sempre com `@TenantId()` + `updateMany({ id, tenantId })` (padrão das mesas de reservas).
- Stack local: DB `:5433`, API `:3001/api`, dashboard `:3002`, storefront `:3000`. PATH: `export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"`.
- Deploy exige o utilizador NOMEAR `root@187.124.4.163`; NUNCA e2e contra produção. Validar por mutação.

---

## Estrutura de ficheiros

**Backend (apps/api):**
- `prisma/schema.prisma` — `model DineTable` + relação no `Tenant`.
- `prisma/migrations/<ts>_dine_tables/migration.sql` — criar à mão.
- `src/modules/dine-tables/` — **Criar**: `dine-tables.module.ts`, `dine-tables.service.ts`, `dine-tables.controller.ts` (dono), `public-dine-table.controller.ts` (resolve), `dto/dine-table.dto.ts`.
- `src/app.module.ts` — registar `DineTablesModule`.
- `scripts/e2e-dine-tables.mjs` — **Criar**.

**Frontend:**
- `apps/dashboard/package.json` — dep `qrcode`.
- `apps/dashboard/src/lib/dine-tables-hooks.ts` — **Criar**.
- `apps/dashboard/src/components/DineTablesTab.tsx` — **Criar** (sub-aba QR Code).
- `apps/dashboard/src/app/menu/page.tsx` — `MenuTab` += `'qr'`/`'preview'`; painéis.
- `apps/storefront/src/lib/store-hooks.ts` — `useMenu(slug, type?)` + `useTable(slug, qrToken)`.
- `apps/storefront/src/lib/types.ts` — tipo `TableInfo`.
- `apps/storefront/src/app/[slug]/mesa/[qrToken]/page.tsx` + `MesaMenuClient.tsx` — **Criar**.

---

## Task 1: Backend — DineTable, CRUD, resolve público, migração, e2e

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `src/app.module.ts`
- Create: migration; `src/modules/dine-tables/*` (module, service, 2 controllers, dto); `scripts/e2e-dine-tables.mjs`

**Interfaces:**
- Produces:
  - `GET /dine-tables` → `DineTable[]`; `POST /dine-tables {name}` → `DineTable`; `POST /dine-tables/bulk {count, prefix?}` → `DineTable[]`; `PATCH /dine-tables/:id {name?,active?}`; `DELETE /dine-tables/:id`. Todos `@Roles(OWNER,STAFF)`, scoped por `@TenantId()`.
  - `GET /public/stores/:slug/mesa/:qrToken` → `{ id, name }` (404 neutro se o token não pertencer àquele slug / loja não usável).

- [ ] **Step 1: Schema — DineTable**

Em `apps/api/prisma/schema.prisma`, adicionar o modelo (perto de `Table`) e a relação inversa no `Tenant` (`dineTables DineTable[]`):
```prisma
model DineTable {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name      String
  qrToken   String   @unique @default(cuid())
  active    Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId])
}
```

- [ ] **Step 2: Migração aditiva (à mão) + aplicar**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd apps/api
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_dine_tables"
cat > "prisma/migrations/${TS}_dine_tables/migration.sql" <<'SQL'
CREATE TABLE "DineTable" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "qrToken" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DineTable_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DineTable_qrToken_key" ON "DineTable"("qrToken");
CREATE INDEX "DineTable_tenantId_idx" ON "DineTable"("tenantId");
ALTER TABLE "DineTable" ADD CONSTRAINT "DineTable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
SQL
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```
Esperado: `migration applied` (usar `migrate deploy`, não `dev` — drift pré-existente conhecido).

- [ ] **Step 3: DTOs**

Criar `apps/api/src/modules/dine-tables/dto/dine-table.dto.ts`:
```ts
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateDineTableDto {
  @IsString() @MaxLength(40) name!: string;
}
export class BulkDineTableDto {
  @IsInt() @Min(1) @Max(100) count!: number;
  @IsOptional() @IsString() @MaxLength(20) prefix?: string; // default "Mesa"
}
export class UpdateDineTableDto {
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

- [ ] **Step 4: Serviço**

Criar `apps/api/src/modules/dine-tables/dine-tables.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BulkDineTableDto, CreateDineTableDto, UpdateDineTableDto } from './dto/dine-table.dto';

@Injectable()
export class DineTablesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.dineTable.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  create(tenantId: string, dto: CreateDineTableDto) {
    return this.prisma.dineTable.create({ data: { tenantId, name: dto.name.trim() } });
  }

  async bulk(tenantId: string, dto: BulkDineTableDto) {
    const prefix = (dto.prefix ?? 'Mesa').trim();
    const base = await this.prisma.dineTable.count({ where: { tenantId } });
    const data = Array.from({ length: dto.count }, (_, i) => ({
      tenantId,
      name: `${prefix} ${base + i + 1}`,
      sortOrder: base + i,
    }));
    // createMany não devolve as linhas; criar e devolver a lista atualizada
    await this.prisma.dineTable.createMany({ data });
    return this.list(tenantId);
  }

  async update(tenantId: string, id: string, dto: UpdateDineTableDto) {
    const data: { name?: string; active?: boolean } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.active !== undefined) data.active = dto.active;
    const r = await this.prisma.dineTable.updateMany({ where: { id, tenantId }, data });
    if (r.count === 0) throw new NotFoundException('Mesa não encontrada.');
    return this.prisma.dineTable.findFirst({ where: { id, tenantId } });
  }

  async remove(tenantId: string, id: string) {
    const r = await this.prisma.dineTable.deleteMany({ where: { id, tenantId } });
    if (r.count === 0) throw new NotFoundException('Mesa não encontrada.');
    return { ok: true };
  }

  /** Resolve o QR SEMPRE por slug+token juntos: um token só serve o seu restaurante. 404 caso contrário. */
  async resolvePublic(slug: string, qrToken: string) {
    const table = await this.prisma.dineTable.findFirst({
      where: {
        qrToken,
        active: true,
        tenant: { slug, status: 'ACTIVE' },
      },
      select: { id: true, name: true, tenant: { select: { account: true } } },
    });
    if (!table || !isUsable(table.tenant.account)) {
      throw new NotFoundException('Mesa não encontrada.');
    }
    return { id: table.id, name: table.name };
  }
}
```
Nota: importar `isSubscriptionUsable` de `../tenants/subscription.util` e usá-lo em vez do `isUsable` placeholder — resolver a conta como fazem os outros gatings públicos (ver `catalog.service.ts:getPublicMenu`, que faz `include:{account:true}` e chama `isSubscriptionUsable`). Ajustar o `select` para trazer a `account` completa da relação `tenant`.

- [ ] **Step 5: Controllers**

Criar `apps/api/src/modules/dine-tables/dine-tables.controller.ts` (dono/staff) — espelhar o padrão das mesas de reservas (`reservations.controller.ts` secção "Mesas"): `@ApiBearerAuth()` + `@UseGuards(RolesGuard)` + `@Roles(UserRole.OWNER, UserRole.STAFF)` em cada método; `@TenantId() tenantId`; rotas `GET /dine-tables`, `POST /dine-tables`, `POST /dine-tables/bulk`, `PATCH /dine-tables/:id`, `DELETE /dine-tables/:id` (declarar `bulk` ANTES de `:id`).

Criar `apps/api/src/modules/dine-tables/public-dine-table.controller.ts`:
```ts
import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DineTablesService } from './dine-tables.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('public')
@Controller('public/stores')
export class PublicDineTableController {
  constructor(private readonly tables: DineTablesService) {}

  /** Resolve a mesa a partir do QR — só serve o restaurante do `slug`. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':slug/mesa/:qrToken')
  resolve(@Param('slug') slug: string, @Param('qrToken') qrToken: string) {
    return this.tables.resolvePublic(slug, qrToken);
  }
}
```

Criar `apps/api/src/modules/dine-tables/dine-tables.module.ts` (providers `DineTablesService`, controllers ambos, imports `PrismaModule`/`TenantsModule` conforme o padrão dos outros módulos) e registá-lo em `src/app.module.ts`.

- [ ] **Step 6: e2e (CRUD + ISOLAMENTO + resolve)**

Criar `apps/api/scripts/e2e-dine-tables.mjs` seguindo o estilo dos outros e2e (helpers `req`/`check`, login de dono). Cobrir:
```
- POST /dine-tables {name:'Mesa 1'} → 200, tem qrToken
- POST /dine-tables/bulk {count:3} → lista com 4 mesas
- GET /dine-tables → 4, ordenadas
- PATCH /dine-tables/:id {name:'Balcão'} → 200; GET reflete
- resolve OK: GET /public/stores/<slugA>/mesa/<qrTokenDeA> → 200 {name}
- ISOLAMENTO (obrigatório): GET /public/stores/<slugB>/mesa/<qrTokenDeA> → 404
- token inexistente → 404
- DELETE /dine-tables/:id → 200; GET reflete
- tenancy: dono B não consegue PATCH/DELETE mesa de A (404)
```
(Se não houver um 2º tenant no seed para o teste de isolamento, criar um tenant B de teste no próprio script, ou reutilizar a demo + um segundo slug existente.)

- [ ] **Step 7: Build + tsc + e2e**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/api build && pnpm --filter @comanda/api exec tsc --noEmit
pkill -9 -f "dist/main" 2>/dev/null; sleep 1; (cd apps/api && node dist/main > /tmp/dt-api.log 2>&1 &); sleep 7
curl -s -o /dev/null -w "health %{http_code}\n" localhost:3001/api/health
node apps/api/scripts/e2e-dine-tables.mjs 2>&1 | tail -8
```
Esperado: build/tsc limpos; e2e verde, com o check de isolamento (slug de B + token de A → 404).

- [ ] **Step 8: Commit**
```bash
git add apps/api/prisma apps/api/src/modules/dine-tables apps/api/src/app.module.ts apps/api/scripts/e2e-dine-tables.mjs
git commit -m "feat(dine-in): mesas de sala (DineTable) + CRUD + resolve público por slug+token"
```

---

## Task 2: Painel — sub-abas "QR Code" (mesas + imprimir QR) e "Ver Menu"

**Files:**
- Modify: `apps/dashboard/package.json` (dep `qrcode`), `apps/dashboard/src/app/menu/page.tsx`
- Create: `apps/dashboard/src/lib/dine-tables-hooks.ts`, `apps/dashboard/src/components/DineTablesTab.tsx`

**Interfaces:**
- Consumes (Task 1): `GET/POST/PATCH/DELETE /dine-tables`, `POST /dine-tables/bulk`. O slug do tenant vem de `/tenants/me` (query `['tenant-me']` já usada noutras páginas).

- [ ] **Step 1: Dependência `qrcode`**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/dashboard add qrcode
pnpm --filter @comanda/dashboard add -D @types/qrcode
```

- [ ] **Step 2: Hooks**

Criar `apps/dashboard/src/lib/dine-tables-hooks.ts` (mirror de `catalog-hooks.ts`): `useDineTables()` (`GET /dine-tables`, queryKey `['dine-tables']`), `useCreateDineTable()`, `useBulkDineTables()`, `useUpdateDineTable()`, `useDeleteDineTable()` — cada mutation invalida `['dine-tables']`; tipos `DineTable { id, name, qrToken, active, sortOrder }`.

- [ ] **Step 3: Sub-aba QR Code (componente)**

Criar `apps/dashboard/src/components/DineTablesTab.tsx`: lista as mesas (`useDineTables`); formulário "adicionar mesa" + botão "adicionar várias" (`useBulkDineTables` com um `count`); por mesa: nome (editável via `useUpdateDineTable`), toggle ativo, apagar (`useDeleteDineTable`), e um botão **"Imprimir QR"**. Recebe o `slug` e a base do URL da loja por props. O QR:
```tsx
import QRCode from 'qrcode';
// url da mesa:
const STORE = process.env.NEXT_PUBLIC_STORE_URL ?? 'https://menooo.com';
const url = `${STORE}/${slug}/mesa/${table.qrToken}`;
// gerar data-url (efeito): const [img,setImg]=useState(''); useEffect(()=>{QRCode.toDataURL(url,{width:512,margin:2}).then(setImg)},[url]);
```
"Imprimir QR" abre uma vista de impressão só com o QR grande + a etiqueta "Mesa X" + o nome da loja (window com o `<img>` + `window.print()`, ou um bloco com CSS `@media print` que esconde o resto). Confirmar `NEXT_PUBLIC_STORE_URL` no `apps/dashboard` (env/build-arg); se não existir, adicionar com default `https://menooo.com`.

- [ ] **Step 4: Ligar as sub-abas no Menu**

Em `apps/dashboard/src/app/menu/page.tsx`:
- `type MenuTab = 'geral' | 'personalizacoes' | 'qr' | 'preview';`
- No seletor de abas (o array `[['geral','Vista geral'],['personalizacoes','Personalizações']]`), acrescentar `['qr','QR Code']` e `['preview','Ver Menu']` **só quando `menuAtivo === 'dine_in'`** (filtrar o array por `menuAtivo`). Se o utilizador estiver noutra aba e mudar para Delivery, repor `tab='geral'`.
- Painel QR: `<div className={tab==='qr' ? undefined : 'hidden'}><DineTablesTab slug={slug} /></div>` (o `slug` vem do `/tenants/me`).
- Painel Ver Menu: `<div className={tab==='preview' ? undefined : 'hidden'}>` com um botão "Abrir pré-visualização" que abre, em nova aba, o URL da 1ª mesa ativa (`${STORE}/${slug}/mesa/${primeiraMesa.qrToken}`); se não houver mesas, texto "Cria uma mesa primeiro no separador QR Code".

- [ ] **Step 5: Typecheck + build**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/dashboard exec tsc --noEmit && pnpm --filter @comanda/dashboard build
```
Esperado: sem erros.

- [ ] **Step 6: Commit**
```bash
git add apps/dashboard/package.json apps/dashboard/pnpm-lock.yaml apps/dashboard/src ../../pnpm-lock.yaml 2>/dev/null; git add -A apps/dashboard package.json pnpm-lock.yaml
git commit -m "feat(dashboard): sub-abas QR Code (mesas + imprimir QR) e Ver Menu no menu de Sala"
```

---

## Task 3: Storefront — rota do menu da mesa (só leitura)

**Files:**
- Modify: `apps/storefront/src/lib/store-hooks.ts`, `apps/storefront/src/lib/types.ts`
- Create: `apps/storefront/src/app/[slug]/mesa/[qrToken]/page.tsx`, `apps/storefront/src/app/[slug]/mesa/[qrToken]/MesaMenuClient.tsx`

**Interfaces:**
- Consumes (Task 1): `GET /public/stores/:slug/mesa/:qrToken` → `{ id, name }`. O menu de Sala vem do endpoint da Fase 1 `GET /public/stores/:slug/menu?type=dine_in`.

- [ ] **Step 1: Hooks + tipo**

Em `apps/storefront/src/lib/types.ts`: `export interface TableInfo { id: string; name: string }`.
Em `apps/storefront/src/lib/store-hooks.ts`:
- Estender `useMenu` para aceitar um tipo opcional (retrocompatível — sem tipo continua Delivery):
```ts
export function useMenu(slug: string, type?: 'delivery' | 'dine_in') {
  return useQuery({
    queryKey: ['menu', slug, type ?? 'delivery'],
    queryFn: async () =>
      (await api.get<MenuCategory[]>(`/public/stores/${slug}/menu${type ? `?type=${type}` : ''}`)).data,
    retry: false,
  });
}
```
- Novo hook:
```ts
export function useTable(slug: string, qrToken: string) {
  return useQuery({
    queryKey: ['table', slug, qrToken],
    queryFn: async () => (await api.get<TableInfo>(`/public/stores/${slug}/mesa/${qrToken}`)).data,
    retry: false,
  });
}
```
(importar `TableInfo`).

- [ ] **Step 2: A rota (server) + client read-only**

Criar `apps/storefront/src/app/[slug]/mesa/[qrToken]/page.tsx` (seguir a convenção `params: Promise<...>` das outras páginas `[slug]/*`, ex. `reserva/[code]/page.tsx`; `export const metadata = { robots: { index: false } }`), que faz `await params` e renderiza `<MesaMenuClient slug={slug} qrToken={qrToken} />`.

Criar `apps/storefront/src/app/[slug]/mesa/[qrToken]/MesaMenuClient.tsx` (componente PRÓPRIO, read-only — NÃO reutilizar `StoreClient` para não tocar na loja de delivery):
- `const store = useStore(slug); const table = useTable(slug, qrToken); const menu = useMenu(slug, 'dine_in');`
- Se `table.isError` → "Mesa não encontrada." + link para a loja.
- Renderiza `<StoreTheme brandColor={store.data?.brandColor} heroColor={store.data?.heroColor} />`, um cabeçalho com o nome da loja + **"Mesa {table.data.name}"**, e as categorias/produtos do menu de Sala **só para ver**: por categoria, os produtos com foto/nome/descrição/preço — **sem** botão "+", **sem** `ProductOptions`, **sem** `CartBar`. Um rodapé discreto: "Para pedir, chama o staff" (o pedir chega na próxima atualização).
- Reutiliza os tipos `MenuCategory`/`Product` de `@/lib/types` e as classes Tailwind já usadas no storefront.

- [ ] **Step 3: Typecheck + build**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/storefront exec tsc --noEmit && pnpm --filter @comanda/storefront build
```
Esperado: sem erros; a rota `/[slug]/mesa/[qrToken]` no output do build. (Se o dev der "Cannot find module vendor-chunks/…", é cache: `rm -rf apps/storefront/.next`.)

- [ ] **Step 4: Commit**
```bash
git add apps/storefront/src
git commit -m "feat(storefront): rota /[slug]/mesa/[qrToken] — menu de Sala só leitura com a mesa"
```

---

## Task 4: Verificação integrada (browser)

- [ ] **Step 1: Fluxo no browser**

Com API (dist novo) + dashboard + storefront a correr e a demo ACTIVE com um **menu de Sala** com produtos (se a Sala da demo estiver vazia, criar 1 categoria + 1 produto no menu de Sala primeiro):
- Painel → Menu → selecionar **Sala** → aparecem as sub-abas **QR Code** e **Ver Menu** (não aparecem em Delivery). Criar uma mesa e usar "adicionar várias". Ver o QR e abrir "Imprimir QR".
- Copiar o URL de uma mesa e abri-lo no storefront → mostra **"Mesa X"** + o **menu de Sala** (não o de Delivery), só para ver (sem botões de +/carrinho).
- **ISOLAMENTO:** trocar o slug no URL da mesa por outro restaurante (ex. `lenha-e-brasa`) mantendo o token da demo → **"Mesa não encontrada"**.
- Token inválido → "Mesa não encontrada".

Limpar as mesas/dados de teste no fim.

- [ ] **Step 2: Handoff** — ramo pronto para revisão adversarial final e depois merge+deploy (o utilizador NOMEIA o host; `pg_dump` antes).

---

## Self-review (cobertura do spec)

- **§2 Segurança (QR só serve o seu restaurante)** → Task 1 Steps 4-6 (resolve por slug+token; e2e de isolamento); Global Constraints. ✓
- **§4 Modelo DineTable + migração aditiva** → Task 1 Steps 1-2. ✓
- **§5 API (CRUD dono + resolve público)** → Task 1 Steps 3-5. ✓
- **§6 QR no painel (qrcode, imprimir)** → Task 2 Steps 1,3. ✓
- **§7 Sub-abas QR Code + Ver Menu (só no menu de Sala)** → Task 2 Steps 3-4. ✓
- **§8 Storefront rota /[slug]/mesa/[qrToken] (menu de Sala só leitura, "Mesa X")** → Task 3. ✓
- **§9 Testes (migração, isolamento, CRUD, rota)** → Task 1 Step 6 (e2e) + Task 4 (browser). ✓

**Consistência de tipos:** `DineTable{id,name,qrToken,active,sortOrder}` (schema ↔ hooks ↔ e2e); `resolvePublic → {id,name}` ↔ `TableInfo{id,name}` ↔ `useTable`; `useMenu(slug,'dine_in')` ↔ endpoint `?type=dine_in`.
