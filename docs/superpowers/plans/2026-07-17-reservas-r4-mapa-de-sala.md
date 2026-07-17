# Reservas R4 — Mapa de sala, serviços e timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** A aba Reservas ganha uma vista **Mapa** — a sala do dono, à hora do cursor — mais serviços com nome (Almoço/Jantar) e uma timeline de lotação que serve de cursor de tempo.

**Architecture:** Aditivo sobre R1–R3. A `ReservationService` **coexiste** com a `ReservationWindow` (expand/contract: o DROP fica para um ciclo posterior). O `servicesFor()` devolve a mesma forma que o `windowsFor()`, logo o motor de slots e os testes de DST não são tocados. O mapa e a timeline derivam tudo das reservas que a R2 já carrega — zero endpoints de leitura novos.

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL · Next.js (App Router) + react-query + Tailwind · jest + scripts e2e em node puro.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-17-reservas-r4-mapa-de-sala-design.md`. Em dúvida, o spec manda.
- **PT-PT** em toda a copy visível e nos comentários.
- **NUNCA dropar a `ReservationWindow` nesta fase.** O `docker-entrypoint.sh` corre `prisma migrate deploy` com `set -e` a cada arranque e só faz `exec` se passar; a api tem `restart: unless-stopped`; não há um único `down.sql`. Uma migração que rebente derruba a API inteira — **as encomendas incluídas** — em crash-loop permanente.
- **A migração não pode mudar a disponibilidade de ninguém.** É a promessa; o teste do §10 é o que a prova.
- **`@default(cuid())` NÃO cria default na base de dados** — o Prisma gera-o no cliente. Todo o `INSERT` em SQL tem de sintetizar o `id` (padrão do repo: `'pmg_' || g."id"` em `20260712120000_shared_modifier_groups`).
- **Dev tem 0 janelas** (`reservationsEnabled @default(false)`): um teste de migração sem dados **passa sem tocar no problema**. Os testes de migração correm sobre ≥1 janela e ≥2 tenants.
- **O `RolesGuard` falha ABERTO** (`if (!required || required.length === 0) return true`): endpoint sem `@Roles` fica acessível a qualquer autenticado, **incluindo o tablet da cozinha**.
- **Advisory lock:** `tx.$executeRaw` (NUNCA `$queryRaw` — Prisma 6 rebenta com `void`), só dentro de `$transaction`.
- **`undefined` num PATCH:** o `JSON.stringify` deita a chave fora → o backend mantém o antigo e a UI mente «sucesso». Já apareceu 3× neste projeto.
- **Ambiente:** `export PATH="$HOME/.local/node/bin:$PATH"`. Sem Docker local; Postgres em :5433. Demo: `dono@pizzaria-demo.pt` / `demo1234`, slug `pizzaria-demo`.
- **Antes de qualquer e2e:** `pkill -9 -f "dist/main"`, rebuild, **um e2e de cada vez** (dois em paralelo poluem-se e dão falhas falsas), e limpar a demo.
- **NUNCA** contra produção. **NUNCA** deploy. **NUNCA** `git push`.
- **Componentes do painel vivem em `apps/dashboard/src/components/`** (não em `app/reservations/components/`, tirando o `ReadinessCard.tsx`, que ficou lá).

---

## File Structure

**API — criar**
- `apps/api/src/modules/reservations/services.util.ts` + `.spec.ts` — `servicesFor` puro (serviços + fallback)
- `apps/api/prisma/migrations/<ts>_reservation_services/migration.sql`
- `apps/api/scripts/test-migration-services.mjs` — prova que a migração não muda slots

**API — modificar**
- `apps/api/prisma/schema.prisma` — `Table.x/y/shape`, `ReservationService`, `Tenant.reservationGraceMin`
- `reservations.service.ts` — `servicesFor`, CRUD de serviços, `setLayout`, `updateTable` (área limpa posição)
- `reservations.controller.ts` — rotas de serviços + `PUT tables/layout`, com `@Roles`
- `dto/panel.dto.ts` — `ServiceDto`, `SetLayoutDto`

**Dashboard — criar**
- `apps/dashboard/src/lib/occupancy.util.ts` + `.spec.ts` — estado da mesa e ocupação por slot (puro)
- `apps/dashboard/src/components/FloorMap.tsx` — grelha, drag, estados, áreas
- `apps/dashboard/src/components/TimelineCursor.tsx`
- `apps/dashboard/src/components/ServicesCard.tsx` — CRUD de serviços

**Dashboard — modificar**
- `app/reservations/page.tsx` — switcher Lista/Mapa + estado partilhado (dia, hora, área)
- `components/ReservationFormModal.tsx` — prop `initial`
- `components/ReservationSettings.tsx` — janelas → serviços; campo de tolerância
- `app/reservations/components/ReadinessCard.tsx` — proveniência com nome de serviço
- `lib/reservation-types.ts`, `lib/reservations-hooks.ts`

**Storefront/mail — modificar**
- `app/[slug]/reservar/ReservarClient.tsx`, `app/[slug]/reserva/[code]/ReservaClient.tsx`, `apps/api/src/modules/mail/mail.service.ts` — a copy da tolerância

---

### Task 1: Schema + migração expand + a prova de que não muda nada

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_reservation_services/migration.sql`
- Create: `apps/api/scripts/test-migration-services.mjs`

