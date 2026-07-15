# App de Cozinha — Fase 1: Backend (papel KITCHEN + emparelhamento) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Papel `KITCHEN` restrito e preso a uma unidade, com emparelhamento por código de uso-único e sessões revogáveis — a fundação backend da app de cozinha (spec: `docs/superpowers/specs/2026-07-15-app-cozinha-impressao-tcp-design.md`).

**Architecture:** Migração aditiva (enum + colunas de pin/emparelhamento), matriz `@Roles` por método (o `getAllAndOverride` do RolesGuard faz o método sobrepor a classe), endpoints de emparelhamento do dono no módulo tenants e o endpoint público de pair no módulo auth (reutiliza `issueTokens`/refresh existentes). Nenhuma UI usa isto ainda — pode ir para produção "às escuras".

**Tech Stack:** NestJS 10, Prisma 6 + PostgreSQL (embedded-postgres local), argon2, @nestjs/throttler, socket.io.

## Global Constraints

- Copy sempre em PT-PT; erros de emparelhamento são NEUTROS: `'Código inválido ou expirado.'` (nunca revelar qual verificação falhou).
- Migração APENAS aditiva (nada de drop/rename); em produção correr `pg_dump` antes (padrão do projeto).
- `@Roles` de KITCHEN sempre ao NÍVEL DO MÉTODO — nunca alargar um `@Roles` de classe.
- Node/pnpm: usar `PATH="$HOME/.local/node/bin:$PATH"` em todos os comandos.
- Working dir: `/Users/matheus.moraes/dev/comanda` (nunca OneDrive).
- Ramo de trabalho: `matheus-app-cozinha` (já existe). Commits pequenos por task.

## Pré-requisito: stack local a correr

Antes da Task 1 (e para todas as verificações):

```bash
# terminal 1 (fica vivo) — Postgres embebido + migra + semeia
cd /Users/matheus.moraes/dev/comanda/apps/api && PATH="$HOME/.local/node/bin:$PATH" node scripts/embedded-db.mjs serve
# terminal 2 (fica vivo) — API em watch
cd /Users/matheus.moraes/dev/comanda/apps/api && PATH="$HOME/.local/node/bin:$PATH" pnpm dev
```

Saúde: `curl -s http://localhost:3001/api/health` → `{"status":"ok","db":"up",...}`.
Seed: owner `dono@pizzaria-demo.pt` / `demo1234` (loja `pizzaria-demo`); super-admin `admin@menooo.pt` / `admin1234`.

---

### Task 1: Schema — enum KITCHEN, pin do utilizador e campos de emparelhamento

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum `UserRole`, model `User`, model `Tenant`)
- Create: `apps/api/prisma/migrations/<timestamp>_kitchen_role_pairing/` (gerada pelo Prisma)

**Interfaces:**
- Produces: `UserRole.KITCHEN`; `User.kitchenTenantId: string | null`; `Tenant.kitchenPairId/kitchenPairHash/kitchenPairExpiresAt/kitchenPairAttempts/kitchenPairedAt`.

- [ ] **Step 1: Editar o enum `UserRole`** em `apps/api/prisma/schema.prisma`:

```prisma
enum UserRole {
  SUPER_ADMIN // dono da plataforma (sem tenant)
  OWNER // dono do restaurante
  STAFF // funcionário do restaurante
  KITCHEN // tablet de cozinha emparelhado a UMA unidade (só pedidos)
}
```

- [ ] **Step 2: Adicionar o pin ao model `User`** — inserir depois da linha `passwordResetAttempts  Int       @default(0)`:

```prisma
  // papel KITCHEN: unidade a que o tablet está preso (null para os outros papéis)
  kitchenTenantId String?
```

E acrescentar aos índices do model (junto de `@@index([email])`):

```prisma
  @@index([kitchenTenantId])
```

- [ ] **Step 3: Adicionar os campos de emparelhamento ao model `Tenant`** — inserir depois de `isOpen          Boolean  @default(false) // toggle manual de aberto/fechado`:

```prisma
  // emparelhamento do tablet de cozinha (código de uso-único, ver spec app-cozinha)
  kitchenPairId        String?   @unique // parte pública do código (lookup indexado)
  kitchenPairHash      String? // argon2 do segredo do código
  kitchenPairExpiresAt DateTime?
  kitchenPairAttempts  Int       @default(0)
  kitchenPairedAt      DateTime? // último emparelhamento bem-sucedido
```

- [ ] **Step 4: Gerar e aplicar a migração** (com a DB embebida a correr):

```bash
cd /Users/matheus.moraes/dev/comanda/apps/api && PATH="$HOME/.local/node/bin:$PATH" npx prisma migrate dev --name kitchen_role_pairing
```

Expected: `Your database is now in sync with your schema.` e nova pasta em `prisma/migrations/`.

