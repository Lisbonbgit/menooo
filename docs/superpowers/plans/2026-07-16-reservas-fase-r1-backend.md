# Reservas de Mesas — Fase R1: Backend — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend completo das reservas de mesas (spec `docs/superpowers/specs/2026-07-16-reservas-mesas-design.md`): schema, utils puros testados (jest novo na API), módulo `reservations` (público + painel), advisory lock anti-corrida, emails, sala de socket por papel, e2e. Deploy "às escuras" possível.

**Architecture:** Módulo NestJS novo `reservations` (importa OrdersModule p/ gateway; Prisma/Mail são globais). Disponibilidade = utils puros (`assignTables`, slots, `localDateTimeToUtc`) + pipeline no service; criação serializada por tenant com `pg_advisory_xact_lock`. Sem estado "pendente": criar = confirmar.

**Tech Stack:** NestJS 10, Prisma 6/Postgres, jest+ts-jest (a configurar), Intl (sem libs de datas).

## Global Constraints

- Copy/erros em PT-PT; erros públicos NEUTROS: `'Reserva não encontrada.'` (view/cancel), `'Esse horário acabou de ficar ocupado.'` (409 criação).
- Migração APENAS aditiva; `pg_dump` antes de aplicar em produção.
- Todos os writes do painel com `where: { id, tenantId }` composto; `tableIds` do cliente validados como do tenant (anti-IDOR).
- Cancel token: sha256 + `timingSafeEqual` (NUNCA argon2 aqui); token NUNCA aceite em query string.
- Emails/socket SÓ após commit da transação. Campos do cliente HTML-escaped + sem `\r\n`.
- KITCHEN: 403 em todos os endpoints e SEM eventos `reservation.*` no socket.
- Node/pnpm: `PATH="$HOME/.local/node/bin:$PATH"`. Working dir: `/Users/matheus.moraes/dev/comanda`. Ramo: `matheus-reservas-mesas`.
- Stack local para e2e: `node scripts/embedded-db.mjs serve` (apps/api) + `pnpm dev` (apps/api).

---

### Task 1: Schema — 5 modelos novos + campos do Tenant

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Produces: `ReservationStatus`, `Table`, `Reservation`, `ReservationTable`, `ReservationWindow`, `ReservationBlock` e campos `reservation*` no Tenant — EXATAMENTE como no spec §3 (copiar os blocos Prisma de lá, verbatim).

- [ ] **Step 1:** Colar os blocos do spec §3 no schema: o enum junto dos outros enums; os 5 models no fim; os 6 campos `reservation*` do Tenant a seguir ao bloco `kitchenPair*`.
- [ ] **Step 2:** Back-relations no `Tenant` (junto de `modifierGroups ModifierGroup[]`):

```prisma
  tables             Table[]
  reservations       Reservation[]
  reservationWindows ReservationWindow[]
  reservationBlocks  ReservationBlock[]
```

- [ ] **Step 3:** Migrar (DB embebida viva): `npx prisma migrate dev --name reservations` em apps/api. Expected: sync. Verificar `migration.sql` só tem CREATE TYPE/TABLE/INDEX + ALTER TABLE ADD COLUMN.
- [ ] **Step 4:** Typecheck api + commit `feat(api): schema de reservas de mesas (migração aditiva)`.

---

### Task 2: Jest na API + `time.util.ts` (DST) com testes

**Files:**
- Modify: `apps/api/package.json` (bloco jest)
- Create: `apps/api/src/modules/reservations/time.util.ts`
- Test: `apps/api/src/modules/reservations/time.util.spec.ts`

**Interfaces:**
- Produces: `localDateTimeToUtc(dateISO: string, minutes: number, tz: string): Date`; `localDateISO(d: Date, tz: string): string`; `weekdayOf(dateISO: string): number` (0=domingo, convenção OpeningHour); `minutesOfDayInTz(d: Date, tz: string): number`. Runner: `pnpm --filter @comanda/api test`.

- [ ] **Step 1:** Bloco jest no package.json da api (jest+ts-jest já são devDeps):

```json
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "roots": ["<rootDir>/src"]
  }
```

- [ ] **Step 2 (RED):** Criar `time.util.spec.ts` ANTES do util:

