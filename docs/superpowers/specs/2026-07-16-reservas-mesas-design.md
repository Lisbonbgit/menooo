# Reservas de Mesas Menooo — gestão de mesas com auto-confirmação (estilo TheFork)

**Data:** 2026-07-16
**Ramo:** `matheus-reservas-mesas`
**Estado:** design aprovado + revisão adversarial incorporada (falta revisão final do utilizador)

> Este spec foi endurecido por uma revisão adversarial de 4 lentes (algoritmo/concorrência,
> segurança/multi-tenancy, operação real de restaurante, encaixe no código). A revisão
> encontrou 1 bloqueador e 9 achados fortes; as correções estão integradas e as
> **mudanças de âmbito face ao design aprovado** estão marcadas com **[AJUSTE]** para
> validação do utilizador.

## 1. Contexto e objetivo

Os restaurantes do Menooo querem oferecer **reserva de mesas online**. Modelo aprovado:
**gestão de mesas completa** — o dono cria as mesas, o sistema calcula disponibilidade,
**confirma automaticamente** e atribui mesa(s), incluindo **juntar 2 mesas**.

## 2. Decisões (aprovadas + ajustes da revisão)

| Tema | Decisão |
|---|---|
| Modelo | Gestão de mesas completa (dono cria mesas; sistema atribui) |
| Confirmação | **Auto-confirma** — sem estado "pendente" |
| Duração | Configurável por restaurante (default 120 min) + **buffer** entre reservas (default 0) |
| Juntar mesas | Até **2 mesas** da mesma área marcadas juntáveis (3+ = v2) |
| Onde reserva | Loja pública + widget |
| Avisos | Painel tempo real (socket staff + alarme) + emails |
| **[AJUSTE] Janelas de reserva** | **Próprias, até 2 por dia** (almoço/jantar), com fallback ao horário de abertura — sem isto, o auto-confirma aceita reservas às 17h com a cozinha fechada (achado high; alinha com o pedido "horários repartidos" da testadora) |
| **[AJUSTE] Bloqueio de dias** | **Em R1** (feriados/eventos privados) + botão "Pausar reservas de hoje" — sem isto o sistema confirma clientes num dia fechado (achado BLOCKER) |
| **[AJUSTE] Mesa "reservável online"** | Flag por mesa — o dono guarda mesas para walk-ins/habitués (achado high) |
| **[AJUSTE] Editar reserva** | PATCH no painel (hora/pax/mesas/notas) — "afinal somos 6" acontece todos os dias (achado high) |
| **[AJUSTE] Reserva manual com regras próprias** | Telefone/walk-in ignora antecedências/grelha/máx. pax (achado high) |

## 3. Modelo de dados (migração aditiva)

