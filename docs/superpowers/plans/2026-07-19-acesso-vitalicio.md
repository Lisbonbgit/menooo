# Acesso vitalício (admin master) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O super-admin pode dar/tirar acesso permanente ("vitalício") a uma empresa, sem depender de pagamentos ou datas.

**Architecture:** Uma flag `lifetimeAccess` na `Account`. A função pura `subscription.util` ganha o estado `LIFETIME` e passa a considerar a conta usável quando a flag está ligada (a banição continua a ganhar). Um endpoint do super-admin liga/desliga a flag; o admin master ganha um botão; o painel do dono trata o novo estado como "conta ativa".

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL (apps/api); Next.js 14 + React Query (apps/admin, apps/dashboard); Jest (unit da API).

## Global Constraints

- **PT-PT** em todo o texto visível e mensagens de erro.
- **Migração aditiva** (coluna booleana `DEFAULT false`) — nenhuma conta existente muda de comportamento; sem backfill.
- **A banição ganha sempre**: uma conta `BANNED` com `lifetimeAccess` continua sem acesso.
- **O cliente/UI envia sempre o id da CONTA** (não o do tenant) no endpoint de vitalício — como o ban já faz.
- **O amigo não vê nada de especial** no painel: o estado `LIFETIME` comporta-se como conta paga (badge "Ativa", sem banner, sem data inválida).
- **Deploy** exige o utilizador NOMEAR o host `root@187.124.4.163`; `pg_dump` antes; NUNCA correr e2e contra produção.
- **Validar por mutação**: um teste verde não vale até se o ver vermelho pela razão certa.
- Stack local: DB `:5433`, API `http://localhost:3001/api`. PATH: `export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"`.

---

## Estrutura de ficheiros

**Backend (apps/api):**
- `prisma/schema.prisma` — `Account.lifetimeAccess Boolean @default(false)`.
- `prisma/migrations/<ts>_account_lifetime_access/migration.sql` — Criar à mão (1 ALTER).
- `src/modules/tenants/subscription.util.ts` — estado `LIFETIME`, tipo, `isSubscriptionUsable`.
- `src/modules/tenants/subscription.util.spec.ts` — **Criar**: testes unitários.
- `src/modules/admin/admin.service.ts` — `setLifetimeAccess` + `lifetimeAccess` nas 2 projeções.
- `src/modules/admin/admin.controller.ts` — `PATCH accounts/:id/lifetime`.
- `src/modules/admin/dto/set-lifetime.dto.ts` — **Criar**.

**Frontend:**
- `apps/admin/src/lib/admin-hooks.ts` — tipos + `useSetLifetime`.
- `apps/admin/src/app/tenants/page.tsx` — `SubBadge` (LIFETIME) + `AccountCard` (botão + chip).
- `apps/dashboard/src/components/AppShell.tsx` e `apps/dashboard/src/lib/settings-hooks.ts` — `| 'LIFETIME'` no union.
- `apps/dashboard/src/app/settings/page.tsx` — badge LIFETIME ("Ativa").

---

## Task 1: Backend — flag, gating, migração e endpoint

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_account_lifetime_access/migration.sql`
- Modify: `apps/api/src/modules/tenants/subscription.util.ts`
- Create: `apps/api/src/modules/tenants/subscription.util.spec.ts`
- Modify: `apps/api/src/modules/admin/admin.service.ts`, `admin.controller.ts`
- Create: `apps/api/src/modules/admin/dto/set-lifetime.dto.ts`

**Interfaces:**
- Produces (para a Task 2):
  - `PATCH /admin/accounts/:id/lifetime` (corpo `{ lifetime: boolean }`) → `{ id, name, lifetimeAccess }`.
  - `computeSubscription(...).state` pode ser `'LIFETIME'`; `isSubscriptionUsable` verdadeiro para lifetime não-banido.
  - As projeções `GET /admin/tenants` e `GET /admin/tenants/:id` expõem `account.lifetimeAccess: boolean`.

- [ ] **Step 1: Schema — flag na Account**

Em `apps/api/prisma/schema.prisma`, no modelo `Account`, a seguir a `paidUntil`:
```prisma
  lifetimeAccess       Boolean       @default(false) // acesso permanente dado pelo super-admin