```ts
import { localDateTimeToUtc, localDateISO, weekdayOf, minutesOfDayInTz } from './time.util';

describe('localDateTimeToUtc (Europe/Lisbon)', () => {
  const TZ = 'Europe/Lisbon';
  it('verão (WEST, UTC+1): 20:00 locais = 19:00Z', () => {
    expect(localDateTimeToUtc('2026-07-20', 20 * 60, TZ).toISOString()).toBe(
      '2026-07-20T19:00:00.000Z',
    );
  });
  it('inverno (WET, UTC+0): 20:00 locais = 20:00Z', () => {
    expect(localDateTimeToUtc('2026-01-20', 20 * 60, TZ).toISOString()).toBe(
      '2026-01-20T20:00:00.000Z',
    );
  });
  it('hora AMBÍGUA (fim do verão 2026-10-25 01:30 ocorre 2x): primeira ocorrência (WEST)', () => {
    expect(localDateTimeToUtc('2026-10-25', 90, TZ).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });
  it('hora INEXISTENTE (início do verão 2026-03-29 01:30): resolve para o offset seguinte', () => {
    expect(localDateTimeToUtc('2026-03-29', 90, TZ).toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
  });
  it('meia-noite exata', () => {
    expect(localDateTimeToUtc('2026-07-20', 0, TZ).toISOString()).toBe(
      '2026-07-19T23:00:00.000Z',
    );
  });
});

describe('helpers', () => {
  it('localDateISO devolve o dia local do instante', () => {
    expect(localDateISO(new Date('2026-07-19T23:30:00Z'), 'Europe/Lisbon')).toBe('2026-07-20');
  });
  it('weekdayOf: 2026-07-20 é segunda (1)', () => {
    expect(weekdayOf('2026-07-20')).toBe(1);
  });
  it('minutesOfDayInTz: 19:00Z de verão são 20:00 locais', () => {
    expect(minutesOfDayInTz(new Date('2026-07-20T19:00:00Z'), 'Europe/Lisbon')).toBe(20 * 60);
  });
});
```

Run: `pnpm --filter @comanda/api test` → FAIL (módulo não existe).

- [ ] **Step 3 (GREEN):** Criar `time.util.ts`:

```ts
// Conversões hora-local ↔ UTC por timezone, só com Intl (sem libs de datas).
// NOTA: é a operação INVERSA da de open-now.util.ts (que converte instante→partes
// locais); a inversa exige sondagem de offset em duas passagens (DST).

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function partsInTz(date: Date, tz: string): Parts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const h = get('hour');
  return { y: get('year'), mo: get('month'), d: get('day'), h: h === 24 ? 0 : h, mi: get('minute'), s: get('second') };
}

/** Offset (ms) da timezone nesse instante: local − UTC. */
function offsetAt(date: Date, tz: string): number {
  const p = partsInTz(date, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - date.getTime();
}

/**
 * Hora de parede local (dateISO YYYY-MM-DD + minutos do dia) → instante UTC.
 * Hora ambígua (fim do verão): PRIMEIRA ocorrência (offset anterior — sonda-se o
 * offset 6h antes). Hora inexistente (início do verão): offset seguinte.
 */
export function localDateTimeToUtc(dateISO: string, minutes: number, tz: string): Date {
  const [y, mo, d] = dateISO.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, 0, minutes);
  // sonda o offset ANTES da hora (garante 1.ª ocorrência em horas ambíguas)
  const probe = offsetAt(new Date(wallAsUtc - 6 * 3_600_000), tz);
  const candidate = wallAsUtc - probe;
  const check = offsetAt(new Date(candidate), tz);
  if (check === probe) return new Date(candidate);
  // transição entre a sonda e a hora (inexistente/ambígua tardia): offset do destino
  return new Date(wallAsUtc - check);
}

/** Dia local (YYYY-MM-DD) de um instante nessa timezone. */
export function localDateISO(date: Date, tz: string): string {
  const p = partsInTz(date, tz);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Weekday (0=domingo…6=sábado — convenção do OpeningHour) de um dia de calendário. */
export function weekdayOf(dateISO: string): number {
  return new Date(`${dateISO}T12:00:00Z`).getUTCDay();
}

/** Minutos do dia LOCAL de um instante nessa timezone. */
export function minutesOfDayInTz(date: Date, tz: string): number {
  const p = partsInTz(date, tz);
  return p.h * 60 + p.mi;
}
```

Run tests → PASS (8/8). Se a asserção da hora ambígua falhar por 1h, o bug está na sonda — corrigir o util, não o teste.

- [ ] **Step 4:** Commit `feat(api): jest + util de timezone das reservas (DST testado)`.

---

### Task 3: Utils puros — `assign.util.ts` + `slots.util.ts` com testes

**Files:**
- Create: `apps/api/src/modules/reservations/assign.util.ts` + `assign.util.spec.ts`
- Create: `apps/api/src/modules/reservations/slots.util.ts` + `slots.util.spec.ts`

**Interfaces:**
- Produces:
  - `assignTables(tables: AssignableTable[], occupied: Set<string>, partySize: number, channel: 'ONLINE' | 'MANUAL'): string[] | null` com `AssignableTable = { id, seats, area, joinable, bookableOnline, sortOrder }` (todas já `active`).
  - `slotMinutes(windows: { openMinute: number; closeMinute: number }[]): number[]` — janelas JÁ ajustadas pelo caller (ReservationWindow: fim = closeMinute; fallback OpeningHour: fim = closeMinute − 60), slots de 30 em 30 (arredonda o início para cima ao múltiplo de 30), dedup + ordenado.

- [ ] **Step 1 (RED):** testes primeiro:

