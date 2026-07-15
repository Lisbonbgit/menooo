# Reservas de Mesas Menooo — gestão de mesas com auto-confirmação (estilo TheFork)

**Data:** 2026-07-16
**Ramo:** `matheus-reservas-mesas`
**Estado:** design aprovado pelo utilizador (decisões §3); falta revisão adversarial + revisão final do utilizador

## 1. Contexto e objetivo

Os restaurantes do Menooo querem oferecer **reserva de mesas online** aos clientes deles,
além das encomendas. Decisão do utilizador: modelo **completo com gestão de mesas** — o
dono cria as mesas, o sistema calcula disponibilidade e **confirma automaticamente**
atribuindo mesa(s), incluindo **juntar mesas** para grupos maiores.

## 2. Decisões (aprovadas pelo utilizador)

| Tema | Decisão |
|---|---|
| Modelo | Gestão de mesas completa (dono cria mesas; sistema atribui) |
| Confirmação | **Auto-confirma** quando há mesa livre — sem estado "pendente" |
| Duração da reserva | **Configurável por restaurante** (default 120 min) |
| Juntar mesas | **Sim** — até **2 mesas** da mesma área marcadas como juntáveis (3+ = v2) |
| Onde o cliente reserva | Loja pública (`menooo.com/slug`) **+ widget** nos sites dos restaurantes |
| Avisos | Painel em tempo real (socket + alarme) + **emails** (cliente e restaurante) |
| Aba no painel | Nav nova "Reservas" com vista do dia + gestão de mesas + reserva manual |

## 3. Modelo de dados (migração aditiva)

```prisma
enum ReservationStatus {
  CONFIRMED // criada = confirmada (auto-confirmação)
  CANCELLED // pelo cliente (link) ou pelo restaurante
  COMPLETED // clientes vieram e a refeição aconteceu
  NO_SHOW // não apareceram
}

model Table {
  id        String  @id @default(cuid())
  tenantId  String
  tenant    Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name      String // "Mesa 1"
  area      String? // "Sala", "Esplanada" — juntar só dentro da mesma área
  seats     Int // lugares
  joinable  Boolean @default(false) // pode juntar-se a outra mesa juntável da mesma área
  active    Boolean @default(true) // desativar em vez de apagar (histórico)
  sortOrder Int     @default(0)

  reservations ReservationTable[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId])
}

model Reservation {
  id              String            @id @default(cuid())
  tenantId        String
  tenant          Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  code            String            @unique // referência curta p/ o cliente (base32, 6 chars)
  cancelTokenHash String? // hash argon2 do token do link de cancelamento (só ONLINE)
  status          ReservationStatus @default(CONFIRMED)
  source          String            @default("ONLINE") // ONLINE | MANUAL
  partySize       Int
  startsAt        DateTime // UTC
  endsAt          DateTime // UTC — materializado (startsAt + duração do tenant à data da criação)
  customerName    String
  customerPhone   String
  customerEmail   String? // obrigatório em ONLINE; opcional em MANUAL
  notes           String?
  cancelledBy     String? // CUSTOMER | RESTAURANT

  tables ReservationTable[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

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
```

`Tenant` ganha (aditivo):

```prisma
  // reservas de mesas
  reservationsEnabled     Boolean @default(false) // o dono liga quando tiver mesas
  reservationDurationMin  Int     @default(120) // duração de cada reserva
  reservationMinNoticeMin Int     @default(60) // antecedência mínima
  reservationMaxAdvanceDays Int   @default(30) // antecedência máxima
  reservationMaxPartySize Int     @default(12) // máx. pessoas por reserva online
```

- Apagar mesa: `onDelete: Restrict` na junção — o endpoint DELETE recusa se a mesa tem
  reservas (409 com mensagem "desativa a mesa em vez de apagar"); sem reservas, apaga.
- `endsAt` materializado torna o teste de sobreposição um simples
  `startsAt < :end AND endsAt > :start` indexável; mudar a duração nas definições só
  afeta reservas futuras novas.

## 4. Disponibilidade e atribuição (o coração)

### 4.1 Slots de um dia (`GET /public/stores/:slug/reservation-slots?date=YYYY-MM-DD&party=N`)