```

- [ ] **Step 2: Migração aditiva (à mão) + aplicar**

O `prisma migrate dev` pode ser bloqueado por um drift pré-existente na migração
`20260717131305_reservation_services` (editada num passado). Criar a migração à mão:
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd apps/api
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_account_lifetime_access"
printf 'ALTER TABLE "Account" ADD COLUMN "lifetimeAccess" BOOLEAN NOT NULL DEFAULT false;\n' \
  > "prisma/migrations/${TS}_account_lifetime_access/migration.sql"
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```
Esperado: `migration applied`; `generate` recria os tipos com `lifetimeAccess`.

- [ ] **Step 3: Verificar a coluna (mutação leve)**
```bash
cd apps/api
node -e "
const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient();
(async()=>{
  const n = await p.account.count();
  const com = await p.account.count({ where: { lifetimeAccess: false } });
  console.log('contas:', n, '| com lifetimeAccess=false (default):', com, '(iguais → coluna criada, default ok)');
  await p.\$disconnect();
})();"
```
Esperado: os dois números iguais.

- [ ] **Step 4: Teste unitário do subscription.util (TDD — escrever primeiro)**

Criar `apps/api/src/modules/tenants/subscription.util.spec.ts`:
```ts
import { computeSubscription, isSubscriptionUsable } from './subscription.util';

const past = new Date(Date.now() - 86_400_000); // ontem
const future = new Date(Date.now() + 86_400_000); // amanhã

describe('subscription.util — acesso vitalício', () => {
  it('lifetimeAccess → estado LIFETIME mesmo sem datas', () => {
    const s = computeSubscription({ lifetimeAccess: true, trialEndsAt: null, paidUntil: null });
    expect(s.state).toBe('LIFETIME');
    expect(s.daysLeft).toBeNull();
  });

  it('lifetimeAccess → usável mesmo com teste e pagamento expirados', () => {
    const acc = { lifetimeAccess: true, trialEndsAt: past, paidUntil: past };
    expect(computeSubscription(acc).state).toBe('LIFETIME');
    expect(isSubscriptionUsable(acc)).toBe(true);
  });

  it('lifetimeAccess mas BANIDA → NÃO usável (a banição ganha)', () => {
    const acc = { lifetimeAccess: true, status: 'BANNED' as const, trialEndsAt: null, paidUntil: null };
    expect(isSubscriptionUsable(acc)).toBe(false);
  });

  it('sem lifetimeAccess → comportamento de sempre (PAID/EXPIRED)', () => {
    expect(computeSubscription({ trialEndsAt: null, paidUntil: future }).state).toBe('PAID');
    expect(computeSubscription({ trialEndsAt: past, paidUntil: past }).state).toBe('EXPIRED');
    expect(isSubscriptionUsable({ trialEndsAt: null, paidUntil: past })).toBe(false);
  });
});
```

- [ ] **Step 5: Correr o teste — tem de FALHAR**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/api exec jest subscription.util --silent 2>&1 | tail -15
```
Esperado: FALHA nos casos LIFETIME (o estado ainda não existe; `lifetimeAccess` é ignorado).

- [ ] **Step 6: Implementar o LIFETIME no subscription.util**

Em `apps/api/src/modules/tenants/subscription.util.ts`:
1. `SubscriptionState`: acrescentar `'LIFETIME'`:
```ts
export type SubscriptionState = 'NONE' | 'TRIAL' | 'PAID' | 'EXPIRED' | 'LIFETIME';
```
2. `WithSubscription`: incluir a flag (opcional, `undefined` = false):
```ts
type WithSubscription = Pick<Account, 'trialEndsAt' | 'paidUntil'> &
  Partial<Pick<Account, 'status' | 'lifetimeAccess'>>;
