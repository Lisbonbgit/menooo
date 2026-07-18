# Cancelar reserva por número + email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** O cliente que perdeu o email de confirmação consulta e cancela a reserva na página de reservar, escrevendo o número + o email — sem tocar no caminho do token (link do email).

**Architecture:** Aditivo. Uma autorização por email partilhada (`authorizeByEmail`) que espelha o `verifyToken` mas exige que a reserva seja ONLINE (`cancelTokenHash != null`, para as manuais ficarem fora). Dois endpoints novos (`lookup`, `cancel-by-email`) reutilizam a montagem de resposta e a mecânica de cancelamento já existentes, extraídas para `publicReservationView`/`doCancel`. Frontend: um bloco na página de reservar que renderiza em todos os estados (incluindo reservas desligadas).

**Tech Stack:** NestJS 10 + Prisma 6 · Next.js (App Router) + react-query + axios · scripts e2e em node puro.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-17-reservas-cancelar-por-email-design.md`. Em dúvida, o spec manda.
- **PT-PT** na copy visível e nos comentários.
- **As reservas MANUAIS ficam FORA do self-service.** O `verifyToken` já as exclui (404 quando `cancelTokenHash` é null; comentário «MANUAL nunca acessível» + teste e2e). O caminho por email TEM de manter isso: `authorizeByEmail` exige `cancelTokenHash != null` **antes** do match de email. Sem isto, um terceiro que soubesse código+email cancelava a reserva VIP/depósito.
- **Resposta neutra:** reserva inexistente, não-ONLINE, email que não bate, ou fora do TTL → **sempre** `404 "Reserva não encontrada."` Nunca revelar se o código existe.
- **Código normalizado:** `code.trim().toUpperCase()` no lookup (gerado em maiúsculas, coluna `@unique` case-sensitive; o cliente escreve-o à mão).
- **`tableNames` mantém-se** na view partilhada — o `publicByCode` já os devolve (o cliente é que não os renderiza); dropá-los muda um endpoint em produção.
- **TTL:** `startsAt + 24h < agora` → 404 (igual ao caminho do token).
- **Throttle 5/min/IP** nos dois endpoints novos. O `req.ip` é fiável (trust proxy em lista).
- **429:** o cliente NUNCA vê o inglês do `ThrottlerException` → mensagem própria.
- **Ambiente:** `export PATH="$HOME/.local/node/bin:$PATH"`. Postgres :5433. Demo: `dono@pizzaria-demo.pt` / `demo1234`, slug `pizzaria-demo`. Antes do e2e: `pkill -9 -f "dist/main"`, rebuild, um e2e de cada vez, limpar a demo.
- **NUNCA** contra produção. **NUNCA** deploy. **NUNCA** `git push`.

---

## File Structure

**API — modificar**
- `apps/api/src/modules/reservations/reservations.service.ts` — `authorizeByEmail`, `publicReservationView` (extrair de `publicByCode:515`), `doCancel` (extrair de `cancelByToken`), `publicByEmail`, `cancelByEmail`
- `apps/api/src/modules/reservations/public-reservations.controller.ts` — rotas `lookup` e `:code/cancel-by-email`
- `apps/api/src/modules/reservations/dto/public-reservation.dto.ts` — `LookupReservationDto`, `CancelByEmailDto`
- `apps/api/scripts/e2e-reservas.mjs` — casos novos

**Storefront — criar**
- `apps/storefront/src/app/[slug]/reservar/ManageReservationBlock.tsx` — o bloco de consultar/cancelar

**Storefront — modificar**
- `apps/storefront/src/app/[slug]/reservar/ReservarClient.tsx` — renderizar o bloco no ramo `gated` e no fim
- `apps/storefront/src/lib/reservation-public-hooks.ts` — hooks `useLookupReservation`, `useCancelByEmail`

---

### Task 1: Backend — autorização por email + endpoints (o coração da segurança)

**Files:**
- Modify: `reservations.service.ts` (à volta de `publicByCode:499-525`, `cancelByToken:527-556`)
- Modify: `public-reservations.controller.ts` (a seguir a `:52-53`)
- Modify: `dto/public-reservation.dto.ts`

**Interfaces:**
- Produces: `authorizeByEmail(code, email): Promise<ReservationWithTablesAndTenant>` — 404 neutro em todos os casos de falha
- Produces: `publicReservationView(row)` — o shape que o `publicByCode` já devolve, tableNames incluído
- Produces: `doCancel(row): Promise<{ ok: true }>` — a mecânica de cancelamento partilhada
- Produces: `POST /public/reservations/lookup`, `POST /public/reservations/:code/cancel-by-email`

- [ ] **Step 1: Teste e2e que falha primeiro — o guard das manuais**

Em `e2e-reservas.mjs`, um bloco novo. O caso central: uma reserva **manual** (sem `cancelTokenHash`) com o email certo tem de dar **404** — provar que o self-service não a alcança.

```js
// pré: criar reserva ONLINE (via POST público) e uma MANUAL (via POST /reservations do painel),
// ambas com o mesmo email 'lookup@teste.pt'.
const onl = await publicPost(DATE_LOOKUP, '20:00', 2, { customerEmail: 'lookup@teste.pt' }, 'lk');
const man = await manualBook(ownerToken, { date: DATE_LOOKUP, time: '21:00', partySize: 2,
  customerName: 'Manual', /* customerEmail via corpo */ });