```ts
// assign.util.spec.ts
import { assignTables } from './assign.util';
const T = (id: string, seats: number, o: Partial<{ area: string | null; joinable: boolean; bookableOnline: boolean; sortOrder: number }> = {}) => ({
  id, seats, area: o.area ?? 'Sala', joinable: o.joinable ?? false, bookableOnline: o.bookableOnline ?? true, sortOrder: o.sortOrder ?? 0,
});

describe('assignTables', () => {
  it('best-fit: escolhe a menor mesa que serve', () => {
    expect(assignTables([T('m8', 8), T('m4', 4), T('m2', 2)], new Set(), 4, 'ONLINE')).toEqual(['m4']);
  });
  it('empate de lugares → menor sortOrder', () => {
    expect(assignTables([T('b', 4, { sortOrder: 2 }), T('a', 4, { sortOrder: 1 })], new Set(), 4, 'ONLINE')).toEqual(['a']);
  });
  it('ocupadas ficam de fora', () => {
    expect(assignTables([T('m4', 4)], new Set(['m4']), 2, 'ONLINE')).toBeNull();
  });
  it('DOCUMENTADO (single-primeiro): grupo de 4 leva a mesa de 8 mesmo havendo par 2+2', () => {
    const ts = [T('m8', 8), T('a2', 2, { joinable: true }), T('b2', 2, { joinable: true })];
    expect(assignTables(ts, new Set(), 4, 'ONLINE')).toEqual(['m8']);
  });
  it('par juntável quando nenhuma única serve; desperdício mínimo', () => {
    const ts = [T('a4', 4, { joinable: true }), T('b4', 4, { joinable: true }), T('c6', 6, { joinable: true })];
    expect(assignTables(ts, new Set(), 8, 'ONLINE')!.sort()).toEqual(['a4', 'b4']);
  });
  it('não junta áreas diferentes nem area null', () => {
    const ts = [T('a', 4, { joinable: true, area: 'Sala' }), T('b', 4, { joinable: true, area: 'Esplanada' }), T('c', 4, { joinable: true, area: null })];
    expect(assignTables(ts, new Set(), 8, 'ONLINE')).toBeNull();
  });
  it('ONLINE ignora bookableOnline=false; MANUAL vê-a', () => {
    const ts = [T('vip', 6, { bookableOnline: false })];
    expect(assignTables(ts, new Set(), 4, 'ONLINE')).toBeNull();
    expect(assignTables(ts, new Set(), 4, 'MANUAL')).toEqual(['vip']);
  });
  it('grupo maior que tudo → null', () => {
    expect(assignTables([T('m4', 4, { joinable: true }), T('m6', 6, { joinable: true })], new Set(), 20, 'ONLINE')).toBeNull();
  });
});
```

```ts
// slots.util.spec.ts
import { slotMinutes } from './slots.util';

describe('slotMinutes', () => {
  it('janela única: de open a close inclusive, passo 30', () => {
    expect(slotMinutes([{ openMinute: 12 * 60, closeMinute: 13 * 60 }])).toEqual([720, 750, 780]);
  });
  it('início não-múltiplo de 30 arredonda para cima', () => {
    expect(slotMinutes([{ openMinute: 12 * 60 + 15, closeMinute: 13 * 60 }])).toEqual([750, 780]);
  });
  it('duas janelas (almoço+jantar) ordenadas e sem duplicados', () => {
    expect(
      slotMinutes([
        { openMinute: 19 * 60, closeMinute: 19 * 60 + 30 },
        { openMinute: 12 * 60, closeMinute: 12 * 60 + 30 },
      ]),
    ).toEqual([720, 750, 1140, 1170]);
  });
  it('janela invertida ou vazia → sem slots', () => {
    expect(slotMinutes([{ openMinute: 800, closeMinute: 700 }])).toEqual([]);
  });
});
```

Run → FAIL. **Step 2 (GREEN):** implementar:

```ts
// assign.util.ts
// Atribuição de mesas (função pura — testada em assign.util.spec.ts).
// DECISÃO DE DESIGN (spec §4.2): mesa única SEMPRE antes de par — juntar mesas
// tem custo operacional; o desperdício ocasional é comportamento esperado.
export interface AssignableTable {
  id: string;
  seats: number;
  area: string | null;
  joinable: boolean;
  bookableOnline: boolean;
  sortOrder: number;
}

export function assignTables(
  tables: AssignableTable[],
  occupied: Set<string>,
  partySize: number,
  channel: 'ONLINE' | 'MANUAL',
): string[] | null {
  const free = tables.filter(
    (t) => !occupied.has(t.id) && (channel === 'MANUAL' || t.bookableOnline),
  );

  const single = free
    .filter((t) => t.seats >= partySize)
    .sort((a, b) => a.seats - b.seats || a.sortOrder - b.sortOrder)[0];
  if (single) return [single.id];

  const joinables = free.filter((t) => t.joinable && t.area !== null);
  let best: { ids: [string, string]; waste: number; sum: number } | null = null;
  for (let i = 0; i < joinables.length; i++) {
    for (let j = i + 1; j < joinables.length; j++) {
      const a = joinables[i];
      const b = joinables[j];
      if (a.area !== b.area) continue;
      const sum = a.seats + b.seats;
      if (sum < partySize) continue;
      const waste = sum - partySize;
      if (!best || waste < best.waste || (waste === best.waste && sum < best.sum)) {
        best = { ids: [a.id, b.id], waste, sum };
      }
    }
  }
  return best ? best.ids : null;
}
```