```
3. `computeSubscription`: **no topo, antes do check de `paid`**, a seguir a `const now = Date.now();`:
```ts
  if (account.lifetimeAccess) {
    return {
      state: 'LIFETIME',
      trialEndsAt: account.trialEndsAt ?? null,
      paidUntil: account.paidUntil ?? null,
      daysLeft: null,
    };
  }
```
4. `isSubscriptionUsable`: acrescentar LIFETIME aos estados usáveis:
```ts
  return s === 'TRIAL' || s === 'PAID' || s === 'LIFETIME';
```

- [ ] **Step 7: Correr o teste — tem de PASSAR**
```bash
pnpm --filter @comanda/api exec jest subscription.util --silent 2>&1 | tail -8
```
Esperado: todos verdes.

- [ ] **Step 8: DTO + endpoint + serviço do admin**

Criar `apps/api/src/modules/admin/dto/set-lifetime.dto.ts`:
```ts
import { IsBoolean } from 'class-validator';

export class SetLifetimeDto {
  /** true = dar acesso vitalício; false = retirar */
  @IsBoolean()
  lifetime!: boolean;
}
```

Em `apps/api/src/modules/admin/admin.service.ts`, adicionar o método (a seguir a `banAccount`):
```ts
  /** Dá ou retira acesso vitalício (permanente) a uma empresa. Reversível, sem efeitos colaterais. */
  async setLifetimeAccess(id: string, lifetime: boolean) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Empresa não encontrada.');
    const updated = await this.prisma.account.update({
      where: { id },
      data: { lifetimeAccess: lifetime },
    });
    return { id: updated.id, name: updated.name, lifetimeAccess: updated.lifetimeAccess };
  }
```

Nas DUAS projeções que expõem a conta, acrescentar o campo ao objeto `account`:
- em `listTenants` (~linha 136-141) e em `getTenantDetail` (~linha 235-240), no objeto
  `account: { id, name, status, bannedAt }`, adicionar `lifetimeAccess: t.account.lifetimeAccess`
  (na lista) e `lifetimeAccess: tenant.account.lifetimeAccess` (no detalhe). Ambos já carregam a
  conta completa, por isso o campo está disponível.

Em `apps/api/src/modules/admin/admin.controller.ts`, adicionar o import
`import { SetLifetimeDto } from './dto/set-lifetime.dto';` e a rota (a seguir a `banAccount`):
```ts
  @Patch('accounts/:id/lifetime')
  setLifetime(@Param('id') id: string, @Body() dto: SetLifetimeDto) {
    return this.admin.setLifetimeAccess(id, dto.lifetime);
  }
```

- [ ] **Step 9: Build + typecheck da API**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/api build
pnpm --filter @comanda/api exec tsc --noEmit
```
Esperado: sem erros.

- [ ] **Step 10: Commit**
```bash
cd /Users/matheus.moraes/dev/comanda
git add apps/api/prisma apps/api/src/modules/tenants apps/api/src/modules/admin
git commit -m "feat(admin): acesso vitalício — flag lifetimeAccess, estado LIFETIME e endpoint"
```

---

## Task 2: Frontend — botão no admin master + estado no painel

**Files:**
- Modify: `apps/admin/src/lib/admin-hooks.ts`
- Modify: `apps/admin/src/app/tenants/page.tsx`
- Modify: `apps/dashboard/src/components/AppShell.tsx`, `apps/dashboard/src/lib/settings-hooks.ts`
- Modify: `apps/dashboard/src/app/settings/page.tsx`

**Interfaces:**
- Consumes (da Task 1): `PATCH /admin/accounts/:id/lifetime {lifetime}`; `account.lifetimeAccess` nas projeções; estado `LIFETIME`.

- [ ] **Step 1: admin-hooks — tipos + hook**