- [ ] **Step 5: Verificar que a migração é aditiva** — abrir o `migration.sql` gerado e confirmar que só contém `ALTER TYPE ... ADD VALUE`, `ALTER TABLE ... ADD COLUMN` e `CREATE (UNIQUE) INDEX`. Nada de `DROP`.

- [ ] **Step 6: Typecheck e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/api typecheck
git add apps/api/prisma && git commit -m "feat(api): papel KITCHEN + campos de emparelhamento (migração aditiva)"
```

---

### Task 2: Util partilhado do código de emparelhamento

**Files:**
- Create: `apps/api/src/common/kitchen-pair.util.ts`

**Interfaces:**
- Produces: `generatePairCode(): { id: string; secret: string; display: string }`, `normalizePairCode(raw: string): string`, `splitPairCode(normalized: string): { id: string; secret: string } | null`, `PAIR_CODE_TTL_MS`.
- Formato: alfabeto base32 `A–Z2–7`; `id` = 4 chars (lookup), `secret` = 8 chars (40 bits); display `ABCD-EFGH-JKLM`. Input normalizado: maiúsculas, `0→O`, `1→I`, remove tudo fora do alfabeto.

- [ ] **Step 1: Criar o ficheiro completo**

```ts
import { randomInt } from 'crypto';

// Código de emparelhamento do tablet de cozinha: <id 4><segredo 8> em base32
// (A–Z2–7). O id é público (lookup indexado — evita varrer tenants e correr
// argon2 em todos); o segredo tem 8×5 = 40 bits de entropia.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ID_LEN = 4;
const SECRET_LEN = 8;

export const PAIR_CODE_TTL_MS = 10 * 60 * 1000; // validade do código

function randomChars(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function generatePairCode(): { id: string; secret: string; display: string } {
  const id = randomChars(ID_LEN);
  const secret = randomChars(SECRET_LEN);
  const raw = id + secret;
  const display = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  return { id, secret, display };
}

/** Maiúsculas, corrige 0→O e 1→I, remove separadores e tudo fora do alfabeto. */
export function normalizePairCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/[^A-Z2-7]/g, '');
}

export function splitPairCode(normalized: string): { id: string; secret: string } | null {
  if (normalized.length !== ID_LEN + SECRET_LEN) return null;
  return { id: normalized.slice(0, ID_LEN), secret: normalized.slice(ID_LEN) };
}
```

- [ ] **Step 2: Typecheck e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/api typecheck
git add apps/api/src/common/kitchen-pair.util.ts && git commit -m "feat(api): util do código de emparelhamento da cozinha"
```

---

### Task 3: Sessão — TTLs por papel, pin no refresh, deteção de reutilização, switch restrito

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts` (métodos `issueTokens`, `createRefreshToken`, `refresh`)
- Modify: `apps/api/src/modules/auth/auth.controller.ts` (método `switchTenant`)

**Interfaces:**
- Consumes: `User.kitchenTenantId` (Task 1).
- Produces: `issueTokens` com TTLs por papel (`KITCHEN_ACCESS_TTL` default `'5m'`, `KITCHEN_REFRESH_TTL` default `'5d'`); `refresh()` que fixa a unidade para KITCHEN e revoga a família em reutilização; `/auth/switch` recusa KITCHEN (403).

- [ ] **Step 1: Substituir `issueTokens` e `createRefreshToken`** em `auth.service.ts`. O `issueTokens` atual assina sempre com `JWT_ACCESS_TTL ?? '15m'` e chama `createRefreshToken(user.id)` (que calcula o TTL internamente). Substituir por:

```ts
  private async issueTokens(user: User, activeTenantId: string | null) {
    const payload = {
      sub: user.id,
      accountId: user.accountId,
      tenantId: activeTenantId,
      email: user.email,
      role: user.role,
    };
    // TTLs mais curtos para a cozinha: o tablet é partilhado e a revogação
    // ("desemparelhar") só faz efeito quando o access token expira.
    const isKitchen = user.role === UserRole.KITCHEN;
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      expiresIn: isKitchen
        ? (process.env.KITCHEN_ACCESS_TTL ?? '5m')
        : (process.env.JWT_ACCESS_TTL ?? '15m'),
    });
    const refreshTtlMs = parseDurationMs(
      isKitchen
        ? (process.env.KITCHEN_REFRESH_TTL ?? '5d')
        : (process.env.JWT_REFRESH_TTL ?? '7d'),
    );
    const refreshToken = await this.createRefreshToken(user.id, refreshTtlMs);
    return { accessToken, refreshToken };
  }

  /**
   * Cria um refresh token opaco no formato `<id>.<segredo>`. Guardamos só o hash
   * do segredo (argon2) — o valor em claro nunca fica na base de dados.
   */
  private async createRefreshToken(userId: string, ttlMs: number): Promise<string> {
    const secret = randomBytes(32).toString('hex');
    const row = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: await argon2.hash(secret),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return `${row.id}.${secret}`;
  }