// lookup ONLINE com email certo → 200
check('lookup online + email certo → 200', (await lookup(onl.code, 'lookup@teste.pt')).status === 200);
// lookup MANUAL com email certo → 404 (o guard cancelTokenHash!=null)
check('lookup MANUAL + email certo → 404 (manual fora do self-service)',
  (await lookup(man.code, 'manual@teste.pt')).status === 404);
```

- [ ] **Step 2: DTOs**

```ts
export class LookupReservationDto {
  @IsString() @IsNotEmpty() @MaxLength(20) code!: string;
  @IsEmail() @MaxLength(200) email!: string;
}
export class CancelByEmailDto {
  @IsEmail() @MaxLength(200) email!: string;
}
```

- [ ] **Step 3: `authorizeByEmail` + os refactors**

Extrair o `return { … }` do `publicByCode` (linhas 515-526) para `publicReservationView(row)` e
chamá-lo lá. Extrair o corpo do `cancelByToken` a partir da guarda de estado (do `if (row.status
!== CONFIRMED …)` até ao `return { ok: true }`, linha 556) para `doCancel(row)` e chamá-lo lá.
Depois:

```ts
private async authorizeByEmail(code: string, email: string) {
  const key = emailKey(email);
  if (!key) throw new NotFoundException('Reserva não encontrada.');
  const row = await this.prisma.reservation.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { tables: { include: { table: true } }, tenant: true },
  });
  if (
    !row ||
    !row.cancelTokenHash ||                                   // MANUAL/legado fora
    row.contactEmailKey !== key ||                            // email não bate
    row.startsAt.getTime() + 24 * 3_600_000 < Date.now()      // fora do TTL
  ) {
    throw new NotFoundException('Reserva não encontrada.');
  }
  return row;
}

async publicByEmail(code: string, email: string) {
  return this.publicReservationView(await this.authorizeByEmail(code, email));
}
async cancelByEmail(code: string, email: string) {
  return this.doCancel(await this.authorizeByEmail(code, email));
}
```

> `emailKey` já está importado (o cap usa-o). `contactEmailKey` está no `Reservation` (R3).

- [ ] **Step 4: Rotas**

```ts
@Public()
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Post('reservations/lookup')
lookup(@Body() dto: LookupReservationDto) {
  return this.reservations.publicByEmail(dto.code, dto.email);
}

