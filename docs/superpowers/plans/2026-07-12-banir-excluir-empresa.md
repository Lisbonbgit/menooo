# Banir/Excluir Empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ban reversível e exclusão definitiva de contas (empresas) pelo super-admin, preservando a receita da plataforma.

**Architecture:** Migração aditiva no Prisma (AccountStatus + snapshot nos pagamentos); efeitos do ban aplicados nos três pontos existentes (gating público em subscription.util, login em auth.service, sessões via RefreshToken); endpoints novos no módulo admin; UI na ficha/lista do admin. Segue os padrões atuais (services finos, DTOs class-validator, TanStack Query no admin).

**Tech Stack:** NestJS 10 + Prisma 6 + Postgres; Next 15 + TanStack Query (admin). E2e com embedded-postgres (`db:serve`) + scripts .mjs.

## Global Constraints

- Migração aditiva com backfill — nunca perder `SubscriptionPayment` existentes.
- Mensagens de erro em PT-PT: `"Banir a empresa primeiro."`, `"Conta banida. Contacta o suporte."`
- Verificação por tarefa: `pnpm --filter @comanda/api typecheck && pnpm --filter @comanda/admin typecheck` (+ build no fim).

---

### Task 1: Migração Prisma

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (Account, SubscriptionPayment, enum)
- Create: `apps/api/prisma/migrations/20260712200000_account_ban_delete/migration.sql`

**Interfaces:**
- Produces: `AccountStatus` enum (`ACTIVE`/`BANNED`), `Account.status/bannedAt`, `SubscriptionPayment.accountId String?` (SetNull) + `accountName String?`.

- [ ] Schema: `enum AccountStatus { ACTIVE BANNED }`; em `Account`: `status AccountStatus @default(ACTIVE)` e `bannedAt DateTime?`; em `SubscriptionPayment`: `accountId String?`, `account Account? @relation(..., onDelete: SetNull)`, `accountName String?`.
- [ ] SQL da migração (escrever à mão, padrão das anteriores):

```sql
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'BANNED');
ALTER TABLE "Account" ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
                      ADD COLUMN "bannedAt" TIMESTAMP(3);
ALTER TABLE "SubscriptionPayment" ADD COLUMN "accountName" TEXT;
UPDATE "SubscriptionPayment" sp SET "accountName" = a."name"
  FROM "Account" a WHERE a."id" = sp."accountId";
ALTER TABLE "SubscriptionPayment" ALTER COLUMN "accountId" DROP NOT NULL;
ALTER TABLE "SubscriptionPayment" DROP CONSTRAINT "SubscriptionPayment_accountId_fkey";
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] `pnpm --filter @comanda/api exec prisma generate` e typecheck.
- [ ] Commit: `git commit -m "Migração: AccountStatus (ban) + pagamentos sobrevivem à exclusão"`.

### Task 2: API — ban/unban, delete, efeitos

**Files:**
- Modify: `apps/api/src/modules/admin/admin.controller.ts` (+2 endpoints)
- Modify: `apps/api/src/modules/admin/admin.service.ts` (banAccount, deleteAccount; listas incluem account)
- Create: `apps/api/src/modules/admin/dto/ban.dto.ts` (`{ banned: boolean }`)
- Modify: `apps/api/src/modules/auth/auth.service.ts` (login: conta BANNED → 403)
- Modify: `apps/api/src/modules/tenants/subscription.util.ts` (isSubscriptionUsable: BANNED → false)
- Modify: `apps/api/src/modules/admin/admin.service.ts` registo manual de pagamento + `apps/api/src/modules/billing/billing.service.ts` (invoice.paid): gravar `accountName`

**Interfaces:**
- Produces: `PATCH /admin/accounts/:id/ban {banned}` → account atualizado; `DELETE /admin/accounts/:id` → `{ deleted: true }` ou 409; `GET /admin/tenants(/: id)` passam a devolver `account: {id,name,status,bannedAt}`.

- [ ] `banAccount(id, banned)`: update status/bannedAt; se banned, `refreshToken.deleteMany({ where: { user: { accountId: id } } })` numa transação.
- [ ] `deleteAccount(id)`: `findUniqueOrThrow`; se `status !== 'BANNED'` → `ConflictException('Banir a empresa primeiro.')`; senão `account.delete` (cascade).
- [ ] Login: carregar `include: { account: true }`; se `user.account?.status === 'BANNED'` → `ForbiddenException('Conta banida. Contacta o suporte.')`.
- [ ] `isSubscriptionUsable`: primeiro `if (account.status === 'BANNED') return false;` (todos os call-sites já passam a conta).
- [ ] Pagamentos: nos dois pontos que criam `SubscriptionPayment`, acrescentar `accountName: account.name`.
- [ ] Typecheck api; commit: `git commit -m "Admin: banir/reativar e excluir empresa (API + efeitos)"`.

### Task 3: Admin UI

**Files:**
- Modify: `apps/admin/src/app/tenants/page.tsx` (ou componente da ficha/list — confirmar nomes reais ao abrir)
- Modify: hooks de dados do admin (adicionar mutações ban/delete)

**Interfaces:**
- Consumes: endpoints da Task 2.

- [ ] Ficha: secção "Empresa" (nome da conta + estado); botões `Banir empresa`/`Reativar empresa`; quando BANNED, botão vermelho `Excluir definitivamente` → modal com aviso e input que só ativa o botão quando o texto = nome da conta; sucesso fecha modal, invalida queries e toast.
- [ ] Lista: chip vermelho `banida` junto ao nome quando `account.status === 'BANNED'`.
- [ ] Typecheck admin + verificação visual no browser (dev server, conta demo local).
- [ ] Commit: `git commit -m "Admin UI: secção Empresa — banir, reativar, excluir"`.

### Task 4: E2e + verificação final

**Files:**
- Create: script e2e no scratchpad (padrão dos anteriores, contra `db:serve` + api local)

- [ ] Cenários: (1) ban → login 403 + loja 404 + refresh falha; (2) unban → tudo volta; (3) delete sem ban → 409; (4) ban+delete → tenants/users desaparecem, payments ficam com accountName e accountId null; (5) OWNER a chamar ban/delete → 403.
- [ ] `pnpm --filter @comanda/api build && pnpm --filter @comanda/admin build`.
- [ ] Revisão multi-agente do diff; aplicar achados confirmados.
- [ ] Commit final.