```ts
// slots.util.ts
/** Minutos de início de slot (passo 30) para janelas de SEATING já ajustadas. */
export function slotMinutes(windows: { openMinute: number; closeMinute: number }[]): number[] {
  const out = new Set<number>();
  for (const w of windows) {
    const first = Math.ceil(w.openMinute / 30) * 30;
    for (let m = first; m <= w.closeMinute; m += 30) out.add(m);
  }
  return [...out].sort((a, b) => a - b);
}
```

Run → PASS (12/12 nos dois ficheiros + 8 da Task 2 = 20). **Step 3:** Commit `feat(api): utils de atribuição de mesas e slots (testados)`.

---

### Task 4: Gateway (sala staff) + templates de email

**Files:**
- Modify: `apps/api/src/modules/orders/orders.gateway.ts`
- Modify: `apps/api/src/modules/mail/mail.service.ts`

**Interfaces:**
- Produces: sala `tenant:<id>:staff` (todos os papéis exceto KITCHEN); `emitReservationCreated(tenantId, r)` / `emitReservationUpdated(tenantId, r)` emitem `reservation.created`/`reservation.updated` SÓ para a sala staff. Mail: `esc(s)` privado + `sendReservationConfirmed(to, name, info)`, `sendReservationCancelled(to, name, info, byRestaurant)`, `sendNewReservationAlert(to, info)`, `sendReservationCancelledAlert(to, info)` com `info = { restaurantName, code, dateText, timeText, partySize, tableNames, manageUrl? }`.

- [ ] **Step 1:** Gateway — no `handleConnection`, depois do `client.join(room(payload.tenantId))`:

```ts
      // reservas transportam PII do cliente — só front-of-house (nunca a cozinha)
      if (payload.role !== 'KITCHEN') client.join(`${room(payload.tenantId)}:staff`);
```

e os emitters no fim da classe:

```ts
  emitReservationCreated(tenantId: string, reservation: unknown) {
    this.server.to(`${room(tenantId)}:staff`).emit('reservation.created', reservation);
  }

  emitReservationUpdated(tenantId: string, reservation: unknown) {
    this.server.to(`${room(tenantId)}:staff`).emit('reservation.updated', reservation);
  }
```

- [ ] **Step 2:** Mail — helper de escape (campos do cliente vão para HTML e subjects):

```ts
  /** Escapa input do cliente para HTML e remove quebras (anti-injeção em templates/headers). */
  private esc(s: string): string {
    return s
      .replace(/[\r\n]+/g, ' ')
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  }
```

e os 4 templates no estilo dos existentes (`this.h` + `this.p` + `this.cta`), TODOS os campos do cliente passados por `this.esc(...)`; subjects SEM campos do cliente (usar nome do restaurante/código). Conteúdo mínimo: confirmado (cliente) = restaurante, data/hora, pessoas, mesa(s), código + CTA "Gerir reserva" (`manageUrl`); cancelado (cliente) = idem sem CTA + quem cancelou; alertas (restaurante) = nome do cliente (esc), telefone, pax, data/hora, mesa(s), notas (esc).

- [ ] **Step 3:** Typecheck + commit `feat(api): sala de socket staff e emails de reservas (input escapado)`.

---

### Task 5: Módulo reservations — núcleo público (slots, criar, ver/cancelar)

**Files:**
- Create: `apps/api/src/modules/reservations/reservations.module.ts`
- Create: `apps/api/src/modules/reservations/reservations.service.ts`
- Create: `apps/api/src/modules/reservations/public-reservations.controller.ts`
- Create: `apps/api/src/modules/reservations/dto/public-reservation.dto.ts`
- Modify: `apps/api/src/app.module.ts` (registar módulo)

**Interfaces:**
- Produces (públicos, todos `@Public()`):
  - `GET /public/stores/:slug/reservation-slots?date&party` → `{ slots: string[] }` (`"HH:MM"` local)
  - `POST /public/stores/:slug/reservations` (`@Throttle 5/min`) → `{ code, startsAt, endsAt, partySize, tableNames, manageUrl }`
  - `GET /public/reservations/:code` (token via header `X-Reservation-Token`, `@Throttle 10/min`)
  - `POST /public/reservations/:code/cancel { token }` (`@Throttle 10/min`)