Em `apps/admin/src/lib/admin-hooks.ts`:
1. `Subscription.state`: acrescentar `'LIFETIME'`:
```ts
  state: 'NONE' | 'TRIAL' | 'PAID' | 'EXPIRED' | 'LIFETIME';
```
2. `AccountSummary`: acrescentar `lifetimeAccess: boolean;`.
3. Novo hook (a seguir a `useBanAccount`):
```ts
/** Dá ou retira acesso vitalício (permanente) a uma empresa. */
export function useSetLifetime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, lifetime }: { accountId: string; lifetime: boolean }) =>
      (await api.patch(`/admin/accounts/${accountId}/lifetime`, { lifetime })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      qc.invalidateQueries({ queryKey: ['admin-tenant'] });
    },
  });
}
```

- [ ] **Step 2: admin — SubBadge (LIFETIME) + AccountCard (botão + chip)**

Em `apps/admin/src/app/tenants/page.tsx`:
1. No `SubBadge` (~linha 50), acrescentar o caso LIFETIME **antes** do PAID:
```ts
  const meta =
    sub.state === 'LIFETIME'
      ? { label: 'Vitalício', cls: 'bg-brand-soft text-brand-dark' }
      : sub.state === 'PAID'
      ? { label: `Paga até ${new Date(sub.paidUntil!).toLocaleDateString('pt-PT')}`, cls: 'bg-green-100 text-green-800' }
      : sub.state === 'TRIAL'
        ? { label: `Teste · ${sub.daysLeft} ${sub.daysLeft === 1 ? 'dia' : 'dias'}`, cls: 'bg-blue-100 text-blue-800' }
        : sub.state === 'EXPIRED'
          ? { label: 'Expirada', cls: 'bg-red-100 text-red-700' }
          : { label: '—', cls: 'bg-stone-100 text-stone-500' };
```
2. No `AccountCard` (~linha 664), adicionar o hook e o handler (importar `useSetLifetime` no topo, e um ícone, ex. `Infinity`, de `lucide-react`):
```ts
  const lifetime = useSetLifetime();
  const isLifetime = account.lifetimeAccess;

  async function toggleLifetime() {
    const msg = isLifetime
      ? `Retirar o acesso vitalício de "${account.name}"? Volta a depender de teste/pagamento.`
      : `Dar acesso vitalício a "${account.name}"? A empresa fica com acesso permanente, sem pagar.`;
    if (!confirm(msg)) return;
    try {
      await lifetime.mutateAsync({ accountId: account.id, lifetime: !isLifetime });
      toast.success(isLifetime ? 'Acesso vitalício retirado' : 'Acesso vitalício dado');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Erro ao atualizar o acesso');
    }
  }
```
E na fila de botões do cabeçalho do card (junto ao "Banir empresa"), acrescentar:
```tsx
          <button
            onClick={toggleLifetime}
            disabled={lifetime.isPending}
            className={clsx(
              'flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] font-medium transition-colors disabled:opacity-60',
              isLifetime
                ? 'border border-line bg-white text-ink-soft hover:border-red-300 hover:bg-red-50 hover:text-red-700'
                : 'bg-brand font-semibold text-white hover:bg-brand-dark',
            )}
          >
            <Infinity size={14} />
            {isLifetime ? 'Retirar vitalício' : 'Acesso vitalício'}
          </button>
```
E, junto ao chip "Ativa/Banida" do card, quando `isLifetime` mostrar também um chip:
```tsx
          {isLifetime && (
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand-dark">
              Vitalício
            </span>
          )}
```

- [ ] **Step 3: dashboard — union do estado + badge "Ativa"**

1. `apps/dashboard/src/components/AppShell.tsx:40` e `apps/dashboard/src/lib/settings-hooks.ts:7`:
   mudar `state: 'NONE' | 'TRIAL' | 'PAID' | 'EXPIRED';` para incluir `| 'LIFETIME'`.
2. `apps/dashboard/src/app/settings/page.tsx` (`stateMeta`, ~linha 504): acrescentar o caso
   LIFETIME **antes** do PAID, para não cair no `paidUntil!` (que daria "Invalid Date"):