```prisma
enum ReservationStatus {
  CONFIRMED
  CANCELLED
  COMPLETED
  NO_SHOW // liberta a mesa para o resto da janela (disponibilidade só conta CONFIRMED)
}

model Table {
  id             String  @id @default(cuid())
  tenantId       String
  tenant         Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name           String
  area           String? // juntar só dentro da mesma área não-nula
  seats          Int
  joinable       Boolean @default(false)
  bookableOnline Boolean @default(true) // false = só atribuível em reservas MANUAL
  active         Boolean @default(true)
  sortOrder      Int     @default(0)
  reservations   ReservationTable[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([tenantId])
}

model Reservation {
  id               String            @id @default(cuid())
  tenantId         String
  tenant           Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  code             String            @unique // base32 6 chars; P2002 → re-gerar (padrão kitchenPairCode)
  cancelTokenHash  String? // sha256 hex do token (NÃO argon2 — token tem 256 bits, ver §7)
  status           ReservationStatus @default(CONFIRMED)
  source           String            @default("ONLINE") // ONLINE | MANUAL
  partySize        Int
  startsAt         DateTime // UTC
  endsAt           DateTime // UTC — materializado (inclui duração; o buffer soma-se NA QUERY)
  customerName     String
  customerPhone    String
  customerEmail    String? // obrigatório ONLINE; opcional MANUAL
  notes            String?
  marketingConsent Boolean           @default(false) // consistente com Order (registo RGPD)
  cancelledBy      String? // CUSTOMER | RESTAURANT
  tables           ReservationTable[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  @@index([tenantId, startsAt])
}

model ReservationTable {
  reservationId String
  reservation   Reservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  tableId       String
  table         Table       @relation(fields: [tableId], references: [id], onDelete: Restrict)
  @@id([reservationId, tableId])
  @@index([tableId])
}

/// Janela de SEATING para reservas (até 2 por weekday, imposto no service).
/// Sem janelas definidas para um weekday → fallback ao OpeningHour desse dia.
model ReservationWindow {
  id          String @id @default(cuid())
  tenantId    String
  tenant      Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  weekday     Int // 0=domingo … 6=sábado (mesma convenção do OpeningHour)
  openMinute  Int
  closeMinute Int // último slot COMEÇA em closeMinute (janela de seating, não de estadia)
  @@index([tenantId, weekday])
}

/// Dia inteiro sem reservas online (feriado, evento privado, "pausar hoje").
model ReservationBlock {
  id       String  @id @default(cuid())
  tenantId String
  tenant   Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  date     String // YYYY-MM-DD na timezone do tenant (dia LOCAL)
  reason   String?
  createdAt DateTime @default(now())
  @@unique([tenantId, date])
}
```

`Tenant` ganha (aditivo, validadores no §5):

```prisma
  reservationsEnabled       Boolean @default(false)
  reservationDurationMin    Int     @default(120)
  reservationBufferMin      Int     @default(0) // limpeza/turnover entre reservas
  reservationMinNoticeMin   Int     @default(60)
  reservationMaxAdvanceDays Int     @default(30)
  reservationMaxPartySize   Int     @default(12) // só canal ONLINE
```

- **Apagar mesa:** recusa (409 "desativa a mesa em vez de apagar") se existir QUALQUER
  `ReservationTable` histórica (integridade do histórico); além do pre-check, apanhar
  `P2003` e mapear para o mesmo 409 (corrida pre-check→delete).
- **`endsAt` materializado** faz a sobreposição indexável; **o buffer aplica-se na
  query** (`startsAt < :end + buffer && endsAt + buffer > :start`... simplificado:
  comparar contra a janela alargada `[start - buffer, end + buffer)`), para poder mudar
  o buffer sem reescrever reservas.

## 4. Disponibilidade e atribuição

### 4.1 Janelas e slots (`GET /public/stores/:slug/reservation-slots?date&party`)

1. Gating §6; `party <= reservationMaxPartySize` (acima → resposta com
   `contactPhone` do tenant e mensagem "para grupos maiores, contacta-nos").
2. **Dia bloqueado** (`ReservationBlock` com essa data local) → sem slots.
3. Janelas do weekday = `ReservationWindow` (até 2); **sem janelas → fallback** à faixa
   do `OpeningHour`. Semântica: **janela de SEATING** — slots de 30 min de `openMinute`
   até `closeMinute` inclusive (a estadia pode ultrapassar o fecho; é o dono que define
   até quando SENTA). No fallback ao OpeningHour, último slot = `closeMinute − 60`
   (buffer de last-seating, documentado na UI).
   **O gerador itera SEMPRE uma lista de janelas** (1–2), fallback incluído.
4. Filtros: slot ≥ agora + `minNotice`; data ≤ hoje + `maxAdvanceDays`.
5. Cada slot corre a atribuição (4.2) com mesas `bookableOnline`; devolve
   `{ slots: string[] }` (hora local do tenant), **deduplicados por instante UTC**
   (colisões DST, ver 4.4).
6. Limitação assumida v1 (herdada do OpeningHour): **sem horários que atravessam a
   meia-noite** (fecho ≤ 24:00); overnight fica no §12.

### 4.2 Atribuição (janela, partySize, canal)

Candidatas = mesas `active` (e `bookableOnline` se canal ONLINE), menos as ocupadas por
reservas CONFIRMED cuja janela alargada pelo buffer interseta.