- Service interno reutilizado pela Task 6: `slotsForDayTx(tx, tenant, dateISO, party, channel)` (a variante fora de transação delega nela com `this.prisma`), `assignForWindowTx(tx, tenant, start, end, party, channel)` — nomes exatos, consumidos por `createPublic`/`createManual`/`updateReservation`.

- [ ] **Step 1: DTOs** (`public-reservation.dto.ts`):

```ts
import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreatePublicReservationDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @Matches(/^\d{2}:\d{2}$/) time!: string;
  @IsInt() @Min(1) @Max(50) partySize!: number;
  @IsString() @IsNotEmpty() @MaxLength(120) customerName!: string;
  @IsString() @IsNotEmpty() @MaxLength(30) customerPhone!: string;
  @IsEmail() @MaxLength(200) customerEmail!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() marketingConsent?: boolean;
}

export class CancelReservationDto {
  @IsString() @IsNotEmpty() @MaxLength(128) token!: string;
}
```

- [ ] **Step 2: Service — núcleo.** Estrutura (código completo; imports: utils das Tasks 2-3, `randomBytes`/`createHash`/`timingSafeEqual` de `crypto`, `randomInt` p/ código, Prisma, MailService, OrdersGateway, `isSubscriptionUsable` de `../tenants/subscription.util`):

```ts
const SLOT_STEP_MIN = 30;
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function genCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}
function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
```

Métodos-chave (assinaturas e lógica obrigatórias):

```ts
  /** Loja gated para reservas (404 neutro, padrão das encomendas). */
  private async gatedTenant(slug: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { account: true, openingHours: true, reservationWindows: true },
    });
    if (!t || t.status !== 'ACTIVE' || !isSubscriptionUsable(t.account) || !t.reservationsEnabled) {
      throw new NotFoundException('Loja não encontrada.');
    }
    return t;
  }

  /** Janelas de SEATING de um weekday: ReservationWindow ou fallback OpeningHour−60. */
  private windowsFor(tenant: TenantWithHours, weekday: number) {
    const own = tenant.reservationWindows.filter((w) => w.weekday === weekday);
    if (own.length > 0) return own.map((w) => ({ openMinute: w.openMinute, closeMinute: w.closeMinute }));
    const oh = tenant.openingHours.find((h) => h.weekday === weekday);
    return oh ? [{ openMinute: oh.openMinute, closeMinute: oh.closeMinute - 60 }] : [];
  }

  /** Slots disponíveis de um dia (uma query de reservas; ocupação por slot em memória). */
  async publicSlots(slug: string, dateISO: string, party: number) { /* gatedTenant → slotsForDay */ }

  private async slotsForDay(tenant, dateISO, party, channel: 'ONLINE' | 'MANUAL') {
    if (party > tenant.reservationMaxPartySize && channel === 'ONLINE')
      return { slots: [], reason: 'party', contactPhone: tenant.phone };
    const tz = tenant.timezone || 'Europe/Lisbon';
    // dia bloqueado
    const blocked = await this.prisma.reservationBlock.findUnique({
      where: { tenantId_date: { tenantId: tenant.id, date: dateISO } },
    });
    if (blocked) return { slots: [] };
    // antecedência máxima (dias de calendário na tz do tenant)
    const todayISO = localDateISO(new Date(), tz);
    const diffDays = Math.round((Date.parse(dateISO) - Date.parse(todayISO)) / 86_400_000);
    if (diffDays < 0 || diffDays > tenant.reservationMaxAdvanceDays) return { slots: [] };

    const minutes = slotMinutes(this.windowsFor(tenant, weekdayOf(dateISO)));
    if (minutes.length === 0) return { slots: [] };

    const durMs = tenant.reservationDurationMin * 60_000;
    const bufMs = tenant.reservationBufferMin * 60_000;
    const notBefore = Date.now() + tenant.reservationMinNoticeMin * 60_000;

    // todas as reservas confirmadas que podem intersetar o dia (uma query)
    const dayStart = localDateTimeToUtc(dateISO, 0, tz);
    const dayEnd = new Date(dayStart.getTime() + 36 * 3_600_000);
    const busy = await this.prisma.reservation.findMany({
      where: {
        tenantId: tenant.id,
        status: 'CONFIRMED',
        startsAt: { lt: new Date(dayEnd.getTime() + bufMs) },
        endsAt: { gt: new Date(dayStart.getTime() - bufMs) },
      },
      include: { tables: true },
    });
    const tables = await this.prisma.table.findMany({ where: { tenantId: tenant.id, active: true } });

    const seen = new Set<number>(); // dedup por instante UTC (DST)
    const slots: { label: string; start: Date }[] = [];
    for (const m of minutes) {
      const start = localDateTimeToUtc(dateISO, m, tz);
      if (seen.has(start.getTime())) continue;
      seen.add(start.getTime());
      if (start.getTime() < notBefore) continue;
      const end = new Date(start.getTime() + durMs);
      const occupied = new Set<string>();
      for (const r of busy) {
        if (r.startsAt.getTime() < end.getTime() + bufMs && r.endsAt.getTime() + bufMs > start.getTime()) {
          for (const rt of r.tables) occupied.add(rt.tableId);
        }
      }
      if (assignTables(tables, occupied, party, channel)) {
        slots.push({ label: `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, start });
      }
    }
    return { slots: slots.map((s) => s.label) };
  }
