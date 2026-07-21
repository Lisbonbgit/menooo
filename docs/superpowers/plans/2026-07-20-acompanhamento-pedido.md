# Página de acompanhamento do pedido — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma página pública que mostra o estado do pedido ao vivo (só leitura); o cliente é lá levado após o checkout e todos os emails do pedido linkam para ela.

**Architecture:** `Order` ganha um `trackToken` único; um endpoint público devolve uma projeção mínima do estado; uma rota nova do storefront (`/[slug]/pedido/[token]`) mostra a linha de estados e faz sondagem; o checkout redireciona para lá; os 4 emails de estado ganham um botão "Acompanhar o pedido".

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL (apps/api); Next.js 14 + React Query v5 (apps/storefront); Jest para a API (o storefront NÃO tem jest — o util de estados é verificado em browser).

## Global Constraints

- **PT-PT** em todo o texto visível e mensagens de erro.
- **Página só de leitura** — sem cancelar/editar, sem ETA, sem SMS/WhatsApp/push (decisão do utilizador).
- **Projeção mínima**: o endpoint público devolve `number, status, type, createdAt, total, restaurantName, slug, items[{name,quantity}]` — **NUNCA** telefone, morada nem nome do cliente.
- **404 neutro** quando o token não existe.
- **Migração aditiva com backfill** (`@default(cuid())` não cria default na BD): `ADD COLUMN` nullable → `UPDATE ... SET "trackToken"='trk_'||md5("id")` → `SET NOT NULL` + índice único. `pg_dump` antes do deploy.
- **O token vai no caminho do URL** (link só de leitura, projeção sem PII) — não usar fragmento `#`.
- **Passos por tipo**: DELIVERY = Recebido→Aceite→Em preparação→Pronto→A caminho→Entregue; PICKUP = Recebido→Aceite→Em preparação→Pronto para levantar→Concluído (sem "A caminho"); REJECTED/CANCELLED = estado terminal negativo distinto.
- Stack local: DB `:5433`, API `http://localhost:3001/api`, storefront `:3000`. PATH: `export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"`.
- Deploy exige o utilizador NOMEAR o host `root@187.124.4.163`; NUNCA correr e2e contra produção.
- Validar por mutação (um teste verde não vale até se o ver vermelho pela razão certa).

---

## Estrutura de ficheiros

**Backend (apps/api):**
- `prisma/schema.prisma` — `Order.trackToken String @unique @default(cuid())`.
- `prisma/migrations/<ts>_order_track_token/migration.sql` — criar à mão.
- `src/modules/orders/public-order-track.controller.ts` — **Criar**: `GET public/orders/:token`.
- `src/modules/orders/orders.service.ts` — `getPublicTracking(token)`.
- `src/modules/orders/orders.module.ts` — registar o controller novo.
- `src/modules/mail/mail.service.ts` — `OrderMailInfo.trackUrl` + `cta` nos 4 emails.
- `scripts/e2e-encomendas.mjs` — estender com os checks de acompanhamento.

**Frontend (apps/storefront):**
- `src/lib/order-status.ts` — **Criar**: `stepsFor`, `currentStepIndex`, `isNegative` (puro).
- `src/lib/store-hooks.ts` — `useOrderTracking(token)`.
- `src/lib/types.ts` — tipo `OrderTracking`.
- `src/app/[slug]/pedido/[token]/page.tsx` + `TrackClient.tsx` — **Criar**: a página.
- `src/app/[slug]/checkout/CheckoutClient.tsx` — redirecionar após o pedido.

---

## Task 1: Backend — trackToken, endpoint de acompanhamento e migração

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `orders.service.ts`, `orders.module.ts`, `scripts/e2e-encomendas.mjs`
- Create: `apps/api/prisma/migrations/<ts>_order_track_token/migration.sql`, `apps/api/src/modules/orders/public-order-track.controller.ts`

