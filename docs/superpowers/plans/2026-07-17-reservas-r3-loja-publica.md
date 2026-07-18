# Reservas R3 — Loja pública, link partilhável e botão para sites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrir as reservas (R1 backend + R2 painel, já em produção mas inertes) ao cliente final: página pública `/[slug]/reservar`, link partilhável, botão `embed.js`, tudo governado por um interruptor com bloco de prontidão no painel — e protegido por Turnstile.

**Architecture:** Aditivo sobre a R1. A API ganha (a) os campos que faltam no contrato público, (b) um endpoint de disponibilidade **em lote** (`reservation-days`) porque 30 chamadas/dia estouram o throttle global, (c) verificação Turnstile *fail-closed* em produção. O storefront ganha duas rotas novas que espelham o padrão do checkout (server component + client). O painel ganha um bloco de prontidão que impede publicar uma loja partida.

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL · Next.js (App Router) + react-query + axios + Tailwind · Cloudflare Turnstile · jest (unit) + scripts e2e em node puro.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-17-reservas-r3-loja-publica-design.md`. Em caso de dúvida, o spec manda.
- **PT-PT** em toda a copy visível e nos comentários.
- **`reservationsEnabled` tem `@default(false)`** — nenhum tenant tem reservas públicas hoje. Nada nesta fase pode alterar o comportamento de quem não liga o interruptor.
- **Contrato R1 é aditivo:** nunca remover campos de respostas existentes. A única quebra autorizada é o cap passar de 429 → 409 (a R1 não tem consumidor público).
- **Advisory lock:** `tx.$executeRaw` (NUNCA `$queryRaw` — Prisma 6 rebenta a desserializar `void`) e SÓ dentro de `$transaction`.
- **Tokens:** sha256 + `timingSafeEqual`. NUNCA argon2 (CPU-exhaustion em endpoint público). Token NUNCA em query string.
- **PATCH e `undefined`:** `JSON.stringify` deita a chave fora → o backend mantém o valor antigo e a UI mente "sucesso". Para LIMPAR: `dto.x !== undefined ? (dto.x ?? '') : existing.x`. Verificar em qualquer form de edição.
- **Antes de correr o e2e:** limpar a loja demo e esperar ~60 s (o balde do throttle público é 5/min e o e2e não recupera de um balde já vazio). `pkill -9 -f "dist/main"` antes de arrancar a API — zombies servem builds velhos.
- **NUNCA correr e2e contra produção.**
- **NUNCA acrescentar `X-Frame-Options`/`frame-ancestors` ao storefront** — o `embed.js` de todos os clientes depende de ser embebível.
- Comandos: `export PATH="$HOME/.local/node/bin:$PATH"`. DB local em :5433 (`pnpm --filter @comanda/api db:serve`). Demo: `dono@pizzaria-demo.pt` / `demo1234`, slug `pizzaria-demo`.

---

## File Structure

**API — criar**
- `apps/api/src/modules/reservations/turnstile.service.ts` — verificação do token (única responsabilidade: dizer sim/não, com a fronteira do fail-open lá dentro)
- `apps/api/src/modules/reservations/turnstile.service.spec.ts`
- `apps/api/src/modules/reservations/days.util.ts` + `.spec.ts` — nada de I/O: recebe reservas+mesas e devolve que dias têm vaga
- `apps/api/prisma/migrations/*_reservation_contact_keys/migration.sql`

**API — modificar**
- `reservations.service.ts` — contrato, cap, TTL, cancelamento, 409 ordenado, days
- `public-reservations.controller.ts` — throttle nos slots, rota `reservation-days`
- `dto/public-reservation.dto.ts` — `turnstileToken`
- `tenants/tenants.service.ts` — `getPublicBySlug` + `listPublicStores`
- `tenants/tenants.controller.ts` (ou service) — recusar `reservationsEnabled=true` sem mesas
- `mail/mail.service.ts` — teto por destinatário
- `auth/auth.controller.ts` — `@Throttle` no login
- `main.ts` — aviso de arranque do Turnstile
- `app.module.ts` — registar o `TurnstileService`

**Storefront — criar**
- `src/app/[slug]/reservar/page.tsx` (server: metadata + gate)
- `src/app/[slug]/reservar/ReservarClient.tsx`
- `src/app/[slug]/reserva/[code]/page.tsx` (server: metadata noindex)
- `src/app/[slug]/reserva/[code]/ReservaClient.tsx`
- `src/lib/reservation-public-hooks.ts`

**Storefront — modificar**
- `src/lib/types.ts`, `src/app/[slug]/StoreClient.tsx`, `src/app/sitemap.ts`, `public/embed.js`, `Dockerfile`, `docker-compose.prod.yml`

**Dashboard — criar**
- `src/app/reservations/components/ReadinessCard.tsx`

**Dashboard — modificar**
- `src/app/reservations/page.tsx`, `components/ReservationSettings.tsx`

---

### Task 1: Contrato público — os campos que faltam

Sem isto a página é inconstruível: os chips 1–8 perdiam os grupos de 9–12 (o default é **12**), o "liga-nos" não tem número, e a grelha de dias ignora `reservationMaxAdvanceDays`.

**Files:**
- Modify: `apps/api/src/modules/tenants/tenants.service.ts` (`getPublicBySlug` ~41-58, `listPublicStores` ~63-70)
- Modify: `apps/api/src/modules/reservations/reservations.service.ts` (`publicByCode` ~406-417)
- Modify: `apps/storefront/src/lib/types.ts`
- Test: `apps/api/scripts/e2e-reservas.mjs`

**Interfaces:**
- Produces: `getPublicBySlug` passa a devolver, além do atual: `phone: string | null`, `address: string | null`, `zipCode: string | null`, `reservationMaxPartySize: number`, `reservationMaxAdvanceDays: number`.
- Produces: `publicByCode` passa a devolver `restaurantPhone: string | null`.
- Produces: `listPublicStores` passa a devolver `{ slug, updatedAt, reservationsEnabled }`.

- [ ] **Step 1: Estender `getPublicBySlug`**

No return de `getPublicBySlug`, a seguir a `reservationsEnabled: rest.reservationsEnabled,`:

```ts
      phone: rest.phone,
      address: rest.address,
      zipCode: rest.zipCode,
      reservationMaxPartySize: rest.reservationMaxPartySize,
      reservationMaxAdvanceDays: rest.reservationMaxAdvanceDays,
```

> `getPublicBySlug` **não** é gated por `reservationsEnabled` (de propósito: a página de gestão tem de sobreviver a o dono desligar as reservas). Não mudar isso.

- [ ] **Step 2: `publicByCode` devolve o telefone**

Em `publicByCode`, no return, a seguir a `restaurantName: row.tenant.name,`:

```ts
      restaurantPhone: row.tenant.phone,
```

- [ ] **Step 3: `listPublicStores` devolve o flag**

Acrescentar `reservationsEnabled` ao `select`/map de `listPublicStores`.

- [ ] **Step 4: `interface Store` no storefront**

Em `apps/storefront/src/lib/types.ts`, dentro de `interface Store`, a seguir a `isOpen: boolean;`:

```ts
  reservationsEnabled: boolean;
  phone: string | null;
  address: string | null;
  zipCode: string | null;
  reservationMaxPartySize: number;
  reservationMaxAdvanceDays: number;
```

- [ ] **Step 5: Provar com um pedido real**

```bash
curl -s http://localhost:3001/api/public/stores/pizzaria-demo | python3 -m json.tool | grep -E "phone|address|MaxParty|MaxAdvance|reservationsEnabled"
```
Esperado: os 6 campos presentes.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(reservas): contrato público expõe phone/morada/maxParty/maxAdvance (R3-T1)"
```

---

### Task 2: `reservation-days` — disponibilidade em lote

**O blocker.** 30 dias × 1 chamada, refeitas a cada mudança de nº de pessoas ≈ 90–120 pedidos/min contra o **global de 100/min por IP** → 429 a meio da reserva, pior em CGNAT. Medido: a latência não é o problema (30 dias = 60 ms); o orçamento do throttle e ~120 queries/abertura é que são.

**Files:**
- Create: `apps/api/src/modules/reservations/days.util.ts`
- Create: `apps/api/src/modules/reservations/days.util.spec.ts`
- Modify: `apps/api/src/modules/reservations/reservations.service.ts`
- Modify: `apps/api/src/modules/reservations/public-reservations.controller.ts`

**Interfaces:**
- Produces: `ReservationsService.publicDays(slug: string, fromISO: string, toISO: string, party: number): Promise<{ days: { date: string; hasSlots: boolean }[] }>`
- Produces: `GET /api/public/stores/:slug/reservation-days?from&to&party`

- [ ] **Step 1: Teste que falha — o lote bate certo com o dia-a-dia**

O invariante que interessa é a **equivalência**: para cada dia, `hasSlots === (slots do dia).length > 0`. Escrever em `apps/api/scripts/e2e-reservas.mjs` (novo bloco, ver Task 12) e um unit em `days.util.spec.ts` para a lógica pura.

- [ ] **Step 2: Refactor mínimo — extrair o ciclo de slots de um dia**

`slotsForDayTx` (reservations.service.ts:128-188) faz: (1) guardas, (2) `busy` de 36 h, (3) `tables`, (4) ciclo por minuto com `assignTables`. Para o lote, (2) e (3) passam a ser feitas **uma vez** para todo o intervalo.

Em `days.util.ts` (puro, sem I/O — testável):

```ts
import { assignTables } from './assign.util';

export interface BusyLike {
  startsAt: Date;
  endsAt: Date;
  tables: { tableId: string }[];
}

/** Mesas ocupadas no intervalo [start, end) com buffer — extraído do ciclo de slotsForDayTx. */
export function occupiedAt(busy: BusyLike[], start: Date, end: Date, bufMs: number): Set<string> {
  const occupied = new Set<string>();
  for (const r of busy) {
    if (r.startsAt.getTime() < end.getTime() + bufMs && r.endsAt.getTime() + bufMs > start.getTime()) {
      for (const rt of r.tables) occupied.add(rt.tableId);
    }
  }
  return occupied;
}