```

Criação pública (advisory lock; emails/socket pós-commit):

```ts
  async createPublic(slug: string, dto: CreatePublicReservationDto) {
    const tenant = await this.gatedTenant(slug);
    const tz = tenant.timezone || 'Europe/Lisbon';
    const minutes = this.timeToMinutes(dto.time); // "HH:MM" → int; 422 se NaN

    // cap anti-spam: máx. 2 reservas futuras confirmadas por contacto
    const activeByContact = await this.prisma.reservation.count({
      where: {
        tenantId: tenant.id,
        status: 'CONFIRMED',
        startsAt: { gt: new Date() },
        OR: [{ customerEmail: dto.customerEmail }, { customerPhone: dto.customerPhone }],
      },
    });
    if (activeByContact >= 2) {
      throw new HttpException('Já tens reservas ativas neste restaurante. Contacta-o diretamente.', 429);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenant.id}))`;
      // revalida o pipeline COMPLETO dentro do lock
      const { slots } = await this.slotsForDayTx(tx, tenant, dto.date, dto.partySize, 'ONLINE');
      if (!slots.includes(dto.time)) {
        throw new ConflictException({
          message: 'Esse horário acabou de ficar ocupado.',
          alternatives: slots.slice(0, 4),
        });
      }
      const start = localDateTimeToUtc(dto.date, minutes, tz);
      const end = new Date(start.getTime() + tenant.reservationDurationMin * 60_000);
      const tableIds = await this.assignForWindowTx(tx, tenant, start, end, dto.partySize, 'ONLINE');
      const token = randomBytes(32).toString('hex');
      const row = await this.createRowWithCode(tx, {
        tenantId: tenant.id,
        cancelTokenHash: sha256(token),
        source: 'ONLINE',
        partySize: dto.partySize,
        startsAt: start,
        endsAt: end,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        customerEmail: dto.customerEmail,
        notes: dto.notes ?? null,
        marketingConsent: dto.marketingConsent ?? false,
        tables: { create: tableIds.map((id) => ({ tableId: id })) },
      });
      return { row, token };
    });
    // pós-commit: emails + socket (nunca dentro da transação)
    this.afterCreate(tenant, created.row, created.token);
    return this.publicView(tenant, created.row, created.token);
  }
```

Notas obrigatórias: `slotsForDay` tem variante `Tx` (recebe o client da transação); `createRowWithCode` tenta `genCode()` e em `P2002` no campo `code` re-gera (até 3×); `manageUrl = ${STORE_URL}/​${tenant.slug}/reserva/${code}#t=${token}` (fragmento `#` NUNCA chega a logs de servidor). View/cancel:

```ts
  private verifyToken(row: Reservation, token: string | undefined): boolean {
    if (!row.cancelTokenHash || !token) return false; // MANUAL (hash null) = sempre 404 neutro
    const a = Buffer.from(sha256(token));
    const b = Buffer.from(row.cancelTokenHash);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async publicByCode(code: string, token: string | undefined) {
    const row = await this.prisma.reservation.findUnique({ where: { code }, include: { tables: { include: { table: true } }, tenant: true } });
    if (!row || !this.verifyToken(row, token)) throw new NotFoundException('Reserva não encontrada.');
    return /* código, estado, data/hora local, pax, nomes das mesas, nome do restaurante */;
  }

  async cancelByToken(code: string, token: string) {
    /* mesma verificação neutra; só CONFIRMED e startsAt futuro; status→CANCELLED,
       cancelledBy: 'CUSTOMER'; pós-update: email ao cliente + alerta ao restaurante + socket updated */
  }
```

- [ ] **Step 3: Controller público** — `@Public()` em tudo; token do GET via `@Headers('x-reservation-token')`; `@Throttle({ default: { limit: 5, ttl: 60_000 } })` no POST de criação e `{ limit: 10 }` no view/cancel.

- [ ] **Step 4: Módulo + registo:**

```ts
@Module({
  imports: [OrdersModule],
  controllers: [PublicReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
```

+ import em `app.module.ts`.

- [ ] **Step 5:** Typecheck + smoke com a stack local (criar mesa via SQL/prisma studio é chato — usar o e2e da Task 7 como verificação; aqui: `curl /public/stores/pizzaria-demo/reservation-slots?...` → 404 porque `reservationsEnabled=false` = gating a funcionar). Commit `feat(api): reservas públicas (slots, criação com advisory lock, ver/cancelar por token)`.

---

### Task 6: Painel — mesas, reservas, janelas, bloqueios, config