1. Valida gating (§6) e `party <= reservationMaxPartySize`.
2. Janela do dia = `OpeningHour` do weekday em `tenant.timezone` (padrão Intl de
   [open-now.util.ts](../../../apps/api/src/modules/tenants/open-now.util.ts)); slots de
   **30 min** de `openMinute` até `closeMinute - durationMin` (a reserva tem de CABER
   antes do fecho). Sem faixa nesse weekday → sem slots.
3. Filtra: slot ≥ agora + `reservationMinNoticeMin`; data ≤ hoje + `reservationMaxAdvanceDays`.
4. Para cada slot restante corre a **atribuição** (4.2) contra as reservas CONFIRMED que
   se sobrepõem; devolve só os slots com solução: `{ slots: ["12:00","12:30",…] }` (hora
   local do tenant).
5. Conversão local→UTC por util novo `localDateTimeToUtc(date, minutes, tz)` (Intl,
   mesma técnica do open-now; documentar comportamento em DST: usa o offset do próprio
   dia/hora — horas inexistentes na mudança de hora resolvem para o offset seguinte).

### 4.2 Atribuição de mesa(s) para (janela, partySize)

Mesas candidatas = `active: true` do tenant, MENOS as ocupadas
(`ReservationTable` de reservas `CONFIRMED` com `startsAt < end AND endsAt > start`).

1. **Mesa única (best fit):** menor `seats >= partySize`; empate → menor `sortOrder`.
2. **Par juntável:** se nenhuma única serve — pares de mesas com `joinable: true` e a
   **mesma `area` não-nula**, `seats1+seats2 >= partySize`; escolhe o par com menor
   desperdício (`soma - partySize`), empate → menor soma. Máximo 2 mesas.
3. Sem solução → slot indisponível (no POST: 409 com `alternatives` = até 4 slots
   válidos mais próximos no mesmo dia).

### 4.3 Criação transacional (anti-corrida)

`POST /public/stores/:slug/reservations` recalcula a atribuição DENTRO de uma
`prisma.$transaction` com `isolationLevel: 'Serializable'`; em erro de serialização
(P2034) faz retry (até 3×); se a mesa desapareceu entre o slot mostrado e o submit →
409 `'Esse horário acabou de ficar ocupado.'` + `alternatives`. A reserva manual do
painel usa o mesmo caminho (com mesa forçada opcional — valida sobreposição na mesma).

## 5. Endpoints

### Públicos (storefront/widget) — gating §6, throttle dedicado 30/min no POST

- `GET /public/stores/:slug/reservation-slots?date&party` → `{ slots: string[] }`
- `POST /public/stores/:slug/reservations`
  `{ date, time, partySize, customerName, customerPhone, customerEmail, notes?, marketingConsent? }`
  → `{ code, startsAt, endsAt, partySize, tableNames: string[] }`; envia emails; emite socket.
  Devolve também `cancelUrl` (só no email — ver §7 privacidade).
- `GET /public/reservations/:code?token=` → estado (página do cliente); token obrigatório.
- `POST /public/reservations/:code/cancel { token }` → cancela (se `startsAt` no futuro);
  emails + socket. Erros neutros `'Reserva não encontrada.'` (não revelar códigos válidos).

### Painel (OWNER/STAFF por método; KITCHEN fica FORA de tudo isto)

- `GET /tables` · `POST /tables` · `PATCH /tables/:id` · `DELETE /tables/:id` (409 se tem reservas)
- `GET /reservations?date=YYYY-MM-DD` (dia, ordenado por startsAt, inclui mesas)
- `POST /reservations` (manual: mesmos campos + `tableIds?: string[]` p/ forçar mesa;
  sem email de cliente obrigatório; `source: MANUAL`)
- `PATCH /reservations/:id/status { status: COMPLETED | NO_SHOW | CANCELLED }`
  (só a partir de CONFIRMED; cancelar → email ao cliente se tiver email)
- Config: campos novos aceites no `PATCH /tenants/me` existente (OWNER).

### Tempo real e emails

- `OrdersGateway` ganha `emitReservationCreated/Updated(tenantId, r)` → eventos
  `reservation.created` / `reservation.updated` na sala do tenant (mesma sala).
- `MailService`: `sendReservationConfirmed` (cliente, c/ código + link cancelar),
  `sendReservationCancelled` (cliente), `sendNewReservationAlert` (restaurante →
  `tenant.email`), `sendReservationCancelledAlert` (restaurante). Templates na linguagem
  dos existentes (PT-PT, zero emojis).