```

- [ ] **Step 2: Substituir o corpo de `refresh()`** (mantém a assinatura `refresh(refreshToken: string, tenantId?: string)`):

```ts
  async refresh(refreshToken: string, tenantId?: string) {
    const parsed = this.parseRefreshToken(refreshToken);
    if (!parsed) throw new UnauthorizedException('Sessão inválida.');

    const row = await this.prisma.refreshToken.findUnique({ where: { id: parsed.id } });
    if (!row) throw new UnauthorizedException('Sessão inválida.');

    // Reutilização de um token JÁ rodado = cópia roubada ou replay: corta a
    // família inteira do utilizador e obriga a nova autenticação.
    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sessão expirada. Inicia sessão novamente.');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Sessão expirada. Inicia sessão novamente.');
    }
    const ok = await argon2.verify(row.tokenHash, parsed.secret).catch(() => false);
    if (!ok) throw new UnauthorizedException('Sessão inválida.');

    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user) throw new UnauthorizedException('Sessão inválida.');
    await this.assertAccountNotBanned(user.accountId);

    // roda: o refresh token só vale uma vez
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });

    // KITCHEN está PRESO à unidade emparelhada — ignora o tenantId do cliente.
    const activeTenantId =
      user.role === UserRole.KITCHEN
        ? (user.kitchenTenantId ?? null)
        : await this.resolveTenantId(user, tenantId);
    const tokens = await this.issueTokens(user, activeTenantId);
    return { user: this.sanitizeUser(user), ...tokens };
  }
```

- [ ] **Step 3: Restringir `/auth/switch`** em `auth.controller.ts` — adicionar imports e decorators ao método `switchTenant`:

```ts
// juntar aos imports existentes:
import { UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
```

```ts
  /** Troca a unidade ativa da sessão (devolve novo token). KITCHEN está preso à sua unidade. */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)
  @Post('switch')
  switchTenant(@CurrentUser() user: AuthenticatedUser, @Body() dto: SwitchTenantDto) {
    return this.auth.switchTenant(user, dto.tenantId);
  }
```

- [ ] **Step 4: Documentar as envs novas** — em `.env.production.example` (raiz do repo), junto de `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, acrescentar:

```bash
# Cozinha (tablet emparelhado) — TTLs mais curtos; defaults no código se ausentes
# KITCHEN_ACCESS_TTL=5m
# KITCHEN_REFRESH_TTL=5d
```

- [ ] **Step 5: Typecheck, verificação manual de regressão e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/api typecheck
# regressão: login + refresh continuam a funcionar para OWNER
curl -s -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"dono@pizzaria-demo.pt","password":"demo1234"}' | head -c 200; echo
```

Expected: typecheck limpo; login devolve `accessToken` e `refreshToken`.

```bash
git add apps/api/src/modules/auth .env.production.example
git commit -m "feat(api): TTLs por papel, pin de unidade no refresh, deteção de reutilização, switch sem KITCHEN"
```

---

### Task 4: Matriz de permissões — KITCHEN só em pedidos e leitura da loja

**Files:**
- Modify: `apps/api/src/modules/orders/orders.controller.ts`
- Modify: `apps/api/src/modules/tenants/tenants.controller.ts`

**Interfaces:**
- Consumes: `UserRole.KITCHEN` (Task 1). Semântica do RolesGuard: `getAllAndOverride` → `@Roles` no MÉTODO sobrepõe o da classe.
- Produces: KITCHEN com 200 em `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status`, `GET /tenants/me`, `GET /tenants/me/hours`; 403 em todo o resto (incl. `GET /orders/summary`).

- [ ] **Step 1: `orders.controller.ts`** — manter a classe como está (`@Roles(OWNER, STAFF)` é o default) e SOBREPOR nos três métodos da cozinha:

```ts
  // KITCHEN (tablet de cozinha) só vê e avança pedidos. O @Roles no método
  // SOBREPÕE o da classe (getAllAndOverride) — /orders/summary fica de fora
  // de propósito (receita é só para OWNER/STAFF).
  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.KITCHEN)
  @Get()
  list(@TenantId() tenantId: string) {
    return this.orders.listForTenant(tenantId);
  }
```

```ts
  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.KITCHEN)
  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.getForTenant(tenantId, id);
  }
```

```ts
  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.KITCHEN)
  @Patch(':id/status')
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.orders.updateStatus(tenantId, id, dto.status);
  }