**Interfaces:**
- Produces: `ReservationService { id, tenantId, name, weekdays: number[], openMinute, closeMinute, sortOrder }`
- Produces: `Table.x: number | null`, `Table.y: number | null`, `Table.shape: 'square' | 'round'`
- Produces: `Tenant.reservationGraceMin: number` (default 15)

- [ ] **Step 1: Schema**

```prisma
model ReservationService {
  id          String @id @default(cuid())
  tenantId    String
  tenant      Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name        String
  weekdays    Int[]  // 0=domingo … 6=sábado
  openMinute  Int
  closeMinute Int
  sortOrder   Int    @default(0)
  @@index([tenantId])
}
```

No `Table`: `x Int?`, `y Int?`, `shape String @default("square")`.
No `Tenant`: `reservationGraceMin Int @default(15)` + `reservationServices ReservationService[]`.

**NÃO remover o `ReservationWindow` nem a relação `reservationWindows` do Tenant.**

- [ ] **Step 2: Gerar a migração**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
pnpm --filter @comanda/api exec prisma migrate dev --name reservation_services --create-only
```

`--create-only`: o SQL do backfill é escrito à mão antes de aplicar.

- [ ] **Step 3: O backfill**

Acrescentar ao fim do `migration.sql` gerado. Os três `WITH` são o que faz isto passar em produção:

```sql
-- Backfill: ReservationWindow -> ReservationService.
-- 1) `uniao`: funde janelas SOBREPOSTAS do mesmo weekday. Hoje o setWindows não valida
--    sobreposição (só close>open e o teto de 2/dia), logo `seg 12:00-15:00 + seg 14:00-18:00`
--    é um estado legal e alcançável pela UI — e agrupá-lo cru daria dois serviços sobrepostos,
--    que a validação NOVA recusa com 400, deixando o dono sem poder gravar nada.
--    O slotMinutes acumula num Set, logo a união gera exatamente os mesmos slots.
-- 2) `grupos`: agrupa por (open, close) e junta os weekdays.
-- 3) `id`: sintetizado — o @default(cuid()) do Prisma NÃO cria default na base de dados.
WITH ordenadas AS (
  SELECT "tenantId", "weekday", "openMinute", "closeMinute",
         SUM(novo) OVER (PARTITION BY "tenantId", "weekday" ORDER BY "openMinute", "closeMinute") AS bloco
  FROM (
    SELECT w.*,
           CASE WHEN w."openMinute" <= MAX(w."closeMinute") OVER (
                  PARTITION BY w."tenantId", w."weekday"
                  ORDER BY w."openMinute", w."closeMinute"
                  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
                THEN 0 ELSE 1 END AS novo
    FROM "ReservationWindow" w
  ) s
),
uniao AS (
  SELECT "tenantId", "weekday", MIN("openMinute") AS "openMinute", MAX("closeMinute") AS "closeMinute"
  FROM ordenadas GROUP BY "tenantId", "weekday", bloco
),
grupos AS (
  SELECT "tenantId", "openMinute", "closeMinute",
         array_agg(DISTINCT "weekday" ORDER BY "weekday") AS weekdays
  FROM uniao GROUP BY "tenantId", "openMinute", "closeMinute"
)
INSERT INTO "ReservationService" ("id", "tenantId", "name", "weekdays", "openMinute", "closeMinute", "sortOrder")
SELECT
  'rs_' || md5(g."tenantId" || '_' || g."openMinute" || '_' || g."closeMinute"),
  g."tenantId",
  -- nome com a hora SEMPRE que houver mais do que um grupo do mesmo lado das 17:00:
  -- o teto real é 2 janelas x 7 weekdays = até 14 grupos, e não há @@unique no name.
  CASE WHEN (SELECT count(*) FROM grupos g2
             WHERE g2."tenantId" = g."tenantId"
               AND (g2."openMinute" < 1020) = (g."openMinute" < 1020)) > 1
       THEN (CASE WHEN g."openMinute" < 1020 THEN 'Almoço ' ELSE 'Jantar ' END)
            || lpad((g."openMinute" / 60)::text, 2, '0') || ':' || lpad((g."openMinute" % 60)::text, 2, '0')
       ELSE (CASE WHEN g."openMinute" < 1020 THEN 'Almoço' ELSE 'Jantar' END)
  END,
  g.weekdays,
  g."openMinute",
  g."closeMinute",
  (row_number() OVER (PARTITION BY g."tenantId" ORDER BY g."openMinute"))::int
FROM grupos g
ON CONFLICT ("id") DO NOTHING;
```

O `ON CONFLICT DO NOTHING` + o `id` determinístico tornam o backfill **re-executável**.

- [ ] **Step 4: O teste que interessa — a migração não muda slots**

`apps/api/scripts/test-migration-services.mjs`. Um teste com 0 janelas passa sem tocar no problema; este cria dados a sério.

```js
// Prova a promessa da migração: os serviços geram os MESMOS slots que as janelas geravam.
// Dados de propósito: 2 tenants, 1 com janelas normais, 1 com janelas SOBREPOSTAS no mesmo dia
// (estado legal hoje — o setWindows não valida sobreposição), que é o caso que rebenta o
// agrupamento ingénuo e a validação nova.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
// … criar 2 tenants de teste, janelas:
//   A: seg 720-870, ter 720-870, seg 1140-1320   -> Almoço 12:00 (seg,ter) + Jantar
//   B: seg 720-900 + seg 840-1080 (SOBREPOSTAS)  -> tem de fundir em seg 720-1080
// … correr a migração, e para cada (tenant, weekday) comparar
//   slotMinutes(janelas) === slotMinutes(servicos)  -> tem de bater 100%
```

- [ ] **Step 5: Aplicar e correr**

```bash
pnpm --filter @comanda/api exec prisma migrate dev
node apps/api/scripts/test-migration-services.mjs
```
Esperado: slots idênticos em todos os (tenant, weekday); o tenant B com um só serviço 12:00–18:00.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(reservas): ReservationService + migração expand com backfill (R4-T1)"
```

---

### Task 2: `servicesFor` + CRUD de serviços + o fallback à vista

**Files:**
- Create: `apps/api/src/modules/reservations/services.util.ts` + `.spec.ts`
- Modify: `reservations.service.ts`, `reservations.controller.ts`, `dto/panel.dto.ts`

**Interfaces:**
- Consumes: Task 1 (`ReservationService`)
- Produces: `servicesFor(tenant, weekday): { openMinute, closeMinute }[]` — **mesma forma** que o `windowsFor`
- Produces: `listServicesForDay(tenantId, dateISO): { id, name, openMinute, closeMinute, synthetic: boolean }[]`
- Produces: `GET/POST/PATCH/DELETE /reservation-services`, `GET /reservation-services/day?date=`

- [ ] **Step 1: `services.util.ts` (puro)**

```ts
export interface ServiceLike {
  id: string;
  name: string;
  weekdays: number[];
  openMinute: number;
  closeMinute: number;
  sortOrder: number;
}
export interface HourLike { weekday: number; openMinute: number; closeMinute: number }

/** Serviços de um weekday, ordenados. Vazio = o chamador cai no fallback. */
export function servicesOfWeekday(services: ServiceLike[], weekday: number): ServiceLike[] {
  return services
    .filter((s) => s.weekdays.includes(weekday))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.openMinute - b.openMinute);
}

/**
 * Janelas de SEATING de um weekday. Mesma forma e mesma semântica do antigo windowsFor:
 * serviços do dia, ou o fallback OpeningHour−60 quando não há nenhum.
 * O fallback MANTÉM-SE: mudá-lo alteraria a disponibilidade de quem já usa isto.
 */
export function windowsOf(
  services: ServiceLike[],
  hours: HourLike[],
  weekday: number,
): { openMinute: number; closeMinute: number }[] {
  const own = servicesOfWeekday(services, weekday);
  if (own.length > 0) return own.map((s) => ({ openMinute: s.openMinute, closeMinute: s.closeMinute }));
  const oh = hours.find((h) => h.weekday === weekday);
  return oh ? [{ openMinute: oh.openMinute, closeMinute: oh.closeMinute - 60 }] : [];
}

/** true quando o dia corre pelo horário de abertura e não por serviços — o painel avisa. */
export function isSynthetic(services: ServiceLike[], weekday: number): boolean {
  return servicesOfWeekday(services, weekday).length === 0;
}
```

- [ ] **Step 2: Teste — `windowsOf` ≡ `windowsFor`, fallback incluído**

```ts
it('com serviços do dia devolve-os, ordenados', () => {
  const s = [svc({ weekdays: [1], openMinute: 1140, closeMinute: 1320, sortOrder: 2 }),
             svc({ weekdays: [1], openMinute: 720, closeMinute: 870, sortOrder: 1 })];
  expect(windowsOf(s, [], 1)).toEqual([{ openMinute: 720, closeMinute: 870 },
                                       { openMinute: 1140, closeMinute: 1320 }]);
});
it('sem serviços cai no OpeningHour−60 — o fallback MANTÉM-SE', () => {
  expect(windowsOf([], [{ weekday: 1, openMinute: 720, closeMinute: 1380 }], 1))
    .toEqual([{ openMinute: 720, closeMinute: 1320 }]);
});
it('sem serviços e sem horário devolve vazio', () => {
  expect(windowsOf([], [], 1)).toEqual([]);
});
it('serviço de OUTRO weekday não conta', () => {
  expect(windowsOf([svc({ weekdays: [2], openMinute: 720, closeMinute: 870 })], [], 1)).toEqual([]);
});
```

- [ ] **Step 3: Ligar ao service**

Em `reservations.service.ts`, `gatedTenant` e o carregamento do painel passam a `include: { reservationServices: true }` (**manter** o `reservationWindows` no include — a tabela ainda existe e o rollback de imagem depende disso). O `windowsFor(tenant, weekday)` passa a delegar:

```ts
  private windowsFor(tenant: TenantWithHours, weekday: number) {
    return windowsOf(tenant.reservationServices, tenant.openingHours, weekday);
  }
```

**Só isto.** O `slotMinutes`, o `slotsForDayTx`, o `publicDays` e os testes de DST não são tocados — é a razão de o `windowsOf` devolver a mesma forma.

- [ ] **Step 4: CRUD + validação de sobreposição**

```ts
  /** Dois serviços que partilhem um weekday não podem sobrepor-se: os slots duplicariam e a
   *  grelha de horas mentiria. (A validação é nova — o backfill da T1 funde as sobreposições
   *  que já existam, senão um tenant migrado ficaria sem poder gravar nada.) */
  private assertNoOverlap(existing: ServiceLike[], candidate: ServiceLike, ignoreId?: string) {
    for (const s of existing) {
      if (s.id === ignoreId) continue;
      if (!s.weekdays.some((d) => candidate.weekdays.includes(d))) continue;
      if (candidate.openMinute < s.closeMinute && s.openMinute < candidate.closeMinute) {
        throw new BadRequestException(
          `O serviço sobrepõe-se a "${s.name}" nos dias que partilham. Ajusta as horas ou os dias.`,
        );
      }
    }
  }
```

Mais as regras que já existem: `closeMinute > openMinute` e `closeMinute <= 1380` (23:00).

- [ ] **Step 5: `GET /reservation-services/day?date=`**

Devolve o que o painel navega, já com o sintético resolvido:

```ts
  async listServicesForDay(tenantId: string, dateISO: string) {
    if (!isRealDateISO(dateISO)) throw new BadRequestException('Data inválida.');
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { reservationServices: true, openingHours: true },
    });
    const wd = weekdayOf(dateISO);
    const own = servicesOfWeekday(tenant.reservationServices, wd);
    if (own.length > 0) {
      return own.map((s) => ({ id: s.id, name: s.name, openMinute: s.openMinute,
                               closeMinute: s.closeMinute, synthetic: false }));
    }
    // Fallback: o dia corre pelo horário de abertura. Devolvê-lo COMO SERVIÇO evita que a
    // timeline e o mapa nasçam vazios para a maioria dos tenants (que não tem janelas nenhumas).
    const w = windowsOf([], tenant.openingHours, wd);
    return w.map((x) => ({ id: `synthetic-${wd}`, name: 'Horário de abertura',
                           openMinute: x.openMinute, closeMinute: x.closeMinute, synthetic: true }));
  }
```

- [ ] **Step 6: Rotas com `@Roles` explícito**

`@Roles(UserRole.OWNER, UserRole.STAFF)` em **todas** — o `RolesGuard` falha aberto e sem o decorador o tablet da cozinha chega cá.

- [ ] **Step 7: Correr e commitar**

```bash
pnpm --filter @comanda/api test && node apps/api/scripts/e2e-reservas.mjs
```
Esperado: unit verdes; **e2e-reservas 124/124** (a promessa: o motor de slots não mudou).

```bash
git add -A && git commit -m "feat(reservas): servicesFor + CRUD de serviços + fallback à vista (R4-T2)"
```

---

### Task 3: `PUT /tables/layout` + a área limpa a posição

**Files:**
- Modify: `reservations.service.ts`, `reservations.controller.ts`, `dto/panel.dto.ts`

**Interfaces:**
- Produces: `PUT /tables/layout` body `{ area: string | null, positions: { id: string; x: number; y: number }[] }`

- [ ] **Step 1: DTO**

```ts
export class LayoutPositionDto {
  @IsString() @IsNotEmpty() id!: string;
  @IsInt() @Min(0) @Max(7) x!: number;   // 8 colunas (0..7) — ver §6 do spec
  @IsInt() @Min(0) @Max(49) y!: number;
}
export class SetLayoutDto {
  @IsOptional() @IsString() @MaxLength(60) area?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => LayoutPositionDto)
  positions!: LayoutPositionDto[];
}
```

- [ ] **Step 2: `setLayout` — a área INTEIRA, numa transação**

```ts
  /**
   * Grava o layout de uma área inteira. O PUT leva TODAS as mesas da área, não só as que se
   * mexeram: se levasse só as duas de uma troca, o auto-layout das restantes nunca ficaria
   * gravado e dois dispositivos veriam salas diferentes até alguém arrastar.
   * Transação: uma troca são duas mesas a mudar, e o estado intermédio seria visível.
   */
  async setLayout(tenantId: string, dto: SetLayoutDto) {
    const ids = dto.positions.map((p) => p.id);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Mesas repetidas.');
    const chaves = dto.positions.map((p) => `${p.x},${p.y}`);
    if (new Set(chaves).size !== chaves.length) throw new BadRequestException('Duas mesas na mesma célula.');
    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.table.count({ where: { id: { in: ids }, tenantId, area: dto.area ?? null } });
      if (owned !== ids.length) throw new NotFoundException('Mesa não encontrada.');
      for (const p of dto.positions) {
        await tx.table.updateMany({ where: { id: p.id, tenantId }, data: { x: p.x, y: p.y } });
      }
      return { saved: dto.positions.length };
    });
  }
```

- [ ] **Step 3: Mudar de área limpa a posição**

Em `updateTable`, antes do `updateMany` (que já tem a guarda `assertStillBookable` da R3):

```ts
    // Mudar de área leva o x,y consigo e a mesa aterra em cima de outra na sala nova, sem
    // ninguém ter arrastado nada. A posição numa sala não quer dizer nada noutra.
    const data: Prisma.TableUpdateInput = { ...dto };
    if (dto.area !== undefined) {
      const atual = await this.prisma.table.findFirst({ where: { id, tenantId }, select: { area: true } });
      if (atual && (atual.area ?? null) !== (dto.area ?? null)) {
        data.x = null;
        data.y = null;
      }
    }
```

- [ ] **Step 4: Rota**

```ts
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, UserRole.STAFF)  // o RolesGuard falha ABERTO: sem isto, a cozinha chega cá
  @Put('tables/layout')
  setLayout(@TenantId() tenantId: string, @Body() dto: SetLayoutDto) {
    return this.reservations.setLayout(tenantId, dto);
  }
```

> A rota `tables/layout` tem de ser declarada **antes** de `tables/:id`, senão o Nest resolve `layout` como `:id`.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @comanda/api test
git add -A && git commit -m "feat(reservas): PUT /tables/layout + mudar de área limpa a posição (R4-T3)"
```

---

### Task 4: jest no dashboard + `occupancy.util` — o estado da mesa e a lotação (puro)

> **O dashboard não tem jest** (confirmado: nenhum script `test` no `apps/dashboard/package.json`;
> a api tem-no inline, `"jest": { "preset": "ts-jest" }`). Esta task instala-o — é a primeira vez
> que o painel ganha testes, e esta é a lógica que os merece: se divergir da do servidor, o mapa
> volta a mentir.
>
> **Porque não um pacote partilhado:** há `packages/` no workspace mas só com `tsconfig`; criar um
> pacote com build e jest próprios para um predicado de uma linha é peso a mais. A regra é
> duplicada de propósito, com um comentário a apontar para a fonte
> (`apps/api/src/modules/reservations/days.util.ts` → `occupiedAt`) e testes dos dois lados a
> fixá-la. Se divergirem, o mapa mente — mas o servidor continua a recusar, logo é um bug de UX,
> não um buraco de segurança.

**Files:**
- Modify: `apps/dashboard/package.json` — jest + ts-jest + `"test": "jest --passWithNoTests"`
- Create: `apps/dashboard/src/lib/occupancy.util.ts` + `.spec.ts`

**Interfaces:**
- Produces: `tableStateAt(table, reservas, T, durMs, bufMs): { kind: 'free'|'free-until'|'reserved'|'inactive', reservation?, freeUntil? }`
- Produces: `occupancyOfSlot(tables, reservas, slotStart, durMs, bufMs): { tables: number; people: number }`
- Produces: `autoLayout(tables, cols): Map<string, {x,y}>`

- [ ] **Step 1: Testes primeiro — o estado que mentia**

```ts
const R = (id, start, end, party = 2, tableIds = ['M4']) => ({ id, startsAt: start, endsAt: end,
  partySize: party, status: 'CONFIRMED', tableNames: tableIds, tables: tableIds.map((t) => ({ tableId: t })) });

it('mesa com reserva às 20:00 NÃO é «Livre» às 18:30 (duração 120)', () => {
  // Era o bug do desenho: livre no INSTANTE, mas 18:30+120 = 20:30 atropela as 20:00.
  const s = tableStateAt(t('M4'), [R('r1', d('20:00'), d('22:00'))], d('18:30'), 120 * 60e3, 0);
  expect(s.kind).toBe('free-until');
  expect(s.freeUntil).toBe('20:00');
});
it('mesa com reserva às 20:00 é «Livre» às 17:00 (17:00+120 = 19:00, cabe)', () => {
  expect(tableStateAt(t('M4'), [R('r1', d('20:00'), d('22:00'))], d('17:00'), 120 * 60e3, 0).kind).toBe('free');
});
it('mesa ocupada no instante é «Reservada»', () => {
  expect(tableStateAt(t('M4'), [R('r1', d('20:00'), d('22:00'))], d('20:30'), 120 * 60e3, 0).kind).toBe('reserved');
});
it('mesa inativa é «Inativa», nunca «Livre»', () => {
  expect(tableStateAt(t('M4', { active: false }), [], d('20:00'), 120 * 60e3, 0).kind).toBe('inactive');
});
it('CANCELLED não ocupa', () => {
  const r = { ...R('r1', d('20:00'), d('22:00')), status: 'CANCELLED' };
  expect(tableStateAt(t('M4'), [r], d('20:30'), 120 * 60e3, 0).kind).toBe('free');
});
it('a lotação conta por INTERSEÇÃO, não por hora de início', () => {
  // reserva 20:00–22:00 conta em 20:00, 20:30, 21:00, 21:30 — e não em 19:30
  const rs = [R('r1', d('20:00'), d('22:00'), 4)];
  expect(occupancyOfSlot([t('M4')], rs, d('19:30'), 120 * 60e3, 0).people).toBe(0);
  expect(occupancyOfSlot([t('M4')], rs, d('21:30'), 120 * 60e3, 0).people).toBe(4);
});
it('a reserva que começou antes do serviço e ainda lá está conta', () => {
  expect(occupancyOfSlot([t('M4')], [R('r1', d('18:00'), d('20:00'), 3)], d('19:00'), 120 * 60e3, 0).people).toBe(3);
});
it('mesas inativas ficam FORA do denominador', () => {
  const o = occupancyOfSlot([t('M4'), t('M9', { active: false })], [], d('20:00'), 120 * 60e3, 0);
  expect(o.tables).toBe(0); // e o componente divide por 1, não por 2
});
it('auto-layout: as órfãs vão para células livres, nunca por cima', () => {
  const m = autoLayout([t('A', { x: 0, y: 0 }), t('B'), t('C')], 8);
  expect(m.get('A')).toEqual({ x: 0, y: 0 });
  expect([...m.values()].filter((v) => v.x === 0 && v.y === 0)).toHaveLength(1);
});
```

- [ ] **Step 2: Implementar**

A regra de ocupação é a **mesma do servidor** (`occupiedAt(busy, T, T+dur, buf)` em `apps/api/.../days.util.ts`): uma reserva ocupa a mesa quando `r.startsAt < T+dur+buf` **e** `r.endsAt+buf > T`. Só `CONFIRMED` ocupa.

- [ ] **Step 3: Correr e commitar**

```bash
pnpm --filter @comanda/dashboard test
```
Esperado: os 9 testes do Step 1 verdes — incluindo o «às 18:30 NÃO é Livre», que é o bug que o
desenho original tinha.

```bash
git add -A && git commit -m "feat(painel): jest no dashboard + occupancy.util pela regra do servidor (R4-T4)"
```

---

### Task 5: `FloorMap` — a grelha, o arrastar, os estados

**Files:**
- Create: `apps/dashboard/src/components/FloorMap.tsx`

**Interfaces:**
- Consumes: Task 4 (`tableStateAt`, `autoLayout`), Task 3 (`PUT /tables/layout`)
- Props: `{ tables, reservations, areas, area, onAreaChange, cursorAt, onPickTable }`

- [ ] **Step 1: A geometria, com a conta à vista**

```tsx
// O <main> do AppShell tem px-4 e nenhum max-width: a 375px sobram 343px. 12 colunas dariam
// células de 23px — metade do mínimo tátil (44px HIG / 48dp Material) — com o nome da mesa,
// os lugares e o nome do cliente lá dentro. 8 colunas × 56px = 504px, com scroll horizontal
// dentro do cartão em ecrãs estreitos. Um nº de colunas variável tornaria o `x` gravado
// ambíguo: a mesma mesa em sítios diferentes conforme o telemóvel.
const COLS = 8;
const CELL = 56;
const GAP = 8;
```

Contentor: `<div className="overflow-x-auto">` com o canvas a `width: COLS*CELL + (COLS-1)*GAP`.

- [ ] **Step 2: Separadores de área + auto-layout**

Áreas = `[...new Set(tables.map(t => t.area ?? 'Sem área'))]`. Dentro da área, `autoLayout` coloca as órfãs. **O mapa nunca aparece vazio.**

- [ ] **Step 3: Arrastar (HTML5 drag + touch)**

`draggable`, `onDragStart` guarda o id, `onDrop` na célula calcula `{x,y}`. Largar em cima de outra mesa **troca-as**. No fim, `PUT /tables/layout` com **todas** as mesas da área.

> Mobile: o HTML5 drag-and-drop não dispara em touch. Usar `onPointerDown/Move/Up` com
> `setPointerCapture` — um só caminho para rato e dedo, sem biblioteca.

- [ ] **Step 4: Estados**

Do `tableStateAt`: `free` (contorno, clicável), `free-until` (esbatido + «até 20:00», clique explica), `reserved` (cor da loja + primeiro nome + pax), `inactive` (tracejado). Mesas juntas: mesmo `reservationId` → borda partilhada.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @comanda/dashboard exec tsc --noEmit
git add -A && git commit -m "feat(painel): FloorMap — grelha 8×56 com estados pela regra do servidor (R4-T5)"
```

---

### Task 6: `TimelineCursor`

**Files:**
- Create: `apps/dashboard/src/components/TimelineCursor.tsx`

**Interfaces:**
- Consumes: Task 4 (`occupancyOfSlot`), Task 2 (`GET /reservation-services/day`)
- Props: `{ service, tables, reservations, cursorAt, onCursorChange }`

- [ ] **Step 1: Slots + barras**

Slots de 30 em 30, de `openMinute` a `closeMinute`. Barra = % de mesas **ativas** ocupadas; número = pessoas. Um serviço 12:00–14:30 tem 6 slots (≈49px em 343px); um contínuo 12:00–23:00 tem 23 → **scroll horizontal** e o slot do cursor trazido à vista.

- [ ] **Step 2: Cursor**

Por omissão *agora* se for hoje e dentro do serviço; senão o início. Tocar/arrastar muda o cursor.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(painel): TimelineCursor — lotação que é o cursor de tempo (R4-T6)"
```

---

### Task 7: Definições — serviços, apagar que avisa, tolerância

**Files:**
- Create: `apps/dashboard/src/components/ServicesCard.tsx`
- Modify: `components/ReservationSettings.tsx`, `app/reservations/components/ReadinessCard.tsx`

- [ ] **Step 1: `ServicesCard`** — CRUD (nome, chips dos dias, abre/fecha). O `WindowsCard` das janelas sai.

- [ ] **Step 2: Apagar avisa com a consequência REAL**

```tsx
// «Apagar o serviço de Almoço» não fecha o almoço: ABRE o dia todo. Sem serviços no weekday, o
// windowsOf cai no OpeningHour−60 e 12:00–14:30 vira 12:00–22:00, incluindo as 17:00 com a
// cozinha fechada — o oposto do que o dono quer, em silêncio.
`Sem serviços à ${diaNome}, as reservas passam a seguir o teu horário de abertura: ` +
`${hhmm(fallbackOpen)}–${hhmm(fallbackClose)}, incluindo as horas em que a cozinha está fechada. ` +
`Queres antes bloquear o dia?`
```
Com atalho para o bloqueio de dia, que já existe.

- [ ] **Step 3: Tolerância** — `<input type="number">` para `reservationGraceMin`. **Cuidado com o `undefined` no PATCH.**

- [ ] **Step 4: `ReadinessCard`** — a proveniência passa a dizer o nome: «Sáb 12:00–22:00 — vem do teu horário de abertura, não de um serviço» + CTA «Criar serviços».

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(painel): serviços nas Definições, apagar avisa, tolerância (R4-T7)"
```

---

### Task 8: A página — switcher Lista/Mapa e o modal pré-preenchido

**Files:**
- Modify: `app/reservations/page.tsx`, `components/ReservationFormModal.tsx`, `lib/reservations-hooks.ts`, `lib/reservation-types.ts`

- [ ] **Step 1: O modal ganha `initial`**

Hoje aceita `{ mode, reservation, onClose }` e, em `mode:'create'`, fixa `date = todayISO()`, `time = nowHHMM()`, `tableIds = []` (linhas 44-68). Sem isto não há como pré-preencher — o §6 do spec depende disto.

```tsx
export function ReservationFormModal({
  mode,
  reservation,
  initial,
  onClose,
}: {
  mode: 'create' | 'edit';
  reservation?: Reservation;
  /** Pré-preenchimento vindo do mapa: a mesa tocada e a hora do cursor. */
  initial?: { date?: string; time?: string; tableIds?: string[] };
  onClose: () => void;
}): JSX.Element {
  const [date, setDate] = useState(reservation ? localDate(reservation.startsAt) : (initial?.date ?? todayISO()));
  const [time, setTime] = useState(reservation ? localTime(reservation.startsAt) : (initial?.time ?? nowHHMM()));
  // … tableIds: reservation ? … : (initial?.tableIds ?? [])
```

- [ ] **Step 2: Switcher + estado partilhado**

Na `page.tsx`: `view: 'lista' | 'mapa'`, `cursorAt: Date`, `area: string | null` — **acima** das duas vistas, para trocar não perder o contexto.

- [ ] **Step 3: Commit**

```bash
pnpm --filter @comanda/dashboard exec tsc --noEmit
git add -A && git commit -m "feat(painel): switcher Lista/Mapa + modal pré-preenchido pelo mapa (R4-T8)"
```

---

### Task 9: A copy da tolerância

**Files:**
- Modify: `apps/api/src/modules/mail/mail.service.ts`, `apps/storefront/src/app/[slug]/reservar/ReservarClient.tsx`, `apps/storefront/src/app/[slug]/reserva/[code]/ReservaClient.tsx`

- [ ] **Step 1:** O texto fixo da R3 («Chega à hora marcada; se te atrasares, liga…») passa a «A tua mesa fica guardada {graceMin} minutos.» O `graceMin` vai no `getPublicBySlug` (**gated por `reservationsEnabled`**, como o resto — ver R3) e no `mailInfo`.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(reservas): tolerância de atraso na copy do cliente (R4-T9)"
```

---

### Task 10: E2e + verificação em browser

**Files:**
- Modify: `apps/api/scripts/e2e-reservas.mjs`

- [ ] **Step 1: Casos novos**

1. CRUD de serviços; sobreposição no mesmo weekday → 400.
2. **Apagar o último serviço de um dia** → o dia passa a correr pelo fallback (prova a consequência que o aviso descreve).
3. `GET /reservation-services/day` num dia sem serviços → devolve o **sintético** com `synthetic: true`.
4. `PUT /tables/layout` grava a área inteira; duas mesas na mesma célula → 400; mesa de outro tenant → 404.
5. **KITCHEN não chega ao `PUT /tables/layout`** → 403. (O `RolesGuard` falha ABERTO: este teste é o que prova o decorador.)
6. Mudar a área de uma mesa → `x` e `y` ficam `null`.
7. `reservationGraceMin` no payload público só com `reservationsEnabled`.

- [ ] **Step 2: Correr tudo, com o ambiente limpo**

```bash
pkill -9 -f "dist/main"; pnpm --filter @comanda/api build && (node --enable-source-maps apps/api/dist/main &)
# limpar a demo; UM e2e de cada vez
pnpm --filter @comanda/api test && node apps/api/scripts/e2e-reservas.mjs && node apps/api/scripts/e2e-kitchen.mjs
```
Esperado: unit verdes · reservas **todos** ✅ · kitchen 42/42.

- [ ] **Step 3: Browser (obrigatório — não delegável a «parece bem»)**

Arrastar uma mesa e a posição sobreviver ao F5 · scrub da timeline a mover o mapa · mesa livre → modal com a mesa e a hora certas · mesa «Livre até» → explica em vez de oferecer · separadores de área · mudar a área no TablesManager e a mesa não aterrar em cima de outra · a loja pública intacta.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(reservas): e2e da R4 (serviços, layout, roles, fallback) (R4-T10)"
```

---

## Notas de rollout (para o dono, não para o executor)

1. **`pg_dump` antes** — a T1 traz migração.
2. A `ReservationWindow` **fica**. O DROP é um ciclo posterior, depois de a R4 estar provada. Isto dá rollback por imagem sem restaurar dump.
3. **Recomendação fora deste plano:** separar o `prisma migrate deploy` do arranque da API. Hoje uma migração falhada põe a API em crash-loop e leva **as encomendas** atrás.