**Files:**
- Create: `apps/api/src/modules/reservations/reservations.controller.ts`
- Create: `apps/api/src/modules/reservations/dto/panel.dto.ts`
- Modify: `apps/api/src/modules/reservations/reservations.service.ts` (métodos do painel)
- Modify: `apps/api/src/modules/tenants/dto/update-tenant.dto.ts` (config + email)
- Modify: `apps/api/src/modules/reservations/reservations.module.ts` (controller)

**Interfaces:**
- Produces (todos `@ApiBearerAuth @UseGuards(RolesGuard) @Roles(OWNER, STAFF)` por método — NUNCA KITCHEN):
  - `GET/POST /tables`, `PATCH/DELETE /tables/:id`
  - `GET /reservations?date=YYYY-MM-DD` · `POST /reservations` (manual) · `PATCH /reservations/:id` (edição) · `PATCH /reservations/:id/status`
  - `GET /reservation-windows` · `PUT /reservation-windows` (lista completa; máx. 2/weekday)
  - `GET /reservation-blocks` · `POST /reservation-blocks` · `DELETE /reservation-blocks/:id`

- [ ] **Step 1: DTOs** (`panel.dto.ts`) — completos com validadores: `CreateTableDto { name(1..60), seats @IsInt @Min(1) @Max(50), area? (..40), joinable?, bookableOnline?, active?, sortOrder? }`, `UpdateTableDto` (tudo opcional), `CreateManualReservationDto { date, time /^\d{2}:\d{2}$/, partySize @Min(1) @Max(100), durationMin? @IsInt @Min(30) @Max(480), customerName(..120), customerPhone? (..30), customerEmail? @IsEmail, notes? (..500), tableIds? @IsArray @IsString({each:true}) @ArrayMaxSize(2) }`, `UpdateReservationDto` (mesmos opcionais), `UpdateReservationStatusDto { status @IsIn(['COMPLETED','NO_SHOW','CANCELLED']) }`, `SetWindowsDto { windows: { weekday 0..6, openMinute 0..1440, closeMinute 0..1440 }[] }`, `CreateBlockDto { date /^\d{4}-\d{2}-\d{2}$/, reason? (..120) }`.

- [ ] **Step 2: Service (painel).** Regras obrigatórias:
  - Todos os updates/deletes `where: { id, tenantId }`; `tableIds` validados (`table.count({ where: { id: { in }, tenantId } }) === tableIds.length`, senão 400).
  - `DELETE /tables/:id`: pre-check `reservationTable.count({ where: { tableId } })` → 409 `'Esta mesa tem reservas no histórico — desativa-a em vez de apagar.'`; apanhar também P2003 → mesmo 409.
  - **Manual** (`createManual`): advisory lock; ignora grelha/antecedências/máx.pax; hora arredondada a 15 min (`minutes - (minutes % 15)`); `durationMin ?? tenant.reservationDurationMin`; mesas forçadas validam só posse+ativa+não-sobreposição+máx.2 (aviso de capacidade é da UI); sem forçadas → `assignTables(..., 'MANUAL')` → 409 se null; `source:'MANUAL'`, `cancelTokenHash: null`, email/telefone opcionais. Pós-commit: alerta ao restaurante? NÃO (foi ele que criou) — só socket created.
  - **Edição** (`updateReservation`): lock; só CONFIRMED; recalcula start/end (duração explícita ou mantém a atual `endsAt-startsAt`); mesas: forçadas ou re-atribuição EXCLUINDO a própria reserva da ocupação; substitui `tables` (deleteMany + create). Sem email automático. Socket updated.
  - **Status**: transições só de CONFIRMED; `CANCELLED` → `cancelledBy:'RESTAURANT'` + email ao cliente SE tiver email + socket updated. NO_SHOW/COMPLETED → socket updated.
  - **Windows** (`PUT`): valida máx. 2 por weekday, `closeMinute > openMinute`, ambos 0..1440; substitui tudo do tenant (deleteMany + createMany) numa transação.
  - **Blocks**: create com `@@unique([tenantId,date])` → P2002 = 409 'Esse dia já está bloqueado.'
  - `GET /reservations?date`: converte o dia local → [dayStartUtc, +36h] e devolve as que COMEÇAM nesse dia local (`localDateISO(startsAt, tz) === date`), ordenadas, com `tables.table.name`.

- [ ] **Step 2b: `getPublicBySlug` expõe `reservationsEnabled`** — em `tenants.service.ts`, acrescentar `reservationsEnabled: tenant.reservationsEnabled,` à whitelist explícita de campos devolvida (spec §6; o sitemap usa `listPublicStores` e não é afetado).

- [ ] **Step 3: UpdateTenantDto** — acrescentar (com os validadores EXATOS do spec §5):

```ts
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsBoolean() reservationsEnabled?: boolean;
  @IsOptional() @IsInt() @Min(30) @Max(480) reservationDurationMin?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) reservationBufferMin?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2880) reservationMinNoticeMin?: number;
  @IsOptional() @IsInt() @Min(1) @Max(90) reservationMaxAdvanceDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) reservationMaxPartySize?: number;
```

  e os alertas de reservas usam `tenant.email ?? account.users[0]?.email` (padrão do admin).