/** true se ALGUM instante da lista tem mesa para `party`. Pára no primeiro (é só hasSlots). */
export function dayHasSlot(
  starts: Date[],
  busy: BusyLike[],
  tables: Parameters<typeof assignTables>[0],
  party: number,
  durMs: number,
  bufMs: number,
  notBefore: number,
): boolean {
  for (const start of starts) {
    if (start.getTime() < notBefore) continue;
    const end = new Date(start.getTime() + durMs);
    if (assignTables(tables, occupiedAt(busy, start, end, bufMs), party, 'ONLINE')) return true;
  }
  return false;
}
```

- [ ] **Step 3: `publicDays` no service**

Regras que TÊM de ser as mesmas do dia-a-dia (senão o lote mente): dia bloqueado → `hasSlots:false`; `diffDays < 0 || > reservationMaxAdvanceDays` → `false`; `party > reservationMaxPartySize` → todos `false` + `reason:'party'`; `minutesList` vazio → `false`.

```ts
  /** Disponibilidade de um INTERVALO (1 query de reservas + 1 de mesas para tudo). */
  async publicDays(slug: string, fromISO: string, toISO: string, party: number) {
    const okISO = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '') && isRealDateISO(s);
    if (!okISO(fromISO) || !okISO(toISO) || !Number.isInteger(party) || party < 1 || party > 50) {
      throw new BadRequestException('Parâmetros inválidos.');
    }
    const spanDays = Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000);
    if (spanDays < 0 || spanDays > 62) throw new BadRequestException('Intervalo inválido.');

    const tenant = await this.gatedTenant(slug);
    const tz = tenant.timezone || 'Europe/Lisbon';
    if (party > tenant.reservationMaxPartySize) {
      return { days: [], reason: 'party', contactPhone: tenant.phone };
    }

    const dates: string[] = [];
    for (let i = 0; i <= spanDays; i++) {
      dates.push(localDateISO(new Date(Date.parse(fromISO) + i * 86_400_000), 'UTC'));
    }

    const rangeStart = localDateTimeToUtc(dates[0], 0, tz);
    const rangeEnd = new Date(localDateTimeToUtc(dates[dates.length - 1], 0, tz).getTime() + 36 * 3_600_000);
    const bufMs = tenant.reservationBufferMin * 60_000;
    const durMs = tenant.reservationDurationMin * 60_000;
    const notBefore = Date.now() + tenant.reservationMinNoticeMin * 60_000;

    const [busy, tables, blocks] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          tenantId: tenant.id,
          status: 'CONFIRMED',
          startsAt: { lt: new Date(rangeEnd.getTime() + bufMs) },
          endsAt: { gt: new Date(rangeStart.getTime() - bufMs) },
        },
        include: { tables: true },
      }),
      this.prisma.table.findMany({ where: { tenantId: tenant.id, active: true } }),
      this.prisma.reservationBlock.findMany({
        where: { tenantId: tenant.id, date: { in: dates } },
      }),
    ]);
    const blocked = new Set(blocks.map((b) => b.date));
    const todayISO = localDateISO(new Date(), tz);

    const days = dates.map((date) => {
      const diffDays = Math.round((Date.parse(date) - Date.parse(todayISO)) / 86_400_000);
      if (blocked.has(date) || diffDays < 0 || diffDays > tenant.reservationMaxAdvanceDays) {
        return { date, hasSlots: false };
      }
      const minutesList = slotMinutes(this.windowsFor(tenant, weekdayOf(date)));
      if (minutesList.length === 0) return { date, hasSlots: false };
      const seen = new Set<number>();
      const starts: Date[] = [];
      for (const m of minutesList) {
        const start = localDateTimeToUtc(date, m, tz);
        if (seen.has(start.getTime())) continue; // dedup DST
        seen.add(start.getTime());
        starts.push(start);
      }
      return { date, hasSlots: dayHasSlot(starts, busy, tables, party, durMs, bufMs, notBefore) };
    });
    return { days };
  }