```

(`summary` fica intocado — herda `@Roles(OWNER, STAFF)` da classe.)

- [ ] **Step 2: `tenants.controller.ts`** — acrescentar KITCHEN só a `getMine` e `getHours` (leitura do nome/horas para o talão):

```ts
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.KITCHEN)
  @Get('tenants/me')
  getMine(@TenantId() tenantId: string) {
    return this.tenants.getMine(tenantId);
  }
```

```ts
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF, UserRole.KITCHEN)
  @Get('tenants/me/hours')
  getHours(@TenantId() tenantId: string) {
    return this.tenants.getMyHours(tenantId);
  }
```

**NÃO tocar** em: `listMine` (`/tenants/mine`), `create`, `updateMine`, `setHours` — ficam sem KITCHEN.

- [ ] **Step 3: Typecheck e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/api typecheck
git add apps/api/src/modules/orders/orders.controller.ts apps/api/src/modules/tenants/tenants.controller.ts
git commit -m "feat(api): matriz @Roles com KITCHEN (pedidos + leitura da loja, por método)"
```

---

### Task 5: Gateway — papel no socket + desligar sockets da cozinha

**Files:**
- Modify: `apps/api/src/modules/orders/orders.gateway.ts`
- Modify: `apps/api/src/modules/orders/orders.module.ts` (exportar o gateway)

**Interfaces:**
- Produces: `OrdersGateway.disconnectKitchen(tenantId: string): Promise<void>`; `client.data.role` preenchido no handshake. `OrdersModule` exporta `OrdersGateway`.

- [ ] **Step 1: Guardar o papel no socket e adicionar `disconnectKitchen`** em `orders.gateway.ts` — no `handleConnection`, antes do `client.join(...)`, acrescentar `client.data.role = payload.role;` e adicionar o método:

```ts
  /** Valida o JWT do handshake e junta o cliente à sala do seu tenant. */
  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ??
        (client.handshake.headers.authorization ?? '').replace('Bearer ', '');
      const payload = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      });
      if (!payload?.tenantId) {
        client.disconnect();
        return;
      }
      client.data.role = payload.role; // usado por disconnectKitchen no desemparelhar
      client.join(room(payload.tenantId));
    } catch {
      client.disconnect();
    }
  }

  /** Desliga os sockets de cozinha de uma unidade (chamado ao desemparelhar). */
  async disconnectKitchen(tenantId: string) {
    const sockets = await this.server.in(room(tenantId)).fetchSockets();
    for (const s of sockets) {
      if (s.data.role === 'KITCHEN') s.disconnect(true);
    }
  }
```

- [ ] **Step 2: Exportar o gateway** em `orders.module.ts`:

```ts
  exports: [OrdersService, OrdersGateway],
```

- [ ] **Step 3: Typecheck e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/api typecheck
git add apps/api/src/modules/orders && git commit -m "feat(api): gateway guarda o papel e desliga sockets de cozinha"
```

---

### Task 6: Endpoints do dono — gerar código, estado, desemparelhar

**Files:**
- Modify: `apps/api/src/modules/tenants/tenants.service.ts`
- Modify: `apps/api/src/modules/tenants/tenants.controller.ts`
- Modify: `apps/api/src/modules/tenants/tenants.module.ts` (importar OrdersModule)

**Interfaces:**
- Consumes: `generatePairCode`/`PAIR_CODE_TTL_MS` (Task 2); `OrdersGateway.disconnectKitchen` (Task 5); campos `Tenant.kitchenPair*` (Task 1).
- Produces (todos OWNER):
  - `POST /tenants/me/kitchen/pair-code` → `{ code: string, expiresAt: string }`
  - `GET /tenants/me/kitchen` → `{ paired: boolean, pairedAt: string|null, activeSessions: number, pendingCode: boolean }`
  - `DELETE /tenants/me/kitchen` → `{ ok: true }` (revoga sessões + limpa código pendente + desliga sockets)

- [ ] **Step 1: `tenants.module.ts`** — importar o OrdersModule:

```ts
import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
```

*(Se o Nest acusar dependência circular — OrdersModule importa PromotionsModule; se este importar TenantsModule — usar `forwardRef(() => OrdersModule)` dos dois lados. À data, não há ciclo.)*

- [ ] **Step 2: `tenants.service.ts`** — acrescentar imports e os três métodos:

```ts
// juntar aos imports existentes:
import * as argon2 from 'argon2';
import { UserRole, Prisma } from '@prisma/client';
import { OrdersGateway } from '../orders/orders.gateway';
import { generatePairCode, PAIR_CODE_TTL_MS } from '../../common/kitchen-pair.util';
```

Injetar o gateway no constructor (juntar ao `PrismaService` existente):

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersGateway: OrdersGateway,
  ) {}
```

Métodos novos (no fim da classe):

