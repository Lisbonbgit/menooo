# Acesso vitalício (admin master) — Design

**Data:** 2026-07-19
**Ramo:** `matheus-acesso-vitalicio`
**Estado:** aprovado no brainstorming; a aguardar revisão do spec.

## 1. Contexto

O dono do Menooo quer poder **oferecer acesso permanente** a algumas empresas (amigos),
sem depender de pagamentos nem de datas. Hoje o acesso de uma conta é dado por
`Account.paidUntil` (uma data) e calculado em `isSubscriptionUsable`; o super-admin só
consegue estender a subscrição via `recordPayment`, **limitado a 1–24 meses de cada vez**
(`apps/api/src/modules/admin/admin.service.ts:314`). Não existe forma de dar acesso
permanente. Esta funcionalidade acrescenta-a.

## 2. Âmbito

**Entra:**
- Campo `lifetimeAccess` (booleano) na `Account`.
- `isSubscriptionUsable` honra o vitalício; `computeSubscription` ganha o estado `LIFETIME`.
- Endpoint do super-admin para ligar/desligar o vitalício de uma empresa.
- Botão no admin master (ficha da empresa) + mostrar "Vitalício".
- O painel do dono trata o estado `LIFETIME` sem mostrar data inválida (comporta-se como conta paga).

**Não entra:** cobranças, planos pagos, qualquer indicador especial no painel do amigo (a
pedido do utilizador: o amigo não vê nada de diferente de uma conta paga normal).

## 3. Decisões

- **Por conta (empresa), não por loja.** A subscrição vive na `Account`; uma conta pode ter
  várias lojas (`Tenant`). O vitalício cobre a **empresa toda** (todas as lojas do dono).
- **A banição ganha sempre.** Uma conta banida com vitalício continua sem acesso.
- **Não substitui a ativação da loja.** O vitalício trata da *subscrição*; a loja continua a
  precisar de `Tenant.status = ACTIVE` para estar visível (igual a hoje). Ativar a loja +
  ligar o vitalício = no ar para sempre.
- **Reversível** a qualquer momento (liga/desliga).
- **Amigo não vê nada** de especial no painel (escolha do utilizador).

## 4. Modelo de dados

`Account` ganha:
```prisma
  lifetimeAccess Boolean @default(false)
```
Migração **aditiva** (coluna booleana com default `false` — nenhuma conta existente muda de
comportamento). Sem backfill necessário (o default trata das linhas existentes).

## 5. Regra de acesso (`apps/api/src/modules/tenants/subscription.util.ts`)

- `SubscriptionState` ganha `'LIFETIME'`.
- O tipo `WithSubscription` inclui `lifetimeAccess?: boolean` (opcional — `undefined` conta
  como `false`, para não partir chamadores que construam o objeto à mão).
- `computeSubscription`: **antes** de olhar a `paidUntil`/`trialEndsAt`, se `lifetimeAccess`
  for verdadeiro → devolve `{ state: 'LIFETIME', trialEndsAt, paidUntil, daysLeft: null }`.
- `isSubscriptionUsable`: `if (status === 'BANNED') return false;` (como hoje) → depois
  `true` se o estado for `LIFETIME`, `TRIAL` ou `PAID`. (Como o `LIFETIME` vem do
  `computeSubscription`, basta acrescentá-lo à lista de estados usáveis.)

Todos os pontos de gating público já chamam `isSubscriptionUsable(account)` com a conta
carregada por `include: { account: true }` (catalog, reservations, promotions, tenants) — o
campo novo vai lá dentro automaticamente. Nenhum desses ficheiros muda.

## 6. API do super-admin

Novo endpoint no `AdminController`, a espelhar o de banir:
- `PATCH /admin/accounts/:id/lifetime` com corpo `{ lifetime: boolean }` →
  `admin.setLifetimeAccess(accountId, lifetime)`.
- O serviço valida que a conta existe (404 se não) e faz
  `account.update({ where: { id }, data: { lifetimeAccess: lifetime } })`. Sem efeitos
  colaterais (não mexe em banição, pagamentos, nem datas). Devolve a conta atualizada.
- DTO `SetLifetimeDto { lifetime: boolean }` (validado com `@IsBoolean()`).
- Protegido pela guarda de super-admin, como os outros endpoints `/admin/*`.

## 7. Admin master (UI — `apps/admin/src/app/tenants/page.tsx`)

- Na secção **"empresa (conta do dono)"** (onde estão Banir/Reativar/Excluir), acrescentar um
  controlo **"Acesso vitalício"** (ligar/desligar) que chama o endpoint novo via um hook
  `useSetLifetime` (em `apps/admin/src/lib/admin-hooks.ts`), usando o **id da conta** (o mesmo
  que ban/excluir já usam).
- Quando ligado, mostrar um selo **"Vitalício"** e, no estado da subscrição da ficha,
  apresentar "Vitalício" em vez de datas de renovação.
- A ficha do tenant (`GET /admin/tenants/:id`) e a lista passam a expor `lifetimeAccess` da
  conta, para a UI saber o estado atual (acrescentar o campo à projeção do `admin.service`).

## 8. Painel do dono (amigo) — `apps/dashboard`

- `AppShell` já só mostra banner no estado `TRIAL` → o `LIFETIME` não dispara banner nenhum
  (nada a fazer).
- `settings/page.tsx` (cartão Subscrição, ~linha 500): acrescentar o caso `LIFETIME` ao
  cálculo do selo — mostrar **"Ativa"** (sem data), evitando o `paidUntil!` que hoje daria
  "Paga até Invalid Date" quando não há data. Sem selo "vitalício" nem texto especial
  (escolha do utilizador: comporta-se como conta paga). O `/tenants/me` já devolve
  `subscription.state`, que passa a poder ser `LIFETIME`.

## 9. Testes

- **Unit (`subscription.util.spec.ts`)** — a função é pura:
  - `lifetimeAccess: true` → estado `LIFETIME` e `isSubscriptionUsable` verdadeiro **mesmo
    sem `paidUntil`/`trialEndsAt`** (ou com ambos no passado).
  - `lifetimeAccess: true` + `status: 'BANNED'` → **não** usável (banição ganha).
  - `lifetimeAccess: false` → comportamento de hoje inalterado (TRIAL/PAID/EXPIRED/NONE).
  - Validar por mutação (ver o teste vermelho pela razão certa).
- **E2e (admin)** — ligar o vitalício numa conta cujo teste expirou → a loja pública/menu
  volta a ficar **usável** sem pagamento; desligar → volta a `EXPIRED` (offline). Reutiliza o
  padrão dos e2e existentes (ou estende o e2e do admin/subscrição se houver).

## 10. Fora de âmbito / riscos

- Não há risco de migração (coluna aditiva com default). No deploy, `pg_dump` na mesma (regra
  do projeto) por prudência.
- Não toca no fluxo de pagamentos nem no Stripe.
- O único ponto sensível é garantir que a banição continua a ganhar — coberto por teste.