@Public()
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Post('reservations/:code/cancel-by-email')
cancelByEmail(@Param('code') code: string, @Body() dto: CancelByEmailDto) {
  return this.reservations.cancelByEmail(code, dto.email);
}
```

> `reservations/lookup` tem de vir **antes** de `reservations/:code` no ficheiro, senão o Nest
> resolve `lookup` como um `:code`.

- [ ] **Step 5: Correr — o guard das manuais tem de passar, e a R3 não pode regredir**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
pkill -9 -f "dist/main"; pnpm --filter @comanda/api build && (node --enable-source-maps apps/api/dist/main &)
# limpar a demo; esperar o balde do throttle
node apps/api/scripts/e2e-reservas.mjs
```
Esperado: os casos novos verdes (incluindo o 404 da manual), e os 164 anteriores intactos (o
`doCancel`/`publicReservationView` extraídos não podem mudar o comportamento do caminho do token).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(reservas): consultar/cancelar por email — authorizeByEmail + 2 endpoints (T1)"
```

---

### Task 2: Backend — os restantes casos e2e

**Files:**
- Modify: `apps/api/scripts/e2e-reservas.mjs`

- [ ] **Step 1: Casos**

Acrescentar ao bloco da T1:
- lookup email errado → 404 **igual** ao de código inexistente (resposta neutra);
- **código em minúsculas** (`onl.code.toLowerCase()`) → encontra na mesma (prova o `.toUpperCase()`);
- cancelar por email → 200, o slot volta a ficar livre, `cancelledBy=CUSTOMER`;
- cancelar por email com email errado → 404;
- reserva fora do TTL (mexer `startsAt` por prisma direto para +24h no passado) → 404 no lookup e no cancel;
- throttle: 6.º pedido a `lookup` → 429.

- [ ] **Step 2: Correr + Commit**

```bash
node apps/api/scripts/e2e-reservas.mjs   # todos verdes
git add -A && git commit -m "test(reservas): e2e do cancelar-por-email (neutra, minúsculas, TTL, throttle) (T2)"
```

---

### Task 3: Frontend — hooks + o bloco de gestão

**Files:**
- Modify: `apps/storefront/src/lib/reservation-public-hooks.ts`
- Create: `apps/storefront/src/app/[slug]/reservar/ManageReservationBlock.tsx`

**Interfaces:**
- Consumes: `POST /public/reservations/lookup`, `POST /public/reservations/:code/cancel-by-email`
- Produces: `<ManageReservationBlock slug={string} />` — autónomo, só precisa do slug

- [ ] **Step 1: Hooks**

```ts
export function useLookupReservation(slug: string) {
  return useMutation({
    mutationFn: async (v: { code: string; email: string }) =>
      (await api.post(`/public/reservations/lookup`, v)).data,
  });
}
export function useCancelByEmail() {
  return useMutation({
    mutationFn: async (v: { code: string; email: string }) =>
      (await api.post(`/public/reservations/${encodeURIComponent(v.code)}/cancel-by-email`, { email: v.email })).data,
  });
}
```

- [ ] **Step 2: `ManageReservationBlock`**

Um link discreto "Já tens uma reserva? Consultar ou cancelar" (fechado por omissão). Ao abrir:
form com **Número da reserva** + **Email** + "Procurar" → `useLookupReservation`. No sucesso,
mostra o cartão de estado (reutilizar o cartão do `ReservaClient.tsx`, extraído para
`ReservationCard` se ainda não estiver — ver Task 4) com o botão "Cancelar reserva" (mesmo
diálogo de confirmação). O cancelar chama `useCancelByEmail` com o **mesmo** código+email.

Erros:
- 404 → «Reserva não encontrada. Confirma o número e o email.» (a mesma para código/email errados).
- 429 → «Demasiados pedidos. Espera um minuto e tenta de novo.» (NUNCA ecoar `data.message`).
- Após cancelar → o cartão passa a "Cancelada", o botão desaparece.

- [ ] **Step 3: typecheck + Commit**

```bash
pnpm --filter @comanda/storefront exec tsc --noEmit
git add -A && git commit -m "feat(storefront): ManageReservationBlock — consultar/cancelar por email (T3)"
```

---

### Task 4: Frontend — encaixar em TODOS os estados da página

**Files:**
- Modify: `apps/storefront/src/app/[slug]/reservar/ReservarClient.tsx`
- (talvez) Extrair `ReservationCard` de `apps/storefront/src/app/[slug]/reserva/[code]/ReservaClient.tsx`

- [ ] **Step 1: Renderizar o bloco no ramo `gated` E no fim**

O `ReservarClient` tem returns antecipados (`placed`, `store.isLoading`, `store.isError`,
`gated`). O bloco tem de aparecer **também** no ramo `gated` — é quando as reservas estão
desligadas, um dos momentos em que o cliente quer cancelar. Renderizar `<ManageReservationBlock
slug={slug} />` no return do `gated` (por baixo da mensagem «reservas indisponíveis») e no return
final. Não depende do `store`.

- [ ] **Step 2: Reutilizar o cartão (se ainda não extraído)**

O cartão de estado + diálogo do `ReservaClient.tsx` dependem só de `r`, `phone`, `canCancel`,
`confirming` e da mutação — sem acoplamento a token/sessionStorage. Extrair para
`ReservationCard` partilhado pelos dois (a página de gestão por token e o bloco novo).

- [ ] **Step 3: typecheck + Commit**

```bash
pnpm --filter @comanda/storefront exec tsc --noEmit
git add -A && git commit -m "feat(storefront): bloco de gestão em todos os estados + ReservationCard partilhado (T4)"
```

---

### Task 5: Verificação em browser

- [ ] **Step 1: Stack + demo com reservas ligadas** (mesas + serviços + uma reserva real com email conhecido).

- [ ] **Step 2: Browser (obrigatório — não delegável a "parece bem")**

- Na `/[slug]/reservar`, abrir o bloco, pesquisar a reserva com o **código em minúsculas** → aparece o cartão.
- Cancelar → confirma → passa a "Cancelada" e o slot volta (verificar na API).
- Pesquisar com email errado → «Reserva não encontrada».
- Com as reservas **desligadas** na loja → o bloco continua a aparecer (não morre no ramo `gated`).
- O caminho do token (link do email) continua a funcionar — abrir `/[slug]/reserva/[code]#t=…` de uma reserva e cancelar.

- [ ] **Step 3: Regressões + Commit**

```bash
node apps/api/scripts/e2e-reservas.mjs && node apps/api/scripts/e2e-kitchen.mjs   # tudo verde
git add -A && git commit -m "test(reservas): verificação integrada do cancelar-por-email (T5)"
```

---

## Notas de rollout

- Sem migração — nada de `pg_dump` obrigatório por esta feature (usa colunas que já existem).
- Deploy junto com as melhorias do menu (features independentes, um só deploy). O host é nomeado pelo utilizador.