```ts
  /** Gera um código de emparelhamento de uso-único para o tablet de cozinha. */
  async generateKitchenPairCode(tenantId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { id, secret, display } = generatePairCode();
      const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MS);
      try {
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: {
            kitchenPairId: id,
            kitchenPairHash: await argon2.hash(secret),
            kitchenPairExpiresAt: expiresAt,
            kitchenPairAttempts: 0,
          },
        });
        return { code: display, expiresAt: expiresAt.toISOString() };
      } catch (e) {
        // colisão do id público (unique) — tenta outro
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new Error('Não foi possível gerar o código. Tenta novamente.');
  }

  /** Estado do emparelhamento da cozinha desta unidade. */
  async kitchenStatus(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const kitchenUser = await this.prisma.user.findFirst({
      where: { kitchenTenantId: tenantId, role: UserRole.KITCHEN },
    });
    const activeSessions = kitchenUser
      ? await this.prisma.refreshToken.count({
          where: { userId: kitchenUser.id, revokedAt: null, expiresAt: { gt: new Date() } },
        })
      : 0;
    return {
      paired: activeSessions > 0,
      pairedAt: tenant.kitchenPairedAt?.toISOString() ?? null,
      activeSessions,
      pendingCode:
        !!tenant.kitchenPairHash &&
        !!tenant.kitchenPairExpiresAt &&
        tenant.kitchenPairExpiresAt.getTime() > Date.now(),
    };
  }

  /** Desemparelha a cozinha: revoga sessões, limpa código pendente, desliga sockets. */
  async unpairKitchen(tenantId: string) {
    const kitchenUsers = await this.prisma.user.findMany({
      where: { kitchenTenantId: tenantId, role: UserRole.KITCHEN },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: { userId: { in: kitchenUsers.map((u) => u.id) } },
      }),
      this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          kitchenPairId: null,
          kitchenPairHash: null,
          kitchenPairExpiresAt: null,
          kitchenPairAttempts: 0,
        },
      }),
    ]);
    await this.ordersGateway.disconnectKitchen(tenantId);
    return { ok: true };
  }
```

- [ ] **Step 3: `tenants.controller.ts`** — acrescentar `Delete` ao import de `@nestjs/common` e os três endpoints (depois de `setHours`):

```ts
  /** Gera o código de emparelhamento do tablet de cozinha (uso-único, ~10 min). */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @Post('tenants/me/kitchen/pair-code')
  kitchenPairCode(@TenantId() tenantId: string) {
    return this.tenants.generateKitchenPairCode(tenantId);
  }

  /** Estado do emparelhamento da cozinha. */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @Get('tenants/me/kitchen')
  kitchenStatus(@TenantId() tenantId: string) {
    return this.tenants.kitchenStatus(tenantId);
  }

  /** Desemparelha o tablet de cozinha (revoga as sessões). */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @Delete('tenants/me/kitchen')
  kitchenUnpair(@TenantId() tenantId: string) {
    return this.tenants.unpairKitchen(tenantId);
  }
```