1. **Mesa única best-fit:** menor `seats >= partySize`; empate → menor `sortOrder`.
2. **Par juntável** (só se nenhuma única serve): `joinable` + mesma `area` não-nula,
   soma ≥ partySize, menor desperdício; empate → menor soma. Máx. 2 mesas.
3. Sem solução → indisponível (no POST: 409 + `alternatives` = até 4 slots do dia).

**Decisão explícita (trade-off avaliado):** single-primeiro pode dar a mesa de 8 a um
grupo de 4 mesmo havendo par 2+2 livre. Mantém-se **single-primeiro** porque juntar
mesas tem custo operacional real (mover mobília) e a simplicidade previsível vale o
desperdício ocasional; os testes do util cobrem estes cenários como comportamento
ESPERADO. (v2: comparar desperdício single vs par com limiar.)

**Mesas forçadas (MANUAL):** validam apenas `active` + não-sobreposição + máx. 2;
`joinable`/`area`/`seats` são ignorados (o dono sabe melhor; a UI avisa sem bloquear se
capacidade < partySize).

### 4.3 Criação transacional (anti-corrida)

- **Advisory lock por tenant** em transação Read Committed:
  `SELECT pg_advisory_xact_lock(hashtext(${tenantId}))` no início — serializa as
  criações/edições de reservas do tenant, elimina retries de serialização e falsos
  conflitos entre tenants. *(Escolhido em vez de Serializable+P2034 pela simplicidade e
  pelos caveats reais: P2010/40001 em $queryRaw, SIREAD page-locks cross-tenant.)*
- O POST público **revalida o pipeline completo** dentro do lock: grelha de 30 min,
  janela do weekday, dia não bloqueado, antecedências, gating, atribuição. `time` fora
  da grelha/janela → 422; slot ocupado entretanto → 409 + `alternatives`.
- `code` com retry em P2002 (padrão do kitchenPairCode).
- **Emails e eventos socket SÓ após commit** (nunca dentro da transação).
- **MANUAL** (painel): mesmo lock e sobreposição; **ignora** grelha (hora livre
  arredondada a 15 min, pode ser "agora"), minNotice, maxAdvance e maxPartySize;
  `durationMin?` opcional (30–480, default = do tenant); telefone/email opcionais.
- **PATCH /reservations/:id (edição)**: hora/duração/pax/mesas/notas — re-corre a
  atribuição no mesmo lock (mesa forçada opcional); sem email automático ao cliente no
  MVP (o painel mostra aviso "avisa o cliente da alteração").

### 4.4 `localDateTimeToUtc(date, minutes, tz)` — util NOVO (inversa do open-now)

Técnica **inversa** da do open-now (que só converte instante→partes locais): chute
UTC + reformatar em `tz` + ajustar pela diferença, em **duas passagens**.
- Hora **inexistente** (DST março): resolve para o offset seguinte (detetada porque a
  2.ª passagem não bate certo).
- Hora **ambígua** (DST outubro): tie-break = **primeira ocorrência** (offset anterior,
  comportamento java.time).
- Slots deduplicados por instante UTC (4.1.5).
- Testes pinados a 2026-03-29 e 2026-10-25 em Europe/Lisbon.

## 5. Endpoints

### Públicos (módulo novo `reservations`; todos `@Public()`; gating §6)

- `GET /public/stores/:slug/reservation-slots?date&party` → `{ slots }` (throttle global).
- `POST /public/stores/:slug/reservations` — **throttle dedicado 5/min por IP**
  (auto-confirma e ocupa recursos reais; 30/min era demasiado) + **cap por contacto**:
  máx. 2 reservas CONFIRMED futuras por email OU telefone por tenant (429 amigável).
  Body: `{ date, time, partySize, customerName, customerPhone, customerEmail, notes?,
  marketingConsent? }` (limites: name 120, notes 500; email obrigatório).
  → `{ code, startsAt, endsAt, partySize, tableNames, manageUrl }` — o ecrã de
  confirmação MOSTRA o código e o link de gestão (quem acabou de criar já conhece os
  dados; resolve "enganei-me no email"). Emails + socket pós-commit.