```

- [ ] **Step 4: Rota + throttle dedicado nos slots**

Em `public-reservations.controller.ts`, substituir o handler `slots` e acrescentar `days`:

```ts
  /** Slots de um dia — throttle dedicado: é o passo de reconhecimento e um amplificador de queries. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('stores/:slug/reservation-slots')
  slots(@Param('slug') slug: string, @Query('date') date: string, @Query('party') party: string) {
    return this.reservations.publicSlots(slug, date, Number(party));
  }

  /** Disponibilidade de um intervalo — 1 pedido em vez de 30 (ver spec §4). */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('stores/:slug/reservation-days')
  days(
    @Param('slug') slug: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('party') party: string,
  ) {
    return this.reservations.publicDays(slug, from, to, Number(party));
  }
```

- [ ] **Step 5: Provar a equivalência com dados reais**

Com a demo com mesas e janelas, comparar os 30 dias do lote com 30 chamadas dia-a-dia; têm de bater 100%.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(reservas): reservation-days em lote + throttle dedicado nos slots (R3-T2)"
```

---

### Task 3: Turnstile — serviço, fail-closed e a fronteira do fail-open

**Files:**
- Create: `apps/api/src/modules/reservations/turnstile.service.ts` + `.spec.ts`
- Modify: `dto/public-reservation.dto.ts`, `reservations.service.ts`, `reservations.module.ts`, `main.ts`

**Interfaces:**
- Produces: `TurnstileService.verify(token: string | undefined, remoteIp?: string): Promise<void>` — lança `ForbiddenException` ou `ServiceUnavailableException`; resolve em silêncio quando desligado ou em fail-open.
- Produces: `TurnstileService.isEnforced(): boolean`
- Produces: `TurnstileService.stats(): { enforced: boolean; consecutiveFailures: number }` (para o `/health`)

- [ ] **Step 1: `turnstileToken` no DTO**

`main.ts` usa `forbidNonWhitelisted: true` → sem esta declaração, **todos** os POSTs levam 400 assim que a sitekey existir. Não é opcional de facto.

Em `CreatePublicReservationDto`, a seguir a `marketingConsent`:

```ts
  @IsOptional() @IsString() @MaxLength(2048) turnstileToken?: string;
```

- [ ] **Step 2: O serviço**

```ts
import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const REJECT = 'Não foi possível validar o pedido. Tenta de novo.';

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private consecutiveFailures = 0;
  private inFlight = 0;

  private get secret(): string {
    return process.env.TURNSTILE_SECRET_KEY ?? '';
  }

  /** Em produção sem secret o endpoint público NÃO abre (a menos de escape explícito). */
  isEnforced(): boolean {
    return this.secret !== '';
  }

  isMisconfigured(): boolean {
    return (
      process.env.NODE_ENV === 'production' && !this.isEnforced() && process.env.TURNSTILE_OPTIONAL !== '1'
    );
  }

  stats() {
    return { enforced: this.isEnforced(), consecutiveFailures: this.consecutiveFailures };
  }

  async verify(token: string | undefined, remoteIp?: string): Promise<void> {
    // Fail-closed: prod sem chaves não serve reservas em silêncio (spec §5).
    if (this.isMisconfigured()) {
      throw new ServiceUnavailableException('Reservas online temporariamente indisponíveis.');
    }
    if (!this.isEnforced()) return; // local/dev/e2e

    if (!token) throw new ForbiddenException(REJECT);

    // Teto de concorrência: a nossa própria saturação não pode disparar o fail-open.
    if (this.inFlight >= 20) throw new ForbiddenException(REJECT);

    let data: { success?: boolean; action?: string; hostname?: string; 'error-codes'?: string[] };
    this.inFlight++;
    try {
      const body = new URLSearchParams({ secret: this.secret, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5_000),
      });
      // Resposta não-2xx ou não-JSON => 403. NUNCA fail-open (spec §5).
      if (!res.ok) throw new ForbiddenException(REJECT);
      data = (await res.json()) as typeof data;
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      // SÓ rede/timeout/JSON partido chega aqui => fail-open deliberado.
      this.consecutiveFailures++;
      this.logger.error(
        `turnstile_unreachable (${this.consecutiveFailures}x consecutivas): ${(e as Error)?.message}`,
      );
      return;
    } finally {
      this.inFlight--;
    }

    this.consecutiveFailures = 0;

    // `timeout-or-duplicate` (replay) e `invalid-input-response` caem aqui — 403, nunca open.
    // É a Cloudflare que garante uso único do token; não precisamos de store de idempotência.
    if (data.success !== true) {
      this.logger.warn(`turnstile_rejected: ${(data['error-codes'] ?? []).join(',')}`);
      throw new ForbiddenException(REJECT);
    }
    const expectedAction = 'reserva';
    if (data.action && data.action !== expectedAction) {
      this.logger.warn(`turnstile_rejected: action=${data.action}`);
      throw new ForbiddenException(REJECT);
    }
    const allowed = (process.env.TURNSTILE_HOSTNAMES ?? '').split(',').map((h) => h.trim()).filter(Boolean);
    if (allowed.length > 0 && data.hostname && !allowed.includes(data.hostname)) {
      this.logger.warn(`turnstile_rejected: hostname=${data.hostname}`);
      throw new ForbiddenException(REJECT);
    }
  }
}
```

> A copy diz «Tenta de novo», **não** «Recarrega a página» — recarregar deita fora o formulário todo, e este 403 acontece sobretudo a gente legítima cujo token expirou (~5 min). O cliente faz `reset()` em silêncio (Task 8).

- [ ] **Step 3: Ligar ao `createPublic`**

`createPublic` passa a receber o IP. No controller:

```ts
  @Post('stores/:slug/reservations')
  create(@Param('slug') slug: string, @Body() dto: CreatePublicReservationDto, @Ip() ip: string) {
    return this.reservations.createPublic(slug, dto, ip);
  }
```