- [ ] **Step 4: Typecheck, smoke test e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/api typecheck
# smoke: login owner → gerar código → estado
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"email":"dono@pizzaria-demo.pt","password":"demo1234"}' | PATH="$HOME/.local/node/bin:$PATH" node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).accessToken))")
curl -s -X POST http://localhost:3001/api/tenants/me/kitchen/pair-code -H "Authorization: Bearer $TOKEN"; echo
curl -s http://localhost:3001/api/tenants/me/kitchen -H "Authorization: Bearer $TOKEN"; echo
```

Expected: `{"code":"XXXX-XXXX-XXXX","expiresAt":"..."}` e `{"paired":false,...,"pendingCode":true}`.

```bash
git add apps/api/src/modules/tenants && git commit -m "feat(api): endpoints do dono p/ emparelhar cozinha (gerar código, estado, desemparelhar)"
```

---

### Task 7: Endpoint público de emparelhamento — `POST /auth/kitchen/pair`

**Files:**
- Create: `apps/api/src/modules/auth/dto/kitchen-pair.dto.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts` (método `kitchenPair`)
- Modify: `apps/api/src/modules/auth/auth.controller.ts` (rota)

**Interfaces:**
- Consumes: `normalizePairCode`/`splitPairCode` (Task 2); `issueTokens` (Task 3); campos Task 1.
- Produces: `POST /auth/kitchen/pair { code }` → `{ tenant: {id,name,slug}, user, accessToken, refreshToken }`; 401 neutro em qualquer falha; lockout aos 5 erros; uso-único; throttle 30/min.

- [ ] **Step 1: DTO** — criar `kitchen-pair.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class KitchenPairDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;
}
```

- [ ] **Step 2: `auth.service.ts`** — juntar ao import do util e adicionar o método (depois de `logout`):

```ts
// juntar aos imports existentes:
import { normalizePairCode, splitPairCode } from '../../common/kitchen-pair.util';
```

```ts
  /**
   * Emparelha um tablet de cozinha com um código de uso-único. Resposta NEUTRA
   * para qualquer falha — não revela se o código existe, expirou ou está errado.
   */
  async kitchenPair(rawCode: string) {
    const invalid = () => new UnauthorizedException('Código inválido ou expirado.');
    const parsed = splitPairCode(normalizePairCode(rawCode));
    if (!parsed) throw invalid();

    const tenant = await this.prisma.tenant.findUnique({
      where: { kitchenPairId: parsed.id },
    });
    if (!tenant || !tenant.kitchenPairHash || !tenant.kitchenPairExpiresAt) throw invalid();
    if (tenant.kitchenPairExpiresAt.getTime() < Date.now()) throw invalid();
    if (tenant.kitchenPairAttempts >= MAX_ATTEMPTS) throw invalid();

    const ok = await argon2.verify(tenant.kitchenPairHash, parsed.secret).catch(() => false);
    if (!ok) {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { kitchenPairAttempts: { increment: 1 } },
      });
      throw invalid();
    }

    await this.assertAccountNotBanned(tenant.accountId);

    // uso-único: consome o código no primeiro sucesso
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        kitchenPairId: null,
        kitchenPairHash: null,
        kitchenPairExpiresAt: null,
        kitchenPairAttempts: 0,
        kitchenPairedAt: new Date(),
      },
    });

    // um utilizador KITCHEN por unidade — reutiliza se já existir
    let user = await this.prisma.user.findFirst({
      where: { kitchenTenantId: tenant.id, role: UserRole.KITCHEN },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          accountId: tenant.accountId,
          // email sintético único por unidade; nunca colide com emails reais
          email: `kitchen-${tenant.id}@menooo.local`,
          // password aleatória não-conhecível — este utilizador não faz login por password
          passwordHash: await argon2.hash(randomBytes(32).toString('hex')),
          name: 'Cozinha',
          role: UserRole.KITCHEN,
          kitchenTenantId: tenant.id,
          emailVerifiedAt: new Date(),
        },
      });
    }

    const tokens = await this.issueTokens(user, tenant.id);
    return {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }
```

- [ ] **Step 3: Rota** em `auth.controller.ts` (depois de `logout`):

```ts
// juntar aos imports existentes:
import { Throttle } from '@nestjs/throttler';
import { KitchenPairDto } from './dto/kitchen-pair.dto';
```

```ts
  /** Emparelha o tablet de cozinha com um código de uso-único (throttle dedicado). */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('kitchen/pair')
  kitchenPair(@Body() dto: KitchenPairDto) {
    return this.auth.kitchenPair(dto.code);
  }
```

- [ ] **Step 4: `trust proxy`** — o throttle por IP só vê o IP real do cliente atrás do Caddy se o Express confiar no proxy. Em `apps/api/src/main.ts`, logo a seguir a `const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });`, acrescentar:

```ts
  // atrás do Caddy: o throttling por IP precisa do IP real (X-Forwarded-For)
  app.set('trust proxy', 1);
```

- [ ] **Step 5: Typecheck, smoke ponta-a-ponta e commit**

```bash
cd /Users/matheus.moraes/dev/comanda && PATH="$HOME/.local/node/bin:$PATH" pnpm --filter @comanda/api typecheck
# gerar código como owner e emparelhar
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"email":"dono@pizzaria-demo.pt","password":"demo1234"}' | PATH="$HOME/.local/node/bin:$PATH" node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).accessToken))")
CODE=$(curl -s -X POST http://localhost:3001/api/tenants/me/kitchen/pair-code -H "Authorization: Bearer $TOKEN" | PATH="$HOME/.local/node/bin:$PATH" node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).code))")
echo "code: $CODE"
curl -s -X POST http://localhost:3001/api/auth/kitchen/pair -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}" | head -c 300; echo
```

Expected: resposta com `tenant`, `user` (role `KITCHEN`), `accessToken`, `refreshToken`.

```bash
git add apps/api/src/modules/auth apps/api/src/main.ts
git commit -m "feat(api): emparelhamento público da cozinha (uso-único, lockout, throttle, erros neutros)"
```

---

### Task 8: E2e completo — `apps/api/scripts/e2e-kitchen.mjs`

**Files:**
- Create: `apps/api/scripts/e2e-kitchen.mjs`

**Interfaces:**
- Consumes: todos os endpoints das Tasks 3–7; seed demo (`dono@pizzaria-demo.pt`/`demo1234`, loja `pizzaria-demo`).
- Produces: script executável `node scripts/e2e-kitchen.mjs` que sai com código 0 (tudo verde) ou 1.

- [ ] **Step 1: Criar o script completo**

```js
/**
 * E2e do papel KITCHEN + emparelhamento (Fase 1 da app de cozinha).
 * Requer a stack local: embedded-db (serve) + API em http://localhost:3001.
 *   node scripts/e2e-kitchen.mjs
 */
const BASE = process.env.API_URL ?? 'http://localhost:3001/api';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* respostas vazias */
  }
  return { status: res.status, json };
}

function jwtPayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

// procura recursivamente objetos que pareçam produtos (id + name + price-like)
function findProducts(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => findProducts(n, out));
  else if (node && typeof node === 'object') {
    if (node.id && node.name && ('price' in node || 'basePrice' in node)) out.push(node);
    Object.values(node).forEach((v) => findProducts(v, out));
  }
  return out;
}

async function main() {
  console.log('— login do dono');
  const owner = await req('POST', '/auth/login', {
    body: { email: 'dono@pizzaria-demo.pt', password: 'demo1234' },
  });
  check('owner login 201', owner.status === 201, `got ${owner.status}`);
  const ownerToken = owner.json.accessToken;

  console.log('— lockout: 5 tentativas erradas bloqueiam o código');
  const gen1 = await req('POST', '/tenants/me/kitchen/pair-code', { token: ownerToken });
  check('gerar código 201', gen1.status === 201, `got ${gen1.status}`);
  const code1 = gen1.json.code;
  const wrong = code1.slice(0, -4) + (code1.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  for (let i = 0; i < 5; i++) {
    const r = await req('POST', '/auth/kitchen/pair', { body: { code: wrong } });
    check(`tentativa errada ${i + 1} → 401`, r.status === 401, `got ${r.status}`);
  }
  const lockedTry = await req('POST', '/auth/kitchen/pair', { body: { code: code1 } });
  check('código certo mas bloqueado → 401', lockedTry.status === 401, `got ${lockedTry.status}`);

  console.log('— emparelhar com código novo');
  const gen2 = await req('POST', '/tenants/me/kitchen/pair-code', { token: ownerToken });
  const pair = await req('POST', '/auth/kitchen/pair', { body: { code: gen2.json.code } });
  check('pair 201', pair.status === 201, `got ${pair.status} ${JSON.stringify(pair.json)}`);
  check('role KITCHEN', pair.json?.user?.role === 'KITCHEN');
  check('tem refreshToken', !!pair.json?.refreshToken);
  const kToken = pair.json.accessToken;
  const kRefresh1 = pair.json.refreshToken;
  const pairedTenantId = pair.json.tenant.id;

  console.log('— uso-único: reusar o mesmo código falha');
  const reuse = await req('POST', '/auth/kitchen/pair', { body: { code: gen2.json.code } });
  check('reuso do código → 401', reuse.status === 401, `got ${reuse.status}`);

  console.log('— código minúsculas/sem hífens também funciona (normalização)');
  const gen3 = await req('POST', '/tenants/me/kitchen/pair-code', { token: ownerToken });
  const sloppy = gen3.json.code.toLowerCase().replaceAll('-', '');
  const pairSloppy = await req('POST', '/auth/kitchen/pair', { body: { code: sloppy } });
  check('pair com código "sujo" 201', pairSloppy.status === 201, `got ${pairSloppy.status}`);

  console.log('— matriz de permissões do KITCHEN');
  const matrix = [
    ['GET', '/orders', 200],
    ['GET', '/tenants/me', 200],
    ['GET', '/tenants/me/hours', 200],
    ['GET', '/orders/summary', 403],
    ['GET', '/tenants/mine', 403],
    ['PATCH', '/tenants/me', 403],
    ['POST', '/tenants', 403],
    ['PUT', '/tenants/me/hours', 403],
    ['POST', '/auth/switch', 403],
    ['GET', '/tenants/me/kitchen', 403],
    ['POST', '/tenants/me/kitchen/pair-code', 403],
    ['DELETE', '/tenants/me/kitchen', 403],
  ];
  for (const [method, path, expected] of matrix) {
    const r = await req(method, path, {
      token: kToken,
      body: method === 'GET' ? undefined : { name: 'x', slug: 'x', tenantId: 'x', hours: [] },
    });
    check(`${method} ${path} → ${expected}`, r.status === expected, `got ${r.status}`);
  }

  console.log('— KITCHEN avança um pedido (fluxo principal da cozinha)');
  const store = await req('GET', '/public/stores/pizzaria-demo');
  const product = findProducts(store.json)[0];
  check('há produto na loja pública', !!product);
  if (product) {
    const created = await req('POST', '/public/stores/pizzaria-demo/orders', {
      body: {
        items: [{ productId: product.id, quantity: 1 }],
        type: 'PICKUP',
        customerName: 'Teste Cozinha',
        customerPhone: '912345678',
        paymentMethod: 'CASH',
      },
    });
    check('pedido público criado 201', created.status === 201, `got ${created.status} ${JSON.stringify(created.json)}`);
    if (created.status === 201) {
      const orderId = created.json.id;
      const upd = await req('PATCH', `/orders/${orderId}/status`, {
        token: kToken,
        body: { status: 'ACCEPTED' },
      });
      check('KITCHEN PATCH status → 200', upd.status === 200, `got ${upd.status}`);
    }
  }

  console.log('— pin de unidade: refresh ignora tenantId de outra unidade');
  const unit2 = await req('POST', '/tenants', {
    token: ownerToken,
    body: { name: 'Unidade Teste Cozinha', slug: `un-teste-coz-${Date.now()}` },
  });
  check('2ª unidade criada 201', unit2.status === 201, `got ${unit2.status}`);
  const ref1 = await req('POST', '/auth/refresh', {
    body: { refreshToken: kRefresh1, tenantId: unit2.json?.id },
  });
  check('refresh do KITCHEN 201', ref1.status === 201, `got ${ref1.status}`);
  const pinned = jwtPayload(ref1.json.accessToken).tenantId;
  check('token continua preso à unidade emparelhada', pinned === pairedTenantId, `got ${pinned}`);
  const kRefresh2 = ref1.json.refreshToken;

  console.log('— reutilização de refresh revoga a família');
  const replay = await req('POST', '/auth/refresh', { body: { refreshToken: kRefresh1 } });
  check('replay do refresh antigo → 401', replay.status === 401, `got ${replay.status}`);
  const familyDead = await req('POST', '/auth/refresh', { body: { refreshToken: kRefresh2 } });
  check('família toda revogada → 401', familyDead.status === 401, `got ${familyDead.status}`);

  console.log('— desemparelhar corta a sessão');
  const gen4 = await req('POST', '/tenants/me/kitchen/pair-code', { token: ownerToken });
  const pair4 = await req('POST', '/auth/kitchen/pair', { body: { code: gen4.json.code } });
  check('re-pair 201', pair4.status === 201, `got ${pair4.status}`);
  const status1 = await req('GET', '/tenants/me/kitchen', { token: ownerToken });
  check('estado paired=true', status1.json?.paired === true, JSON.stringify(status1.json));
  const unpair = await req('DELETE', '/tenants/me/kitchen', { token: ownerToken });
  check('unpair 200', unpair.status === 200, `got ${unpair.status}`);
  const afterUnpair = await req('POST', '/auth/refresh', {
    body: { refreshToken: pair4.json.refreshToken },
  });
  check('refresh pós-unpair → 401', afterUnpair.status === 401, `got ${afterUnpair.status}`);
  const status2 = await req('GET', '/tenants/me/kitchen', { token: ownerToken });
  check('estado paired=false', status2.json?.paired === false, JSON.stringify(status2.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('erro fatal:', e);
  process.exit(1);
});
```

- [ ] **Step 2: Correr contra a stack local**

```bash
cd /Users/matheus.moraes/dev/comanda/apps/api && PATH="$HOME/.local/node/bin:$PATH" node scripts/e2e-kitchen.mjs
```

Expected: `N passed, 0 failed` e exit 0. Se falhar: corrigir a implementação (não o teste, salvo engano provado do teste) e repetir.

- [ ] **Step 3: Regressão dos fluxos existentes** — login/refresh de OWNER e admin continuam ok:

```bash
curl -s -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@menooo.pt","password":"admin1234"}' | head -c 120; echo
```

Expected: `accessToken` presente (SUPER_ADMIN sem tenant não é afetado).

- [ ] **Step 4: Commit**

```bash
cd /Users/matheus.moraes/dev/comanda && git add apps/api/scripts/e2e-kitchen.mjs
git commit -m "test(api): e2e do papel KITCHEN + emparelhamento (matriz, pin, reuso, unpair)"
```

---

## Notas de execução

- **Fim da fase:** ramo `matheus-app-cozinha` com todos os commits + e2e verde. Merge ao main e deploy seguem o fluxo do grupo (o deploy de produção exige que o utilizador nomeie o host explicitamente; backup pg_dump antes de `prisma migrate deploy` — a migração é aditiva mas o padrão mantém-se).
- **Envs novas (opcionais):** `KITCHEN_ACCESS_TTL` (default `5m`), `KITCHEN_REFRESH_TTL` (default `5d`) — defaults no código; adicionar ao `.env.production.example` como documentação.
- **Fases seguintes (planos próprios):** Fase 2 = modo cozinha no painel + fiabilidade (re-sync socket, token fresco, agendadas, fila "por imprimir"); Fase 3 = app Capacitor + plugin `KitchenPrinter`.