- [ ] **Step 4:** Typecheck + commit `feat(api): painel de reservas (mesas, manual, edição, janelas, bloqueios, config)`.

---

### Task 7: E2e completo — `apps/api/scripts/e2e-reservas.mjs`

**Files:**
- Create: `apps/api/scripts/e2e-reservas.mjs`

**Interfaces:**
- Consumes: tudo das Tasks 1-6; seed demo (`dono@pizzaria-demo.pt`/`demo1234`, slug `pizzaria-demo`); helpers `req/check` no padrão de `e2e-kitchen.mjs`.
- Produces: `node scripts/e2e-reservas.mjs` → exit 0 com todos os checks verdes.

- [ ] **Step 1:** Escrever o script no padrão do e2e-kitchen (mesmos helpers `req`, `check`, contadores, exit code). Sequência OBRIGATÓRIA (cada linha = 1+ checks):
  1. Login owner; `PATCH /tenants/me` liga `reservationsEnabled:true`, `reservationDurationMin:120`, `reservationMinNoticeMin:0` (para testar slots de hoje), buffer 0.
  2. Slots ANTES de mesas → lista vazia.
  3. Criar mesas: M2(2 lugares, joinable, Sala), M2b(2, joinable, Sala), M4(4, Sala), M8(8, Esplanada), VIP(6, `bookableOnline:false`).
  4. `PUT /reservation-windows`: amanhã tem janela 12:00–14:00 (weekday calculado no script).
  5. Slots amanhã party=2 → contém "12:00" e "14:00" (inclusive — janela de seating) e NÃO "14:30".
  6. Reservar 12:00 party=2 (ONLINE) → 201, `code` + `manageUrl`; mesa atribuída = M2 (best-fit: 2 lugares).
  7. Slots de novo → "12:00" AUSENTE para party=5 mas PRESENTE para party=2? (M2b livre) — checks de ocupação parcial.
  8. Corrida: 2 POSTs simultâneos (Promise.all) para o MESMO slot com party=4 → exatamente um 201 e um 409 (com `alternatives`).
  9. Par juntável: reservar party=4 às 13:00 quando só restam M2+M2b → 201 com 2 mesas da mesma área.
  10. ONLINE nunca usa a VIP: party=6 sem outras mesas livres → 409; MANUAL com as mesmas condições → 201 na VIP.
  11. `time` fora da grelha ("12:17") → 422; fora da janela ("18:00") → 409/422.
  12. Cap por contacto: 3.ª reserva futura com o mesmo email → 429.
  13. GET público por code SEM token → 404; com token errado → 404; com token certo (header) → 200 com dados.
  14. Cancel por token → 200; slot volta a aparecer; cancel repetido → 404/409 neutro.
  15. Reserva MANUAL → GET público com o code dela e qualquer token → 404 (sem token = inacessível).
  16. Edição: PATCH hora 12:00→13:30 → 200 e slots refletem; edição para slot ocupado → 409.
  17. NO_SHOW liberta: marcar NO_SHOW → slot volta.
  18. Bloqueio: POST block amanhã → slots vazios; DELETE block → voltam.
  19. Matriz: token KITCHEN (emparelhar via fluxo kitchen) → 403 em `GET /tables`, `GET /reservations`, `POST /reservations`, `PATCH /reservations/:id/status`, `PUT /reservation-windows`; socket KITCHEN NÃO recebe `reservation.created` (ligar socket.io-client com token kitchen, criar reserva, esperar 2s, assert não recebido; socket OWNER recebe).
  20. Cross-tenant: criar 2.ª conta/tenant via register+verify (código lido do log? — usar o super-admin para ativar não é preciso: basta criar mesa no tenant A e tentar `PATCH /tables/:idA` com token do tenant B → 404, e manual com `tableIds:[idA]` no tenant B → 400).
  21. `DELETE /tables/:id` de mesa com histórico → 409; mesa virgem → 200.
  22. Gating: `reservationsEnabled:false` → slots/POST públicos 404; GET por code/token continua 200.
- [ ] **Step 2:** Correr até verde (`node scripts/e2e-reservas.mjs`); em falha corrige-se a implementação (não o teste, salvo engano provado e documentado).
- [ ] **Step 3:** Regressão: `node scripts/e2e-kitchen.mjs` → 42/42 (o gateway mudou — a sala staff não pode partir a cozinha).
- [ ] **Step 4:** Commit `test(api): e2e de reservas (disponibilidade, corridas, tokens, matriz, gating)`.

---

## Notas de execução

- Task 4 antes das 5/6 (service usa mail+gateway). Tasks 2-3 são pré-requisito do 5.
- Fim da fase: revisão final de ramo inteiro (opus) → merge ao main + push (fluxo do grupo); deploy junto com o resto quando o utilizador mandar.
- R2 (painel) e R3 (loja) têm planos próprios a seguir.