E no service, **primeira linha** de `createPublic` (antes de qualquer query — não gastamos DB em pedidos que vão ser recusados):

```ts
  async createPublic(slug: string, dto: CreatePublicReservationDto, remoteIp?: string) {
    await this.turnstile.verify(dto.turnstileToken, remoteIp);
    if (!isRealDateISO(dto.date)) throw new BadRequestException('Data inválida.');
```

Injetar no construtor: `private readonly turnstile: TurnstileService,` e declarar no `providers` do `reservations.module.ts`.

- [ ] **Step 4: Aviso ruidoso no arranque + `/health`**

Em `main.ts`, antes do `app.listen`:

```ts
  if (process.env.NODE_ENV === 'production') {
    if (process.env.TURNSTILE_SECRET_KEY) {
      console.log('🛡️  Turnstile ATIVO nas reservas públicas');
    } else if (process.env.TURNSTILE_OPTIONAL === '1') {
      console.warn('⚠️  Turnstile DESLIGADO por TURNSTILE_OPTIONAL=1 — reservas públicas sem proteção');
    } else {
      console.error('❌ TURNSTILE_SECRET_KEY em falta: as reservas públicas vão responder 503');
    }
  }
```

Acrescentar `turnstile: this.turnstile.stats()` à resposta do `/health`.

- [ ] **Step 5: Unit com os secrets de teste da Cloudflare**

A validação real **é** testável — a versão anterior do spec dizia que não. Secrets públicos da Cloudflare:
`1x0000000000000000000000000000000AA` passa sempre · `2x0000000000000000000000000000000AA` falha sempre · `3x0000000000000000000000000000000AA` devolve `timeout-or-duplicate`.

```ts
describe('TurnstileService', () => {
  const svc = new TurnstileService();
  afterEach(() => { delete process.env.TURNSTILE_SECRET_KEY; delete process.env.NODE_ENV; });

  it('sem secret é no-op (dev/e2e)', async () => {
    await expect(svc.verify(undefined)).resolves.toBeUndefined();
  });

  it('em produção sem secret responde 503 (fail-closed)', async () => {
    process.env.NODE_ENV = 'production';
    await expect(svc.verify('x')).rejects.toThrow(ServiceUnavailableException);
  });

  it('secret de teste que FALHA SEMPRE → 403 (prova o caminho real)', async () => {
    process.env.TURNSTILE_SECRET_KEY = '2x0000000000000000000000000000000AA';
    await expect(svc.verify('qualquer-token')).rejects.toThrow(ForbiddenException);
  }, 15_000);

  it('secret de teste que PASSA SEMPRE → resolve', async () => {
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    await expect(svc.verify('qualquer-token')).resolves.toBeUndefined();
  }, 15_000);

  it('token já gasto (replay) → 403, não fail-open', async () => {
    process.env.TURNSTILE_SECRET_KEY = '3x0000000000000000000000000000000AA';
    await expect(svc.verify('qualquer-token')).rejects.toThrow(ForbiddenException);
  }, 15_000);
});
```

> Estes 3 testes chamam a Cloudflare a sério. Se o ambiente de CI não tiver rede, marcá-los com `it.skip` **explicitamente comentado** — nunca deixar o único caminho testado ser o no-op.

- [ ] **Step 6: Correr e commitar**

```bash
pnpm --filter @comanda/api test
git add -A && git commit -m "feat(reservas): Turnstile fail-closed em prod, fronteira do fail-open exata (R3-T3)"
```

---

### Task 4: Cap por contacto — normalizar, subir para 3, devolver o telefone

Hoje o cap compara strings cruas: `Ana@x.pt` ≠ `ana@x.pt ` são 2 contactos e **a mesma caixa**. E apanha o casal que partilha telefone e quem marca sexta+domingo — o cliente fiel. A mensagem manda «Contacta-o diretamente» **sem dar o contacto**.

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_reservation_contact_keys/migration.sql`
- Modify: `apps/api/prisma/schema.prisma`, `reservations.service.ts`
- Create: `apps/api/src/modules/reservations/contact.util.ts` + `.spec.ts`

**Interfaces:**
- Produces: `emailKey(v: string | null | undefined): string | null`, `phoneKey(v: string | null | undefined): string | null`
- Produces: `Reservation.contactEmailKey`, `Reservation.contactPhoneKey` (ambos `String?`, indexados com `tenantId`)

- [ ] **Step 1: Utils puros + testes**

```ts
/** trim + lowercase. NÃO desfaz aliasing de gmail (pontos/+tag): arrisca falsos positivos e YAGNI. */
export function emailKey(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase();
  return s === '' ? null : s;
}

/** só dígitos, últimos 9 (PT): +351912345678, 912 345 678 e 912345678 são o mesmo contacto. */
export function phoneKey(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  return d === '' ? null : d.slice(-9);
}
```

Testes: `emailKey(' Ana@X.pt ') === 'ana@x.pt'`; `phoneKey('+351 912 345 678') === '912345678'`; `phoneKey('912345678') === '912345678'`; ambos `null` para vazio.

- [ ] **Step 2: Schema + migração aditiva**

No modelo `Reservation`:

```prisma
  contactEmailKey String?
  contactPhoneKey String?

  @@index([tenantId, contactEmailKey])
  @@index([tenantId, contactPhoneKey])
```

Gerar com `pnpm --filter @comanda/api exec prisma migrate dev --name reservation_contact_keys`. Backfill no `migration.sql` (as reservas existentes têm de contar para o cap):

```sql
UPDATE "Reservation"
SET "contactEmailKey" = NULLIF(lower(trim("customerEmail")), ''),
    "contactPhoneKey" = NULLIF(right(regexp_replace("customerPhone", '\D', '', 'g'), 9), '');
```

- [ ] **Step 3: Escrever as keys**

Em `createPublic` (no `createRowWithCode`) e em **todos** os sítios que criam/editam reservas (painel manual + edição), preencher:

```ts
          contactEmailKey: emailKey(dto.customerEmail),
          contactPhoneKey: phoneKey(dto.customerPhone),