**Interfaces:**
- Produces:
  - `GET /public/orders/:token` → `{ number, status, type, createdAt, total, restaurantName, slug, items:[{name,quantity}] }`; 404 neutro se não existir.
  - `Order.trackToken` (string única) presente na `Order` devolvida por `createPublicOrder` (logo no corpo da resposta do `POST /public/stores/:slug/orders`).
  - `OrdersService.getPublicTracking(token: string)`.

- [ ] **Step 1: Schema — trackToken**

Em `apps/api/prisma/schema.prisma`, no modelo `Order`, a seguir a `number`:
```prisma
  trackToken String @unique @default(cuid()) // link privado de acompanhamento do pedido
```

- [ ] **Step 2: Migração aditiva com backfill + aplicar**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd apps/api
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_order_track_token"
cat > "prisma/migrations/${TS}_order_track_token/migration.sql" <<'SQL'
ALTER TABLE "Order" ADD COLUMN "trackToken" TEXT;
UPDATE "Order" SET "trackToken" = 'trk_' || md5("id") WHERE "trackToken" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "trackToken" SET NOT NULL;
CREATE UNIQUE INDEX "Order_trackToken_key" ON "Order"("trackToken");
SQL
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```
Esperado: `migration applied`. (O `migrate dev` pode ser bloqueado por drift pré-existente — usar `migrate deploy`, como nas migrações recentes.)

- [ ] **Step 3: Verificar backfill (preservação de dados)**
```bash
cd apps/api
node -e "
const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient();
(async()=>{
  const total = await p.order.count();
  const comToken = await p.order.count({ where: { trackToken: { not: undefined } } });
  const distintos = (await p.order.findMany({ select:{ trackToken:true }})).map(o=>o.trackToken);
  console.log('orders:', total, '| todos com token:', comToken===total, '| tokens únicos:', new Set(distintos).size===total);
  await p.\$disconnect();
})();"
```
Esperado: `todos com token: true | tokens únicos: true`.

- [ ] **Step 4: `getPublicTracking` no serviço**

Em `apps/api/src/modules/orders/orders.service.ts`, adicionar (a seguir a `getForTenant` ou `listForTenant`):
```ts
  /** Projeção pública mínima para a página de acompanhamento (sem telefone/morada/nome). */
  async getPublicTracking(token: string) {
    const order = await this.prisma.order.findUnique({
      where: { trackToken: token },
      select: {
        number: true,
        status: true,
        type: true,
        createdAt: true,
        total: true,
        tenant: { select: { name: true, slug: true } },
        items: { select: { name: true, quantity: true } },
      },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    return {
      number: order.number,
      status: order.status,
      type: order.type,
      createdAt: order.createdAt,
      total: Number(order.total),
      restaurantName: order.tenant.name,
      slug: order.tenant.slug,
      items: order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    };
  }
```
(Confirmar que `NotFoundException` já está importado de `@nestjs/common` no ficheiro — está, é usado por `getForTenant`.)

- [ ] **Step 5: Controller público do acompanhamento**

Criar `apps/api/src/modules/orders/public-order-track.controller.ts`:
```ts
import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('public')
@Controller('public/orders')
export class PublicOrderTrackController {
  constructor(private readonly orders: OrdersService) {}

  /** Estado ao vivo de um pedido, por token privado. A página faz sondagem, daí o throttle generoso. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  track(@Param('token') token: string) {
    return this.orders.getPublicTracking(token);
  }
}
```

- [ ] **Step 6: Registar o controller**

Em `apps/api/src/modules/orders/orders.module.ts`, importar `PublicOrderTrackController` e adicioná-lo ao array `controllers` (ao lado de `PublicOrdersController`).

- [ ] **Step 7: Estender o e2e com os checks de acompanhamento**

Em `apps/api/scripts/e2e-encomendas.mjs`, depois de criar um pedido público e ter a resposta `order`, adicionar:
```js
// --- acompanhamento do pedido ---
const token = order.trackToken;
check('POST devolve trackToken', typeof token === 'string' && token.length > 0, `got ${token}`);
const track1 = await req('GET', `/public/orders/${token}`);
check('GET acompanhamento → 200', track1.status === 200, `got ${track1.status}`);
check('estado inicial PENDING', track1.json?.status === 'PENDING', JSON.stringify(track1.json?.status));
check('projeção SEM telefone/morada', !('customerPhone' in (track1.json||{})) && !('deliveryAddress' in (track1.json||{})), JSON.stringify(Object.keys(track1.json||{})));
check('traz itens', Array.isArray(track1.json?.items) && track1.json.items.length > 0, JSON.stringify(track1.json?.items));
// avançar estado (staff) e ver refletir
await req('PATCH', `/orders/${order.id}/status`, { token: staffToken, body: { status: 'ACCEPTED' } });
const track2 = await req('GET', `/public/orders/${token}`);
check('acompanhamento reflete ACCEPTED', track2.json?.status === 'ACCEPTED', JSON.stringify(track2.json?.status));
// token inválido → 404 neutro
const bad = await req('GET', `/public/orders/trk_inexistente`);
check('token inválido → 404', bad.status === 404, `got ${bad.status}`);
```
(Adaptar os nomes `req`/`check`/`staffToken`/`order` aos que o script já usa; se o script não expõe um `staffToken`, reutilizar o login de staff que ele já faz.)

- [ ] **Step 8: Build + tsc + e2e**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/api build && pnpm --filter @comanda/api exec tsc --noEmit
# reiniciar a API a partir do dist novo e correr o e2e:
pkill -9 -f "dist/main" 2>/dev/null; sleep 1; (cd apps/api && node dist/main > /tmp/track-api.log 2>&1 &); sleep 7
curl -s -o /dev/null -w "health %{http_code}\n" localhost:3001/api/health
node apps/api/scripts/e2e-encomendas.mjs 2>&1 | tail -6
```
Esperado: build/tsc limpos; e2e verde incluindo os checks novos.

- [ ] **Step 9: Commit**
```bash
cd /Users/matheus.moraes/dev/comanda
git add apps/api/prisma apps/api/src/modules/orders apps/api/scripts/e2e-encomendas.mjs
git commit -m "feat(orders): token e endpoint público de acompanhamento do pedido"
```

---

## Task 2: Emails — link "Acompanhar o pedido" em todos

**Files:**
- Modify: `apps/api/src/modules/mail/mail.service.ts`, `apps/api/src/modules/orders/orders.service.ts`

**Interfaces:**
- Consumes: `Order.trackToken` (Task 1); `STORE_URL` (já existe em `mail.service.ts:8`).

- [ ] **Step 1: `trackUrl` no `OrderMailInfo`**

Em `apps/api/src/modules/mail/mail.service.ts`, na interface `OrderMailInfo` (linha 36), adicionar:
```ts
  trackUrl: string;
```

- [ ] **Step 2: Preencher `trackUrl` no `afterStatusChange`**

Em `apps/api/src/modules/orders/orders.service.ts`, no objeto `info: OrderMailInfo` (dentro de `afterStatusChange`, ~linha 271), acrescentar a chave (o `STORE_URL` do email é `process.env.STORE_URL`; usar o mesmo default):
```ts
      trackUrl: `${process.env.STORE_URL ?? 'https://menooo.com'}/${tenant.slug}/pedido/${order.trackToken}`,
```
(`order` aqui é o payload com os campos da `Order` — já inclui `trackToken` após a Task 1.)

- [ ] **Step 3: Botão nos 4 emails**

Em `apps/api/src/modules/mail/mail.service.ts`, em cada um dos métodos `sendOrderAccepted`, `sendOrderReady`, `sendOrderCompleted`, `sendOrderCancelled`, acrescentar ao corpo HTML (antes do fecho / junto aos outros CTAs) uma linha:
```ts
        this.cta('Acompanhar o pedido', info.trackUrl) +
```
No `sendOrderCompleted`, que já tem `this.cta('Pedir novamente', ...)`, pôr o "Acompanhar o pedido" ANTES do "Pedir novamente". (O helper `cta` já existe, linha 160.)

- [ ] **Step 4: Verificar o link no email (modo json)**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/api build && pnpm --filter @comanda/api exec tsc --noEmit
# a API em modo SMTP_HOST=json escreve os emails no log; correr o e2e-encomendas e procurar o link:
pkill -9 -f "dist/main" 2>/dev/null; sleep 1; (cd apps/api && SMTP_HOST=json node dist/main > /tmp/track-mail.log 2>&1 &); sleep 7
node apps/api/scripts/e2e-encomendas.mjs > /dev/null 2>&1
grep -c "/pedido/" /tmp/track-mail.log | xargs echo "ocorrências de /pedido/ nos emails:"
```
Esperado: build/tsc limpos; ≥1 ocorrência de `/pedido/` (o link entrou nos emails).

- [ ] **Step 5: Commit**
```bash
cd /Users/matheus.moraes/dev/comanda
git add apps/api/src/modules/mail/mail.service.ts apps/api/src/modules/orders/orders.service.ts
git commit -m "feat(mail): link 'Acompanhar o pedido' em todos os emails de estado"
```

---

## Task 3: Frontend — página de acompanhamento + redirect do checkout

**Files:**
- Create: `apps/storefront/src/lib/order-status.ts`, `apps/storefront/src/app/[slug]/pedido/[token]/page.tsx`, `apps/storefront/src/app/[slug]/pedido/[token]/TrackClient.tsx`
- Modify: `apps/storefront/src/lib/store-hooks.ts`, `apps/storefront/src/lib/types.ts`, `apps/storefront/src/app/[slug]/checkout/CheckoutClient.tsx`

**Interfaces:**
- Consumes: `GET /public/orders/:token` (Task 1); `data.trackToken` na resposta do `POST /public/stores/:slug/orders`.

- [ ] **Step 1: Util puro dos estados**

Criar `apps/storefront/src/lib/order-status.ts`:
```ts
export type TrackType = 'DELIVERY' | 'PICKUP';
export type TrackStatus =
  | 'PENDING' | 'ACCEPTED' | 'PREPARING' | 'READY'
  | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export interface TrackStep { key: TrackStatus; label: string; }

/** Passos visíveis por tipo de pedido. PICKUP não tem "A caminho". */
export function stepsFor(type: TrackType): TrackStep[] {
  const base: TrackStep[] = [
    { key: 'PENDING', label: 'Recebido' },
    { key: 'ACCEPTED', label: 'Aceite' },
    { key: 'PREPARING', label: 'Em preparação' },
  ];
  if (type === 'DELIVERY') {
    return [
      ...base,
      { key: 'READY', label: 'Pronto' },
      { key: 'OUT_FOR_DELIVERY', label: 'A caminho' },
      { key: 'COMPLETED', label: 'Entregue' },
    ];
  }
  return [
    ...base,
    { key: 'READY', label: 'Pronto para levantar' },
    { key: 'COMPLETED', label: 'Concluído' },
  ];
}

/** Índice do passo atual (-1 se o estado não está na lista, ex. terminal negativo). */
export function currentStepIndex(status: TrackStatus, type: TrackType): number {
  return stepsFor(type).findIndex((s) => s.key === status);
}

export function isNegative(status: TrackStatus): boolean {
  return status === 'REJECTED' || status === 'CANCELLED';
}

export function isTerminal(status: TrackStatus): boolean {
  return status === 'COMPLETED' || isNegative(status);
}
```

- [ ] **Step 2: Tipo + hook de sondagem**

Em `apps/storefront/src/lib/types.ts`, adicionar:
```ts
export interface OrderTracking {
  number: number;
  status:
    | 'PENDING' | 'ACCEPTED' | 'PREPARING' | 'READY'
    | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
  type: 'DELIVERY' | 'PICKUP';
  createdAt: string;
  total: number;
  restaurantName: string;
  slug: string;
  items: { name: string; quantity: number }[];
}
```
Em `apps/storefront/src/lib/store-hooks.ts`, adicionar (importar `OrderTracking` de `./types`):
```ts
import type { OrderTracking } from './types';

export function useOrderTracking(token: string) {
  return useQuery({
    queryKey: ['order-track', token],
    queryFn: async () => (await api.get<OrderTracking>(`/public/orders/${token}`)).data,
    retry: false,
    // pára a sondagem quando o pedido termina
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s && ['COMPLETED', 'REJECTED', 'CANCELLED'].includes(s) ? false : 10_000;
    },
  });
}
```

- [ ] **Step 3: A página (server) + client**

Criar `apps/storefront/src/app/[slug]/pedido/[token]/page.tsx`:
```tsx
import { TrackClient } from './TrackClient';

export const metadata = { robots: { index: false } };

export default function Page({ params }: { params: { slug: string; token: string } }) {
  return <TrackClient slug={params.slug} token={params.token} />;
}
```
Criar `apps/storefront/src/app/[slug]/pedido/[token]/TrackClient.tsx`:
```tsx
'use client';

import { useOrderTracking } from '@/lib/store-hooks';
import { stepsFor, currentStepIndex, isNegative } from '@/lib/order-status';

export function TrackClient({ slug, token }: { slug: string; token: string }) {
  const { data, isLoading, isError } = useOrderTracking(token);

  if (isLoading) return <main className="mx-auto max-w-lg p-6 text-center text-ink-mute">A carregar…</main>;
  if (isError || !data)
    return (
      <main className="mx-auto max-w-lg p-6 text-center">
        <p className="text-ink">Pedido não encontrado.</p>
        <a href={`/${slug}`} className="mt-3 inline-block text-brand-dark underline">Voltar à loja</a>
      </main>
    );

  const steps = stepsFor(data.type);
  const idx = currentStepIndex(data.status, data.type);
  const negativo = isNegative(data.status);

  return (
    <main className="mx-auto max-w-lg p-6">
      <header className="mb-5 text-center">
        <h1 className="font-display text-2xl font-semibold">{data.restaurantName}</h1>
        <p className="mt-1 text-[13px] text-ink-mute">Pedido nº {data.number}</p>
      </header>

      {negativo ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-center text-red-700">
          {data.status === 'REJECTED' ? 'Pedido recusado' : 'Pedido cancelado'}
        </div>
      ) : (
        <ol className="mb-6 space-y-2">
          {steps.map((s, i) => {
            const feito = idx >= i;
            const atual = idx === i;
            return (
              <li key={s.key} className="flex items-center gap-3">
                <span
                  className={
                    'flex h-6 w-6 items-center justify-center rounded-full text-[12px] ' +
                    (feito ? 'bg-brand text-white' : 'bg-cream text-ink-mute')
                  }
                >
                  {feito ? '✓' : i + 1}
                </span>
                <span className={atual ? 'font-semibold text-ink' : feito ? 'text-ink' : 'text-ink-mute'}>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="rounded-xl border border-line bg-white p-4">
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-soft">O teu pedido</h2>
        <ul className="space-y-1 text-[13.5px]">
          {data.items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-semibold text-brand-dark">{it.quantity}×</span>
              <span>{it.name}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-2 text-right font-display text-[15px] font-semibold">
          {data.total.toFixed(2)} €
        </p>
      </div>

      <a href={`/${slug}`} className="mt-5 block text-center text-[13px] text-brand-dark underline">
        Pedir novamente
      </a>
    </main>
  );
}
```
(Se o storefront tiver um `StoreTheme`/provider de tema aplicado por `[slug]/layout.tsx`, a página herda-o automaticamente por estar dentro de `[slug]`. Se as classes `bg-cream`/`text-ink-*`/`bg-brand` não existirem, usar as equivalentes que o storefront já usa — confirmar no `tailwind.config`.)

- [ ] **Step 4: Redirect do checkout**

Em `apps/storefront/src/app/[slug]/checkout/CheckoutClient.tsx`:
1. Importar o router: `import { useRouter } from 'next/navigation';` e, no componente, `const router = useRouter();`.
2. No `submit`, no sucesso, substituir `clear(); setPlaced({ number: data.number, total: data.total });` por:
```ts
      clear();
      router.push(`/${slug}/pedido/${data.trackToken}`);
```
3. Remover o estado `placed`/`setPlaced` e o bloco de UI "Encomenda enviada!" que ficou morto (a página de acompanhamento passa a ser o ecrã pós-pedido). Se remover der muito ruído, deixar o estado mas nunca o setar — preferir remover para não deixar código morto.

- [ ] **Step 5: Typecheck + build do storefront**
```bash
export PATH="$HOME/.local/node/bin:$HOME/Library/pnpm:$PATH"
cd /Users/matheus.moraes/dev/comanda
pnpm --filter @comanda/storefront exec tsc --noEmit && pnpm --filter @comanda/storefront build
```
Esperado: sem erros; a rota `/[slug]/pedido/[token]` aparece no output do build.

- [ ] **Step 6: Commit**
```bash
cd /Users/matheus.moraes/dev/comanda
git add apps/storefront/src
git commit -m "feat(storefront): página de acompanhamento do pedido + redirect do checkout"
```

---

## Task 4: Verificação integrada (browser)

- [ ] **Step 1: Fluxo completo no browser**

Com a API (dist novo) + o storefront a correr e a demo ATIVA: na loja `pizzaria-demo`, adicionar um produto ao carrinho, ir ao checkout (levantamento, para não precisar de morada), finalizar. Confirmar:
- Após submeter, o browser **vai para `/pizzaria-demo/pedido/<token>`** e mostra a linha de estados com "Recebido" aceso.
- Avançar o estado no painel (login dono, Receção → Aceitar → Preparar → Pronto) e ver a página **atualizar sozinha** (sondagem) até "Pronto para levantar".
- Testar um pedido de ENTREGA e confirmar que a linha mostra "A caminho" → "Entregue" (passos diferentes do levantamento).
- Confirmar que um token inválido (`/pizzaria-demo/pedido/xxx`) mostra "Pedido não encontrado".
- (Opcional) confirmar num pedido com email que o email de "aceite" (log em modo json) traz o botão "Acompanhar o pedido".

Limpar os pedidos de teste da demo no fim.

- [ ] **Step 2: Handoff** — ramo pronto para revisão adversarial final e depois merge+deploy (o utilizador NOMEIA o host; `pg_dump` antes por causa da migração).

---

## Self-review (cobertura do spec)

- **§3 Modelo (trackToken + migração backfill)** → Task 1 Steps 1-3. ✓
- **§4 Endpoint público (projeção mínima, 404 neutro, throttle)** → Task 1 Steps 4-6. ✓
- **§5 Página (rota, sondagem, passos por tipo, terminais negativos, resumo)** → Task 3 Steps 1-3. ✓
- **§6 Redirect do checkout** → Task 3 Step 4. ✓
- **§7 Link em todos os emails** → Task 2. ✓
- **§8 Testes** → Task 1 Step 7 (e2e: criar/acompanhar/avançar/404/sem-PII); o util de estados é **verificado em browser** (Task 4) por o storefront não ter jest — desvio consciente ao spec (§8 pedia unit), documentado aqui. Migração preservada em Task 1 Step 3. ✓

**Consistência de tipos:** `trackToken` (schema) ↔ `data.trackToken` (checkout) ↔ `trackUrl` (email) ↔ `/public/orders/:token` ↔ `OrderTracking` (frontend) ↔ `stepsFor/currentStepIndex/isNegative`. A projeção do endpoint (§4) e o tipo `OrderTracking` têm os mesmos campos.