- `GET /public/reservations/:code` com **token no header `X-Reservation-Token`**
  (NUNCA em query — iria para os logs do Caddy/Next; a página storefront lê o token do
  URL do email, faz `history.replaceState` imediato e guarda em sessionStorage;
  `Referrer-Policy: no-referrer`). Throttle 10/min.
- `POST /public/reservations/:code/cancel` `{ token }` (body). Throttle 10/min.
- Erros neutros `'Reserva não encontrada.'`; reservas **MANUAL (sem token) devolvem
  SEMPRE o 404 neutro** nos públicos, com qualquer token.
- GET estado e cancel **NÃO são gated** por `reservationsEnabled`/subscrição (clientes
  com reservas existentes têm de poder consultar/cancelar depois de o dono desligar).

### Painel (módulo `reservations`; OWNER/STAFF por método; KITCHEN fora de TUDO)

- `GET/POST /tables`, `PATCH/DELETE /tables/:id` — **todas as queries com
  `where: { id, tenantId }` composto**; `tableIds` recebidos são validados como do
  tenant (`count === tableIds.length`, senão 400) — anti-IDOR, com e2e cross-tenant.
- `GET /reservations?date` · `POST /reservations` (manual, §4.3) ·
  `PATCH /reservations/:id` (edição, §4.3) · `PATCH /reservations/:id/status`
  `{ COMPLETED | NO_SHOW | CANCELLED }` (só a partir de CONFIRMED; cancelar → email ao
  cliente se tiver email).
- `GET/PUT /reservation-windows` (até 2 por weekday) · `GET/POST/DELETE
  /reservation-blocks` (+ atalho "hoje").
- Config: campos novos no `UpdateTenantDto` com validadores explícitos —
  `reservationDurationMin @IsInt @Min(30) @Max(480)`, `reservationBufferMin @IsInt
  @Min(0) @Max(120)`, `reservationMinNoticeMin @IsInt @Min(0) @Max(2880)`,
  `reservationMaxAdvanceDays @IsInt @Min(1) @Max(90)`, `reservationMaxPartySize @IsInt
  @Min(1) @Max(50)`, `reservationsEnabled @IsBoolean` *(sem limites, duração 0 tornava
  todas as mesas eternamente livres — achado high)*.

### Tempo real e emails

- **Salas por papel no gateway** *(achado high — a sala única daria PII de reservas ao
  tablet de cozinha)*: no handshake, sockets não-KITCHEN entram também em
  `tenant:<id>:staff`; `reservation.created/updated` emitem SÓ para essa sala
  (encomendas continuam na sala comum). E2e: socket KITCHEN não recebe `reservation.*`.
- Emails: `sendReservationConfirmed`/`sendReservationCancelled` (cliente),
  `sendNewReservationAlert`/`sendReservationCancelledAlert` (restaurante — para
  `tenant.email ?? account.users[0].email` *(unidades novas têm email null; padrão já
  usado no admin)*; adicionar `email @IsEmail` opcional ao UpdateTenantDto + campo nas
  definições em R2). **Todos os campos do cliente HTML-escaped + strip de `\r\n`**
  (anti-injeção em templates/headers).

## 6. Gating público

Slots e criação exigem `status ACTIVE` + `isSubscriptionUsable` + `reservationsEnabled`
→ senão **404, por consistência com o padrão público das encomendas** (o flag em si é
público no payload da loja — o 404 não é sigilo, é consistência). `getPublicBySlug`
ganha `reservationsEnabled` (whitelist explícita; sitemap não afetado; o separador
"Reservar" da loja pode demorar ~5 min a aparecer/desaparecer pelo ISR de 300 s —
aceitável, o gating server-side é em tempo real; interface `Store` do storefront ganha
o campo; a página de reservar busca slots com `cache: 'no-store'`).

## 7. Segurança e privacidade (resumo)