```ts
  const stateMeta =
    sub?.state === 'LIFETIME'
      ? { label: 'Ativa', cls: 'bg-green-100 text-green-800' }
      : sub?.state === 'PAID'
      ? {
          label: `Paga até ${new Date(sub.paidUntil!).toLocaleDateString('pt-PT')}`,
          cls: 'bg-green-100 text-green-800',
        }
      : sub?.state === 'TRIAL'
        ? {
            label: `Período de teste · ${sub.daysLeft} ${sub.daysLeft === 1 ? 'dia' : 'dias'}`,
            cls: 'bg-blue-100 text-blue-800',
          }
        : sub?.state === 'EXPIRED'
          ? { label: 'Expirada — loja offline', cls: 'bg-red-100 text-red-700' }
          : { label: 'Aguarda ativação da loja', cls: 'bg-stone-200 text-stone-600' };
```
(O `AppShell` só mostra banner no estado TRIAL, por isso o LIFETIME não dispara banner — nada a fazer lá.)

- [ ] **Step 4: Typecheck + build (admin + dashboard)**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/admin exec tsc --noEmit && pnpm --filter @comanda/admin build
pnpm --filter @comanda/dashboard exec tsc --noEmit && pnpm --filter @comanda/dashboard build
```
Esperado: sem erros.

- [ ] **Step 5: Commit**
```bash
cd /Users/matheus.moraes/dev/comanda
git add apps/admin/src apps/dashboard/src
git commit -m "feat(admin): botão de acesso vitalício na ficha da empresa + estado no painel"
```

---

## Task 3: Verificação integrada (browser)

- [ ] **Step 1: Arrancar a stack e ligar/desligar o vitalício**

Com a API construída e a DB de pé, arrancar o admin (`pnpm --filter @comanda/admin dev`) e o
storefront. Login super-admin `admin@menooo.pt` (password do seed). Abrir a ficha de uma loja
cujo acesso NÃO esteja pago (ex.: criar uma conta de teste com `paidUntil` no passado via
Prisma), clicar **"Acesso vitalício"** e confirmar:
- A ficha passa a mostrar o chip **"Vitalício"** e a subscrição "Vitalício".
- A loja pública dessa conta volta a responder (menu `GET /public/stores/:slug/menu` 200) **sem
  pagamento** — prova de que o gating honra o vitalício.
- Clicar **"Retirar vitalício"** → a loja volta a ficar offline (menu 404), estado EXPIRED.
- Confirmar que uma conta **banida** com vitalício continua offline.

Limpar os dados de teste no fim (repor a demo).

- [ ] **Step 2: Handoff** — deixar o ramo pronto para revisão adversarial e, depois, merge+deploy
(que exige o utilizador NOMEAR o host `root@187.124.4.163`; `pg_dump` antes por causa da migração).

---

## Self-review (cobertura do spec)

- **§4 Modelo (lifetimeAccess)** → Task 1 Steps 1-3. ✓
- **§5 Gating (LIFETIME + isSubscriptionUsable + banição ganha)** → Task 1 Steps 4-7. ✓
- **§6 API (PATCH lifetime)** → Task 1 Step 8. ✓
- **§7 Admin UI (botão + Vitalício + projeção)** → Task 1 Step 8 (projeção); Task 2 Steps 1-2. ✓
- **§8 Painel do amigo (LIFETIME = Ativa, sem banner)** → Task 2 Step 3. ✓
- **§9 Testes (unit + integração)** → Task 1 Steps 4-7 (unit); Task 3 (browser end-to-end). ✓

**Consistência de tipos:** `SetLifetimeDto {lifetime:boolean}` ↔ endpoint `{lifetime}` ↔ hook
`useSetLifetime({accountId, lifetime})`; `SubscriptionState`/union do dashboard com `'LIFETIME'`
em todos os sítios; `AccountSummary.lifetimeAccess: boolean` ↔ projeção `account.lifetimeAccess`.