```

> Procurar com `grep -rn "customerPhone:" apps/api/src/modules/reservations/` e cobrir **todos** — uma reserva manual sem key não conta para o cap.

- [ ] **Step 4: O cap passa a usar as keys, sobe para 3, e vira 409**

O 429 do cap e o 429 do throttle eram indistinguíveis, e o `ThrottlerException` sai **em inglês** para o cliente. Substituir o bloco do cap (reservations.service.ts ~319-330):

```ts
        // cap anti-spam por contacto NORMALIZADO (dentro do lock). 409 e não 429: o 429 fica
        // exclusivo do throttle, senão o cliente não distingue os dois e apanha texto inglês.
        const eKey = emailKey(dto.customerEmail);
        const pKey = phoneKey(dto.customerPhone);
        const contactOr: Prisma.ReservationWhereInput[] = [];
        if (eKey) contactOr.push({ contactEmailKey: eKey });
        if (pKey) contactOr.push({ contactPhoneKey: pKey });
        if (contactOr.length > 0) {
          const activeByContact = await tx.reservation.count({
            where: { tenantId: tenant.id, status: 'CONFIRMED', startsAt: { gt: new Date() }, OR: contactOr },
          });
          if (activeByContact >= 3) {
            throw new ConflictException({
              message: 'Já tens reservas ativas neste restaurante. Liga-nos para marcar mais.',
              code: 'CONTACT_CAP',
              contactPhone: tenant.phone,
            });
          }
        }
```

> O `OR` é construído **condicionalmente** por higiene (um `OR: []` casaria com tudo). Nota: testei que `OR: [{ campo: undefined }]` **não** casa com tudo no Prisma 6 — o membro é removido —, ao contrário do que a revisão afirmou; mas construir condicionalmente é na mesma o que se lê melhor.

- [ ] **Step 5: Ordenar as `alternatives` do 409 por proximidade**

Hoje são `slots.slice(0, 4)` = os 4 **primeiros do dia**: quem tenta 21:00 recebe «12:00 · 12:30 · 13:00». Não é alternativa, lê-se como avaria. Substituir no `ConflictException` de horário ocupado:

```ts
          const near = slots
            .slice()
            .sort((a, b) => Math.abs(a.start.getTime() - wanted.getTime()) - Math.abs(b.start.getTime() - wanted.getTime()))
            .slice(0, 4)
            .sort((a, b) => a.start.getTime() - b.start.getTime()); // cronológico só para exibir
          throw new ConflictException({
            message: 'Esse horário acabou de ficar ocupado.',
            alternatives: near.map((s) => s.label),
          });
```

- [ ] **Step 6: Commit**

```bash
pnpm --filter @comanda/api test
git add -A && git commit -m "feat(reservas): cap por contacto normalizado (3), 409 c/ telefone, alternativas por proximidade (R3-T4)"
```

---

### Task 5: Token de gestão — TTL e cancelamento até ao fim

O `cancelTokenHash` é hoje uma credencial bearer **eterna**: `verifyToken` só compara o hash, sem noção de tempo. Continua válido depois do jantar, depois de CANCELLED, para sempre — é isto que transforma cada vetor de fuga (histórico sincronizado, extensões, email reencaminhado, screenshot, quiosque) de janela em permanente.

**Files:**
- Modify: `apps/api/src/modules/reservations/reservations.service.ts`

- [ ] **Step 1: TTL no acesso público**

Em `publicByCode` e `cancelByToken`, logo a seguir ao `verifyToken`:

```ts
    // O token expira por TEMPO e não por estado: quem clica no link logo após cancelar
    // continua a ver "reserva cancelada" em vez de um 404 confuso.
    if (row.startsAt.getTime() + 24 * 3_600_000 < Date.now()) {
      throw new NotFoundException('Reserva não encontrada.');
    }
```

- [ ] **Step 2: Cancelar até `endsAt`, não `startsAt`**

Um cancelamento tardio é sempre melhor para o dono que um no-show mudo: hoje quem se atrasa 10 min e quer avisar leva um erro seco e a mesa fica bloqueada 120 min até alguém marcar NO_SHOW à mão. Em `cancelByToken`:

```ts
    if (row.status !== ReservationStatus.CONFIRMED || row.endsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Esta reserva já não pode ser cancelada.');
    }
```

- [ ] **Step 3: e2e cobre os dois** (ver Task 12) e **Commit**

```bash
git add -A && git commit -m "feat(reservas): TTL do token de gestão + cancelar até endsAt (R3-T5)"
```

---

### Task 6: MailService — teto por destinatário

Cada create dispara 2 emails e cada cancel mais 2, e o cancel público **não tem Turnstile**: 1 desafio = até 4 emails, 2 deles para um endereço escolhido pelo atacante e nunca verificado. O `MAIL_FROM` é **único e partilhado por toda a plataforma** (Resend) → uma campanha queima a reputação de envio de **todos** os tenants, não só do restaurante alvo.

**Files:**
- Modify: `apps/api/src/modules/mail/mail.service.ts`

- [ ] **Step 1: Contador em memória com janela deslizante**

No `MailService`, antes do `send()`:

```ts
  private readonly recentByRecipient = new Map<string, number[]>();
  private static readonly MAX_PER_DAY = 5;

  /** Teto por destinatário: o Turnstile PREÇA o abuso, não o limita. Protege terceiros e a
   *  reputação do MAIL_FROM, que é partilhado por TODOS os tenants. */
  private overRecipientLimit(to: string): boolean {
    const key = to.trim().toLowerCase();
    const now = Date.now();
    const win = (this.recentByRecipient.get(key) ?? []).filter((t) => now - t < 86_400_000);
    if (win.length >= MailService.MAX_PER_DAY) {
      this.recentByRecipient.set(key, win);
      return true;
    }
    win.push(now);
    this.recentByRecipient.set(key, win);
    if (this.recentByRecipient.size > 5_000) {
      for (const [k, v] of this.recentByRecipient) if (v.every((t) => now - t >= 86_400_000)) this.recentByRecipient.delete(k);
    }
    return false;
  }
```

- [ ] **Step 2: Aplicar SÓ aos emails de reserva**

Nos 4 métodos `sendReservation*`, no topo:

```ts
    if (this.overRecipientLimit(to)) {
      this.logger.warn(`mail_rate_limited: destinatário atingiu o teto diário de emails de reserva`);
      return;
    }
```

> **Não** aplicar em `send()` genérico: emails transacionais de conta (verificação, reposição de password) não podem ser silenciados por isto.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(mail): teto de 5 emails de reserva por destinatário/24h (R3-T6)"
```

---

### Task 7: Prontidão — recusar publicar uma loja partida + `@Throttle` no login

Nada impede hoje `reservationsEnabled=true` com **0 mesas**: a montra ganha o botão «Reservar mesa», o cliente abre e vê 30 dias vazios — uma loja publicamente partida — e o dono não recebe sinal nenhum.

**Files:**
- Modify: `apps/api/src/modules/tenants/tenants.service.ts`, `apps/api/src/modules/auth/auth.controller.ts`

- [ ] **Step 1: Recusar no servidor**

No `update` do tenant (o que serve o `PATCH /tenants/me`), antes de gravar:

```ts
    // ligar reservas sem mesas publica uma loja partida (30 dias vazios) — spec §11
    if (dto.reservationsEnabled === true) {
      const bookable = await this.prisma.table.count({
        where: { tenantId, active: true, bookableOnline: true },
      });
      if (bookable === 0) {
        throw new BadRequestException('Cria pelo menos uma mesa reservável online antes de ligar as reservas.');
      }
    }
```

- [ ] **Step 2: `@Throttle` no login**

O `POST /auth/login` não tem throttle nenhum — só o global de 100/min = 144k tentativas/dia por IP. Agora que o `req.ip` deixou de ser falsificável (commit `2053fc8`), o limite passa a valer:

```ts
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
```

- [ ] **Step 3: Provar**

```bash
# 12 logins errados seguidos: os 2 últimos têm de dar 429
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"dono@pizzaria-demo.pt","password":"errada"}'; done; echo
```
Esperado: `401 ×10` depois `429 429`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(api): recusar reservas sem mesas + throttle no login (R3-T7)"
```

---

### Task 8: Storefront — `/[slug]/reservar`

**Files:**
- Create: `apps/storefront/src/app/[slug]/reservar/page.tsx`, `ReservarClient.tsx`, `src/lib/reservation-public-hooks.ts`

**Interfaces:**
- Consumes: Task 1 (campos do payload), Task 2 (`reservation-days`), Task 3 (`turnstileToken`), Task 4 (`code: 'CONTACT_CAP'`, `alternatives`).

- [ ] **Step 1: `page.tsx` — dinâmica e indexável**

`/reservar` **não pode ser estática**: o `notFound()` do gating ficaria cacheado 5 min e o dono, ao ligar as reservas e abrir o link do painel, levava 404 no primeiro gesto. E **é indexável** (ao contrário do checkout): é uma landing pública, sem estado, que é o que se procura por «reservar mesa \<restaurante\>».

```tsx
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ReservarClient } from './ReservarClient';

export const dynamic = 'force-dynamic'; // o gate não pode ser cacheado (spec §7)