## 6. Gating público (igual às encomendas + interruptor)

Slots e criação exigem: `tenant.status === 'ACTIVE'` **e** `isSubscriptionUsable(account)`
**e** `reservationsEnabled === true`. Caso contrário 404 (não revelar). A UI pública só
mostra o separador "Reservar" quando o payload público do tenant disser
`reservationsEnabled: true` (acrescentar ao `getPublicBySlug`).

## 7. Segurança e privacidade

- Cancelamento por **token opaco** (random 32 bytes hex) enviado só no email; guarda-se
  o **hash argon2**. `GET /public/reservations/:code` exige o token (o código sozinho não
  expõe dados pessoais). Erros neutros.
- PII (nome/telefone/email) só visível no painel do tenant dono; multi-tenant isolado por
  `tenantId` em todas as queries (padrão do repo).
- `POST` público com throttle dedicado (30/min por IP) — anti-spam de reservas falsas.
  v2: confirmação de email/telefone para reservas online.
- KITCHEN sem acesso a nada de reservas (front-of-house, não cozinha).

## 8. Painel — aba "Reservas" (Fase R2)

- Nav nova "Reservas" (ícone CalendarCheck) entre Receção e Menu; OWNER/STAFF.
- **Vista do dia** (default hoje, date-picker): lista cronológica — hora, nome, pax,
  mesa(s), telefone, notas, estado (chips editorial); totais no topo (reservas + pax).
  Tempo real via socket + alarme de nova reserva (reutiliza padrão da Receção).
- Ações por reserva: **Concluída** / **Não apareceu** / **Cancelar** (confirmação).
- **Reserva manual**: modal — pessoas, data, hora (mostra só slots válidos), nome,
  telefone, email opcional, mesa automática ou escolhida.
- **Mesas**: secção na própria aba — CRUD (nome, lugares, área, juntável, ativa,
  ordem) + config das reservas (interruptor, duração, antecedências, máx. pax).
  Estado vazio: "Cria as tuas mesas para começar a aceitar reservas."

## 9. Loja pública (Fase R3)

- Separador "Reservar" na página da loja (só se `reservationsEnabled`) →
  `/[slug]/reservar`: pessoas → dia → slots (buscados ao servidor) → dados → confirmação
  com código. Página `/[slug]/reserva/[code]?token=` para consultar/cancelar.
- Widget `embed.js`: o popup ganha acesso à loja completa (a página de reservar já lá
  fica acessível); botão configurável `data-reservas="1"` para abrir direto em /reservar.
- Linguagem visual da loja (brand colors, editorial, PT-PT).

## 10. Testes

- **Unit (função pura):** a atribuição (4.2) extraída para util puro
  `assignTables(tables, occupiedIds, partySize)` — testes: única best-fit, empates,
  par juntável só mesma área, desperdício mínimo, sem solução, mesas inativas fora.
- **Slots (função pura):** geração de slots com horários/duração/antecedências — testes
  de fronteira (fecho, min notice, max advance, dia fechado; DST documentado).
- **E2e (script, padrão do repo):** criar mesas → slots → reservar → slot desaparece →
  reserva concorrente no mesmo slot → uma ganha, outra 409 → cancelar por token → slot
  volta → manual com mesa forçada → sobreposição recusada → matriz de permissões
  (KITCHEN 403 em tudo; STAFF ok em reservas; delete mesa com reservas → 409) → gating
  (reservationsEnabled off → 404).
- **R2/R3:** verificação integrada no browser (padrão da Fase 2 da cozinha).

## 11. Fases

- **R1 — Backend completo** (modelos, migração, utils puros testados, endpoints, emails,
  socket, e2e). Deploy "às escuras" possível.
- **R2 — Painel** (aba Reservas + mesas + config + manual + tempo real).
- **R3 — Loja pública + widget** (fluxo do cliente + página de cancelamento).

## 12. Fora de âmbito (v2)

Juntar 3+ mesas · janelas de reserva próprias (≠ horário de abertura) · bloqueios de
mesa/dias especiais e feriados · depósitos e taxas de no-show · lembretes ao cliente no
dia · confirmação de telefone/email · lista de espera · plano de sala visual (mapa) ·
reservas recorrentes.