- Cancel token: 32 bytes random → **sha256 + `timingSafeEqual`** (argon2 seria vetor de
  exaustão de CPU em endpoints públicos; 256 bits não precisam de hash lento).
- Token nunca em query na API; PII só no painel do tenant; isolamento por `tenantId`
  composto em todos os writes; KITCHEN fora de endpoints E socket.
- Anti-spam: throttle 5/min no POST, 10/min no estado/cancel, cap 2 reservas ativas por
  contacto; Turnstile/honeypot e confirmação de email = v2.

## 8. Painel — aba "Reservas" (R2)

- Nav "Reservas" (CalendarCheck) OWNER/STAFF (a cozinha nem vê a rota — guard existente).
- **Topo:** botão **"Pausar reservas de hoje"** (cria bloqueio de hoje; expira sozinho).
- **Vista do dia:** lista cronológica (hora, nome, pax, mesa(s), telefone, notas, chips
  de estado) + totais; tempo real + alarme. Ações: Concluída / Não apareceu / Cancelar /
  **Editar**.
- **Reserva manual:** modal com regras próprias (§4.3) — inclui "agora" (walk-in).
- **Mesas:** CRUD (nome, lugares, área, juntável, **reservável online**, ativa, ordem);
  por mesa, "livre até HH:MM" de hoje. **Janelas de reserva** (até 2/dia, ex. almoço e
  jantar) + **dias bloqueados** + config (interruptor, duração, buffer, antecedências,
  máx. pax, email de alertas).
- Estado vazio: "Cria as tuas mesas para começar a aceitar reservas."

## 9. Loja pública (R3)

Separador "Reservar" (se `reservationsEnabled`) → `/[slug]/reservar`: pessoas → dia →
slots → dados → **confirmação com código + link de gestão**. Página
`/[slug]/reserva/[code]` (token via sessionStorage, §5) para consultar/cancelar. Widget:
`data-reservas="1"` abre direto em /reservar. Grupos > máx.: mensagem com telefone do
restaurante.

## 10. Testes

- **Utils puros com jest na API** *(primeiros testes unitários do repo — o plano R1
  inclui a tarefa de configurar o jest, hoje sem config)*: `assignTables` (best-fit,
  empates, par só mesma área, desperdício, cenários "perversos" documentados, bookable
  vs manual, máx 2), geração de slots (janelas 1–2, fallback+last-seating−60, bloqueios,
  antecedências, fronteiras), `localDateTimeToUtc` (DST 2026-03-29 e 2026-10-25).
- **E2e (apps/api/scripts/e2e-reservas.mjs, padrão e2e-kitchen):** criar mesas → janelas
  → slots → reservar → slot some → corrida (2 POSTs simultâneos, 1 ganha/1 409) →
  cancelar por token → slot volta → NO_SHOW liberta mesa → manual "agora" + forçada +
  sobreposição recusada → edição → bloqueio de dia mata slots → time fora da
  grelha/janela → 422 → MANUAL inacessível nos públicos → cap por contacto → matriz
  (KITCHEN 403 em tudo; cross-tenant 404/400; delete mesa com histórico 409) → gating.
- **R2/R3:** verificação integrada no browser (padrão das fases da cozinha).

## 11. Fases

- **R1 — Backend completo** (schema, jest, utils, endpoints, lock, emails, salas socket,
  e2e). Deploy às escuras possível.
- **R2 — Painel** (aba completa: dia, manual, edição, mesas, janelas, bloqueios, config).
- **R3 — Loja pública + widget**.

## 12. Fora de âmbito (v2)

Juntar 3+ mesas · comparação single-vs-par por desperdício · duração por janela
(almoço 90/jantar 120) · pacing de covers por slot (`reservationMaxCoversPerSlot` —
modelo não fecha a porta) · horários pós-meia-noite · bloqueios por mesa/período ·
depósitos e taxas de no-show · **lembrete por email no dia (melhor rácio custo/benefício
da v2 — priorizar)** · confirmação de email/telefone · Turnstile · lista de espera ·
timeline/mapa de sala · reservas recorrentes · realocação automática em atrasos.