async function getStore(slug: string) {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const res = await fetch(`${base}/api/public/stores/${slug}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) return undefined; // erro de rede: não deitar a página abaixo
  return res.json();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = await getStore(slug);
  if (!s) return { title: 'Reservar mesa' };
  const local = s.city ? ` em ${s.city}` : '';
  return {
    title: `Reservar mesa — ${s.name}`,
    description: `Reserva a tua mesa n${'’'}${s.name}${local}. Confirmação imediata, grátis e sem compromisso.`,
    openGraph: { images: s.coverUrl ? [s.coverUrl] : [] },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await getStore(slug);
  if (store === null) notFound(); // loja inexistente
  return <ReservarClient slug={slug} />;
}
```

- [ ] **Step 2: Hooks**

`cache: 'no-store'` é **no-op no axios** (o repo usa axios + react-query) e um pedido do cliente nunca esteve sob o ISR. O risco real é a cache do react-query: depois de um 409 serviria a hora já ocupada outra vez.

```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useReservationDays(slug: string, from: string, to: string, party: number, enabled: boolean) {
  return useQuery({
    queryKey: ['res-days', slug, from, to, party],
    queryFn: async () =>
      (await api.get<{ days: { date: string; hasSlots: boolean }[]; reason?: string }>(
        `/public/stores/${slug}/reservation-days`, { params: { from, to, party } })).data,
    staleTime: 0, gcTime: 0, retry: false, enabled,
  });
}

export function useReservationSlots(slug: string, date: string | null, party: number) {
  return useQuery({
    queryKey: ['res-slots', slug, date, party],
    queryFn: async () =>
      (await api.get<{ slots: string[]; reason?: string; contactPhone?: string | null }>(
        `/public/stores/${slug}/reservation-slots`, { params: { date, party } })).data,
    staleTime: 0, gcTime: 0, retry: false, enabled: !!date,
  });
}
```

- [ ] **Step 3: `ReservarClient.tsx`**

Espelhar `CheckoutClient.tsx` (passos, `Field`, toasts) e renderizar `<StoreTheme brandColor heroColor />` em **todos** os ramos de return — o `StoreTheme` mete CSS vars num `useEffect` e remove-as no unmount; o `CheckoutClient` renderiza-o 3× por isso mesmo.

Blocos, por ordem:
1. **Topo:** nome, morada (`address`, `zipCode`, `city`), chip `tel:` e `<AddressMap>` (Nominatim, grátis, sem chave — no checkout serve a morada do cliente, aqui a do restaurante).
2. **Pessoas:** chips `1..store.reservationMaxPartySize` (wrap; 12 cabem no mobile) + «mais de {max} · liga-nos» com o `phone` do payload — sem round-trip. Se `phone` for null: «contacta-nos pela loja» + link para `/[slug]`.
3. **Dia:** `min(30, store.reservationMaxAdvanceDays)` chips via `useReservationDays` (**1** pedido). Dias com `hasSlots:false` esbatidos e não clicáveis.
4. **Hora:** chips de `useReservationSlots` do dia tocado. Vazio → «Sem horários neste dia».
5. **Dados:** nome, telefone, email, notas, marketing, Turnstile. Placeholder das notas que **vende** o campo — numa reserva a nota É a intenção: `Ex.: aniversário, cadeira de bebé, mesa na esplanada, acesso com carrinho`. Por cima do submit: «Reserva grátis e sem compromisso — podes cancelar a qualquer momento no link que te damos a seguir.»
6. **Confirmação:** código grande, dia/hora/pessoas, morada, «Chega à hora marcada; se te atrasares, liga ao restaurante para não perderes a mesa», e **«Gerir a minha reserva» como BOTÃO** (`href` = `manageUrl`), nunca o URL como texto — o manage URL **é** a credencial e texto literal põe um bearer token em todos os screenshots.

**Nunca mostrar `tableNames`** ao cliente: o R4 existe para o dono arrastar reservas entre mesas, e «Mesa 7» num email imutável cria clientes que exigem a Mesa 7 depois de terem sido movidos.

Estado de gating a meio do fluxo (404 do `reservation-days`/`slots`): «As reservas online desta loja estão indisponíveis» + link para `/[slug]`.

- [ ] **Step 4: Turnstile no cliente**

Widget só se `process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY` existir (sem chave o form funciona — dev). Carregar o script da Cloudflare, `action: 'reserva'`, obter o token **no submit** (não à carga da página — expira em ~5 min). Timeout de ~8 s a carregar → mostrar o fallback de telefone em vez de submeter para um 403 garantido.

No 403: `turnstile.reset()` em **silêncio**, manter todo o estado, re-submeter **uma** vez; só a segunda falha mostra erro, e sem perder o formulário.

- [ ] **Step 5: Erros**

- **409 com `alternatives`:** chips clicáveis («Essa hora acabou de ficar ocupada — 20:30 · 21:00»). `invalidateQueries(['res-slots'])`.
- **409 com `code: 'CONTACT_CAP'`:** mensagem do servidor + `<a href="tel:">` com o `contactPhone`.
- **429:** **nunca** ecoar `data.message` (vem `ThrottlerException: Too Many Requests` em inglês) → «Demasiados pedidos deste dispositivo. Espera um minuto e tenta de novo.»
- **422/400:** mensagem do servidor.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(storefront): página pública de reserva (R3-T8)"
```

---

### Task 9: Storefront — `/[slug]/reserva/[code]` (gestão)

**Files:**
- Create: `apps/storefront/src/app/[slug]/reserva/[code]/page.tsx`, `ReservaClient.tsx`

- [ ] **Step 1: `page.tsx` — casca noindex**

O token vem no fragmento `#t=`, que **nunca chega ao servidor** → só é legível no cliente → **«sem token válido → 404 neutro» não pode ser um 404 HTTP**: o documento sai 200 e o «Reserva não encontrada» é estado renderizado. Assumir a diferença.

```tsx
import type { Metadata } from 'next';
import { ReservaClient } from './ReservaClient';

// Página privada (traz token no fragmento): nunca indexar. O robots.ts do storefront faz
// allow: '/' sem Disallow, logo o noindex TEM de vir daqui.
export const metadata: Metadata = {
  title: 'A minha reserva',
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ slug: string; code: string }> }) {
  const { slug, code } = await params;
  return <ReservaClient slug={slug} code={code} />;
}
```

> Título genérico — nunca o nome do cliente.

- [ ] **Step 2: `ReservaClient.tsx` — ler o hash em primeiro lugar**

Ler o fragmento e correr o `history.replaceState` **de forma síncrona no topo do componente**, antes de qualquer outro efeito:

```tsx
const [token] = useState<string | null>(() => {
  if (typeof window === 'undefined') return null;
  const m = window.location.hash.match(/[#&]t=([a-f0-9]{64})/i);
  if (m) {
    sessionStorage.setItem(`res-token:${code}`, m[1]);
    history.replaceState(null, '', window.location.pathname); // tira o token do URL/histórico
    return m[1];
  }
  return sessionStorage.getItem(`res-token:${code}`);
});
```

`GET /public/reservations/:code` com o header `X-Reservation-Token` (NUNCA query). Mostrar estado, dia/hora, pessoas, morada — **não a mesa**. Botão «Cancelar reserva» com confirmação, escondido quando o estado não permite; mostrar sempre «Se não conseguires vir, liga-nos: \<restaurantPhone\>». `useStore(slug)` + `<StoreTheme>` em todos os ramos (prever o FOUC — o primeiro paint é laranja Menooo).

- [ ] **Step 3: Comentário-travão sobre scripts de terceiros**

Hoje o storefront não carrega **nenhum** script de terceiros (zero gtag/GTM/fbq, zero `dangerouslySetInnerHTML`) — esta página está a salvo **por acidente**. Deixar no topo do ficheiro:

```tsx
// ⚠️ Esta rota traz um bearer token no fragmento do URL. NENHUM script de terceiros (GA, Meta
// pixel, GTM) pode entrar no layout do storefront sem strip prévio do fragmento: um pixel
// amostra location.href COM o fragmento no primeiro paint, antes de o replaceState correr.
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(storefront): página de gestão da reserva (R3-T9)"
```

---

### Task 10: Montra, sitemap e `embed.js`

**Files:**
- Modify: `apps/storefront/src/app/[slug]/StoreClient.tsx`, `src/app/sitemap.ts`, `public/embed.js`, `Dockerfile`, `docker-compose.prod.yml`

- [ ] **Step 1: CTA na linha de InfoChips — NÃO na nav**

A nav de categorias só renderiza com `menu.data.length > 1` (StoreClient.tsx:130): numa loja com 0 ou 1 categoria — justamente quem mais quer reservas — o botão **desaparecia**; e dentro do `overflow-x-auto` sairia do ecrã em lojas com muitas categorias. O sítio certo é o bloco do hero, logo a seguir ao `<div>` dos InfoChips (~linha 125), que renderiza sempre:

```tsx
          {s.reservationsEnabled && (
            <div className="animate-fade-up mt-4" style={{ animationDelay: '0.15s' }}>
              <Link
                href={`/${s.slug}/reservar`}
                className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-lift"
              >
                <CalendarDays size={15} /> Reservar mesa
              </Link>
            </div>
          )}
```

- [ ] **Step 2: sitemap**

Emitir `${SITE_URL}/${slug}/reservar` para as lojas com `reservationsEnabled` (Task 1 já expõe o flag no `listPublicStores`).

- [ ] **Step 3: `embed.js` com `data-reservas`**

`data-reservas="1"` → abre `/<slug>/reservar`, rótulo por omissão «Reservar Mesa». Sem o atributo → **comportamento atual, sem alterações**.

O caso óbvio é o dono colar **dois** scripts (encomendas + reservas) e o `embed.js` atual parte-se: `window.MenoooWidget.open` é sobrescrito (linha 146), os dois listeners globais de `[data-menooo-order]` abrem **dois overlays empilhados** (151), os dois botões flutuantes ficam **um por cima do outro** (`bottom:'20px'`, 47), os dois handlers de Escape disparam (139) e `iframe.title='Encomendar'` está hardcoded (95).

Implementar o contrato de duas instâncias:
- `window.MenoooWidget.order` / `.reservas` (namespace por modo), mantendo `.open`/`.close` como **alias do primeiro** carregado (retrocompatibilidade).
- Gatilho próprio `data-menooo-reservar` / `a[href="#menooo-reservar"]`, com cada listener a filtrar **só o seu**.
- Empilhar: `bottom: 20 + n*68 px` via contador em `window.MenoooWidget.__n`.
- `iframe.title` derivado do modo («Reservar mesa» / «Encomendar»).

- [ ] **Step 4: Sitekey é BUILD-TIME**

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` é inlinada no bundle **no build**; `TURNSTILE_SECRET_KEY` é runtime. «Pus as chaves no `.env` e reiniciei» = API a exigir token + storefront sem widget = **403 em 100% das reservas**.

No `Dockerfile` (junto de `NEXT_PUBLIC_API_URL`, ~38-43): `ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY`. No `docker-compose.prod.yml`, acrescentar aos `args` do storefront (~29-32) e o `TURNSTILE_SECRET_KEY`/`TURNSTILE_HOSTNAMES` ao `environment` da api.

- [ ] **Step 5: Verificar que o widget de encomendas NÃO regrediu** e **Commit**

```bash
git add -A && git commit -m "feat(storefront): CTA na montra, sitemap e embed.js data-reservas (R3-T10)"
```

---

### Task 11: Painel — bloco de prontidão, interruptor e partilha

**Files:**
- Create: `apps/dashboard/src/app/reservations/components/ReadinessCard.tsx`
- Modify: `apps/dashboard/src/app/reservations/page.tsx`, `components/ReservationSettings.tsx`

- [ ] **Step 1: `ReadinessCard`**

Checklist: (1) ≥1 mesa ativa e `bookableOnline`, (2) janelas ou horário no weekday, (3) email de alertas, (4) link copiado. **Bloquear o toggle enquanto (1) falhar** («Cria pelo menos 1 mesa reservável antes de ligar») — o servidor já recusa (Task 7), mas o dono não pode descobrir por um erro.

**Horas efetivas com proveniência:** `OpeningHour` tem `@@unique([tenantId, weekday])` = UMA faixa/dia, logo quem fecha das 15h às 19h declara 12:00–23:00 contínuo e o fallback (`closeMinute − 60`) gera slots das 12:00 às 22:00 — **incluindo 17:00 com a cozinha fechada**. Mostrar «Sáb 12:00–22:00 — vem do teu horário de abertura, não de janelas» + CTA «Definir janelas de almoço/jantar».

**Estado do Turnstile a vermelho** quando a API reporta `turnstile.enforced === false` em produção (é aqui que o dono decide abrir ao público).

- [ ] **Step 2: Interruptor no topo — fonte única**

O `ReservationSettings` copia a config para estado local (`form`) e o `save` só envia o que mudou: um toggle otimista noutra `queryKey` deixaria o `form` obsoleto e o próximo «Guardar» **voltaria a desligar as reservas em silêncio**. Usar a **mesma mutação e a mesma `queryKey`**, com invalidação. Nas Definições deixar só um link «gerido no topo da aba Reservas».

- [ ] **Step 3: Campo «Email de alertas»**

O alerta existe (`restaurantNotifyEmail = tenant.email ?? OWNER`) e o `UpdateTenantDto` já aceita `email`, mas o painel não tem campo — no dia 1 os alertas vão para a caixa de quem criou a conta. A R3 é o momento em que passam a existir reservas reais a alertar: se o dono não tem o painel aberto, **o email é o único canal**. `<input type="email">` + «Enviar email de teste».

> **Armadilha:** enviar `undefined` num PATCH faz o `JSON.stringify` deitar a chave fora e o backend mantém o valor antigo — a UI diz «sucesso» e nada mudou. Já apareceu 3× neste projeto.

- [ ] **Step 4: Cartão «Partilha as tuas reservas»**

Link direto (copiar), snippet do botão (copiar), nota «cola no site antes de `</body>`» — padrão do `WebsiteWidget` que já existe para encomendas.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(painel): bloco de prontidão, interruptor no topo e partilha (R3-T11)"
```

---

### Task 12: E2e e verificação integrada

**Files:**
- Modify: `apps/api/scripts/e2e-reservas.mjs`

- [ ] **Step 1: Casos novos**

1. **Tracker do throttle (regressão do commit `2053fc8`):** N POSTs do mesmo socket com `X-Forwarded-For` **diferentes** partilham o balde e o 6.º dá 429. Se não houver 429, o `req.ip` voltou a seguir o header e todos os limites caíram.
2. **`reservation-days` ≡ `reservation-slots`:** para 30 dias, `hasSlots === (slots.length > 0)` em todos.
3. **Ligar reservas sem mesas → 400.**
4. **Cap normalizado:** `Ana@x.pt` e `ana@x.pt ` contam como **um** contacto; `+351 912 345 678` e `912345678` idem; a 4.ª → 409 com `code: 'CONTACT_CAP'` e `contactPhone`.
5. **Alternativas do 409 ordenadas por proximidade** da hora pedida.
6. **TTL do token:** reserva com `startsAt` a mais de 24 h no passado → `GET`/`cancel` dão 404.
7. **Cancelar entre `startsAt` e `endsAt`** → 200 (antes era 400).
8. **Turnstile no-op** com secret vazia (dev).

- [ ] **Step 2: Correr tudo, com o ambiente limpo primeiro**

```bash
pkill -9 -f "dist/main"; pnpm --filter @comanda/api build && (node --enable-source-maps apps/api/dist/main &)
# limpar a demo e esperar o balde do throttle (5/min) antes de começar
pnpm --filter @comanda/api test && node apps/api/scripts/e2e-reservas.mjs && node apps/api/scripts/e2e-kitchen.mjs
```
Esperado: unit ✅ · reservas **todos** ✅ · kitchen 42/42.

- [ ] **Step 3: Verificação no browser (obrigatória — não delegável a "parece bem")**

Stack local. Ligar as reservas na demo e percorrer: pessoas → dia → hora → dados → confirmação; 409 mostra alternativas ordenadas; a página de gestão cancela e o slot **volta**; com as reservas desligadas a montra não mostra o CTA e `/reservar` dá o estado suave (não 404 de «loja não encontrada»); **o popup do widget de encomendas continua a abrir** (regressão do `embed.js`).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(reservas): e2e da R3 (tracker do throttle, days≡slots, cap, TTL) (R3-T12)"
```

---

## Notas de rollout (para o dono, não para o executor)

1. **`2053fc8` (trust proxy) vai a produção sozinho e primeiro** — corrige uma falha viva, independente da R3.
2. Ordem das chaves do Turnstile: **storefront com a sitekey primeiro (rebuild da imagem, não restart)**, secret na API só depois. Ao contrário = 403 em 100% das reservas.
3. **DNS da Cloudflare em «DNS only»** (nuvem cinzenta). A nuvem laranja acrescenta um salto ao XFF → `req.ip` passa a ser a edge da CF para toda a gente → 429 aleatórios em clientes reais. O Turnstile não precisa dela.
4. `reservationsEnabled` é `false` por omissão: o deploy da R3 **não muda nada** para ninguém até um dono ligar o interruptor.
5. `pg_dump` antes do deploy (a Task 4 traz migração).

## Fora deste plano

**R4 (aprovado):** mapa de sala arrastável · serviços com nome · timeline de lotação · capacidade mín-máx · tolerância de atraso configurável.
**Decisões do utilizador em aberto:** email opcional no canal ONLINE (mantido obrigatório = status quo da R1).
**Trabalho à parte:** horário repartido (schema — pedido do Roma) · `.ics` como anexo do email de confirmação.
