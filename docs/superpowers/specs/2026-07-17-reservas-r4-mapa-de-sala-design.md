# Reservas R4 — Mapa de sala, serviços com nome e timeline de lotação

**Data:** 2026-07-17
**Ramo:** `matheus-reservas-fase4` (a partir de `matheus-reservas-fase3`, que ainda não foi merged)
**Estado:** design aprovado + revisão adversarial incorporada; falta revisão final do utilizador

> A R1 (backend), a R2 (painel) e a R3 (loja pública) deram ao dono uma **lista** de reservas.
> A R4 dá-lhe a **sala**: onde as mesas estão, como está a casa a cada hora, e que serviços
> existem. É o pedido original — «que a aba de reservar se pareça mais com o TheFork».

## 1. Objetivo

A aba Reservas ganha uma vista **Mapa** ao lado da **Lista** que já existe. As duas partilham o
dia e a hora selecionados: trocar de vista nunca perde o contexto.

O mapa não é decoração. É a vista de trabalho: **a sala, àquela hora**.

## 2. Decisões (aprovadas pelo utilizador)

| Tema | Decisão |
|---|---|
| Para que serve o mapa | **Ver o serviço em cima dele** — arrastas a sala uma vez, depois é a vista de trabalho com cursor de tempo |
| Geometria | **Grelha com encaixe** (não tela livre com zoom/pan) |
| Áreas | **Um mapa por área, com separadores** — encaixa no `Table.area`, que já governa o juntar mesas |
| Lotação | **A timeline É o cursor de tempo** — uma faixa só, não um gráfico + um seletor |
| Serviços | **Entidade com nome + dias**, não um nome por janela |
| Mín/máx por mesa | **CORTADO** — ver §3 |
| Arrastar reservas entre mesas | **Fora de âmbito** (o utilizador escolheu a opção sem isto) |

## 3. O que foi cortado, e porquê (não voltar a propor sem caso novo)

O R4 trazia «capacidade mín-máx por mesa». O utilizador escolheu que o mínimo fosse uma
**preferência** (a mesa grande é evitada, mas serve se for a única). **Isso já existe.**

Provado contra o `assign.util.ts` compilado, com M2(2)/M4(4)/M8(8) e **zero** `minSeats`:

| Situação | Mesa atribuída |
|---|---|
| Casal, tudo livre | **M2** — a mais justa |
| Casal, M2 ocupada | **M4** — a seguinte |
| Casal, M2 e M4 ocupadas | **M8** — último recurso |

O `assignTables` faz `filter(seats >= party).sort(seats asc)` — que é, literalmente, «prefere a
mesa mais apertada, cai na grande só se não houver outra». Um `minSeats`-preferência não mudaria
uma única atribuição.

*(A revisão perguntou se a prova cobre mesas JUNTAS e o canal MANUAL: cobre o que interessa —
o par juntável é escolhido por menor desperdício (`waste = sum − partySize`), que é a mesma
preferência; e o MANUAL só alarga o conjunto (ignora `bookableOnline`), não muda a ordenação.)*

## 4. Schema

> ⚠️ **A forma do deploy transforma um erro de migração numa queda da PLATAFORMA.** Verificado:
> `apps/api/docker-entrypoint.sh` corre `prisma migrate deploy` com `set -e` a **cada arranque** e
> só faz `exec "$@"` se passar; o `docker-compose.prod.yml` dá `restart: unless-stopped` à api; e
> **não existe um único `down.sql`** no repo (o Prisma não os gera). Uma migração que rebente põe
> a API em crash-loop — levando **as encomendas** atrás, não só as reservas — e o Prisma marca-a
> como falhada, recusando os `migrate deploy` seguintes até alguém entrar por SSH.
>
> Isto é um risco da plataforma, não da R4; a R4 é só a primeira a pisá-lo. **Fora de âmbito, mas
> recomendado ao utilizador:** separar o `migrate` do arranque da API, para uma migração falhada
> ser um incidente de reservas e não uma queda do negócio todo.

### 4.1 `Table` — posição no mapa

```prisma
  x     Int?    // coluna (0..7); null = ainda não colocada
  y     Int?    // linha
  shape String  @default("square") // 'square' | 'round' — só leitura visual
```

Não mexer em `seats`, `area`, `joinable`, `bookableOnline`, `sortOrder`.

**Todas as mesas ocupam uma célula**, seja a M2 ou a M8: tamanho proporcional aos lugares traria
colisões e reflow a cada edição, e o que se lê num mapa é «qual mesa é aquela», não a escala.

**Mudar de área limpa a posição.** O `updateTable` faz `updateMany({ data: dto })` e o
`UpdateTableDto` aceita `area` — sem isto, mover a M4 de «Sala» para «Esplanada» leva o `x,y`
consigo e aterra em cima de uma mesa que já lá está, sem ninguém ter arrastado nada. Quando `area`
muda, `x = null, y = null` (a posição noutra sala não quer dizer nada).

### 4.2 `ReservationService` — em EXPAND, não em substituição

```prisma
model ReservationService {
  id          String @id @default(cuid())
  tenantId    String
  tenant      Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name        String // "Almoço", "Jantar" — livre, é o dono que decide
  weekdays    Int[]  // 0=domingo … 6=sábado (convenção do OpeningHour)
  openMinute  Int
  closeMinute Int    // o último slot COMEÇA aqui (janela de seating, não de estadia)
  sortOrder   Int    @default(0)
  @@index([tenantId])
}
```

**A `ReservationWindow` NÃO é dropada nesta fase.** Migração A (R4): cria a `ReservationService`,
faz o backfill, e o código deixa de a ler. Migração B (ciclo posterior, depois de a R4 estar
provada em produção): dropa a `ReservationWindow`. Isto dá **rollback por imagem** sem restauro de
dump — a R3, se voltar, ainda encontra a tabela que lê em `reservations.service.ts` — e transforma
um erro de backfill num bug de reservas em vez de uma queda da plataforma.

**Backfill — os três detalhes que o fazem passar em dev e rebentar em produção:**

1. **O `id` não tem default na base de dados.** O `@default(cuid())` é gerado pelo **cliente
   Prisma**, não pelo Postgres: todos os `CREATE TABLE` do repo emitem `"id" TEXT NOT NULL` sem
   `DEFAULT` (ex.: `20260716085451_reservations/migration.sql`), e não há `pgcrypto` em lado
   nenhum. Um `INSERT ... SELECT` sem id explícito viola o `NOT NULL`. O único backfill do repo
   que insere linhas já contorna isto à mão (`'pmg_' || g."id"` em `20260712120000_shared_modifier_groups`).
   → gerar determinístico e re-executável: `'rs_' || md5("tenantId" || '_' || "openMinute" || '_' || "closeMinute")`.
2. **Passa em dev sem tocar no problema.** O `reservationsEnabled` é `false` por omissão, logo uma
   DB de dev fresca tem **zero** janelas: o INSERT insere 0 linhas e nada rebenta. O teste do §9
   **tem de** correr sobre ≥1 janela e ≥2 tenants. *(É a mesma armadilha do «0 linhas não prova
   nada» que já mordeu nesta sessão.)*
3. **`sortOrder` tem de ser preenchido.** `@default(0)` em todos deixa a ordem dos serviços ao
   critério do Postgres — os chips do §7 tanto saem «Almoço | Jantar» como o contrário, e mudam
   sozinhos depois de uma edição. → `row_number() over (partition by "tenantId" order by "openMinute")`.

**Reconciliar antes de agrupar.** Hoje o `setWindows` só valida `close > open` e o teto de 2/dia
— **não** verifica sobreposição — logo `seg 12:00–15:00` + `seg 14:00–18:00` é um estado legal e
alcançável pela UI de hoje (e os slots saem certos, porque o `slotMinutes` acumula num `Set`). Um
agrupamento ingénuo por `(open, close)` transformá-las-ia em dois serviços sobrepostos no mesmo
weekday — que é exatamente o que a validação nova do §7 passa a recusar com 400. O dono ficava sem
poder gravar **nada** nas Definições, nem sequer um nome. → o backfill **funde as janelas
sobrepostas do mesmo weekday na sua união** antes de agrupar. O `Set` do `slotMinutes` garante que
a união gera os mesmos slots: a disponibilidade não muda, que é a promessa do §9.

**Nome derivado:** `openMinute < 17*60 ? 'Almoço' : 'Jantar'`, sufixado com a hora em **qualquer**
colisão — «Almoço 10:00», «Almoço 12:00». O teto real é de 2 janelas × 7 weekdays = até 14 grupos,
todos podendo cair do mesmo lado das 17:00; um sufixo « 2» só resolve a primeira colisão, e não há
`@@unique` no `name` que impeça dois serviços com o mesmo nome — os chips do §7 ficariam
indistinguíveis. A hora é auto-explicativa no dia em que o dono abre as Definições.

**O raio fica contido de propósito:** `windowsFor(tenant, weekday)` passa a `servicesFor(tenant,
weekday)` e devolve **a mesma forma** — `{ openMinute, closeMinute }[]`. O `slotMinutes`, o
`slotsForDayTx`, o `publicDays` e os testes de DST não são tocados.

### 4.3 `Tenant` — tolerância

```prisma
  reservationGraceMin Int @default(15)
```

## 5. O fallback do horário de abertura — a peça que o desenho anterior ignorava

**A maioria dos tenants não tem janelas nenhumas.** O `windowsFor` cai no `OpeningHour − 60`
quando o weekday não tem janelas, e a R3 §11 já registava que as janelas «ficaram opcionais e
vazias por omissão». Duas consequências que o primeiro desenho não via:

1. **A migração cria zero serviços para eles.** A timeline e os chips «derivados dos serviços»
   não teriam nada para mostrar — a funcionalidade nasceria vazia para quase toda a gente.
2. **Apagar o último serviço de um dia não fecha o dia: ABRE-O.** Sem serviços, o fallback devolve
   `12:00–22:00` em vez de `12:00–14:30` — incluindo as 17:00 com a cozinha fechada, que é o
   próprio problema que os serviços existem para resolver. «Apagar o Almoço» faria o oposto do que
   o dono quer, em silêncio.

**Decisão:** o fallback **mantém-se** (mudá-lo alteraria a disponibilidade de quem já usa isto — e
a promessa desta migração é não mudar a disponibilidade de ninguém), mas deixa de ser invisível:

- **Serviço sintético.** Quando um dia corre pelo fallback, o painel mostra-o como um serviço de
  leitura, chamado **«Horário de abertura»**, com a proveniência à vista: *«Sáb 12:00–22:00 — vem
  do teu horário de abertura, não de um serviço»* + CTA «Criar serviços». O `ReadinessCard` da R3
  já diz isto; agora a timeline e o mapa funcionam por cima dele, e ninguém fica com um ecrã vazio.
- **Apagar avisa com a consequência real.** Ao apagar o último serviço de um weekday: *«Sem
  serviços à segunda, as reservas passam a seguir o teu horário de abertura: 12:00–22:00, incluindo
  as 17:00. Queres antes bloquear o dia?»* — com atalho para o bloqueio de dia, que já existe.

## 6. O mapa

**Geometria — a conta que decide tudo.** O `<main>` do `AppShell` tem `px-4` e nenhum wrapper de
largura máxima: a 375px sobram **343px**. Doze colunas dariam células de **23px**, metade do mínimo
tátil (44px HIG / 48dp Material), com o nome da mesa, os lugares e o nome do cliente lá dentro.

→ **Grelha fixa de 8 colunas × células de 56px** (canvas ≈ 504px), com **scroll horizontal dentro
do próprio cartão do mapa** em ecrãs estreitos. Não é zoom nem pan — é uma barra de scroll, e o
`x` continua a querer dizer a mesma coisa em todos os ecrãs. Um número de colunas que mudasse com
o ecrã tornaria o `x` gravado ambíguo: a mesma mesa em sítios diferentes conforme o telemóvel.

**Nunca vazio.** As mesas sem `x`/`y` são colocadas por auto-layout (em grelha, por `sortOrder`).
O estado misto — umas com posição, outras sem — é o **normal**, não a exceção: qualquer mesa criada
depois de o mapa estar arrumado nasce com `x=null`. O auto-layout coloca as órfãs nas **primeiras
células livres**, nunca por cima de uma mesa já posicionada.

**Gravar: o PUT leva a área INTEIRA.** `PUT /tables/layout` com
`{ area, positions: [{ id, x, y }] }` para **todas** as mesas daquela área — não só as que se
mexeram. Se levasse só as duas da troca, o auto-layout das restantes nunca ficaria gravado e o
mapa recalcular-se-ia a cada abertura; e dois dispositivos veriam salas diferentes até alguém
arrastar. Uma transação: uma troca são duas mesas a mudar, e o estado intermédio seria visível.

**Papel e tenancy explícitos:** `@Roles(UserRole.OWNER, UserRole.STAFF)`. O `RolesGuard` **falha
ABERTO** (`if (!required || required.length === 0) return true`), logo esquecer o decorador dá
acesso a qualquer utilizador autenticado — **incluindo o tablet da cozinha**. Tenancy pelo
`@TenantId()`, com 404 para mesas de outro tenant.

**Estado de cada mesa à hora do cursor T:**

| Estado | Significado | Aspeto |
|---|---|---|
| **Livre** | livre em T **e** reservável para uma estadia inteira | contorno; toque abre o modal |
| **Livre até HH:MM** | livre em T, mas a próxima reserva não deixa caber a estadia | contorno esbatido + hora; toque explica |
| **Reservada** | ocupada em T | cor da loja, primeiro nome + nº de pessoas |
| **Juntas** | as duas mesas da mesma reserva | ligadas visualmente |
| **Inativa** | `active: false` | tracejado, fora da timeline |

> **Porquê o «Livre até».** O primeiro desenho dizia só «Livre / Reservada», e mentia. «Livre» no
> mapa era ocupação **no instante** T; o servidor decide por **intervalo** `[T, T+duração+buffer)`.
> Com os defaults (`duração=120`, slots de 30) divergem em 4 slots: a M4 com reserva às 20:00 está
> mesmo livre às 18:30, o mapa mostrava-a livre, o dono tocava — e o backend recusava, porque
> 18:30+120 = 20:30 atropela as 20:00. O mapa oferecia uma reserva impossível.
> O cliente passa a derivar o estado com a **mesma regra do servidor** (`occupiedAt(busy, T,
> T+durMs, bufMs)`, a config já vem no `useTenantConfig`). Bónus: isto entrega o follow-up «livre
> até HH:MM» que a R2 tinha deixado por fazer.

**Mesas inativas.** O `listTables` devolve **todas** as mesas, ativas ou não (de propósito: é o
TablesManager que as mostra esbatidas). Sem um estado próprio, uma mesa desativada apareceria
«Livre» no mapa e **falsearia o denominador da timeline**.

**Tocar numa mesa livre** abre o modal de reserva manual pré-preenchido com aquela mesa e aquela
hora. **Isto exige mudar o contrato do modal:** o `ReservationFormModal` aceita hoje só
`{ mode, reservation, onClose }` e, em `mode:'create'`, fixa `date = todayISO()`,
`time = nowHHMM()`, `tableIds = []`. Passa a aceitar `initial?: { date, time, tableIds }`. *(O §5
do primeiro desenho dizia «a R2 já suporta mesa forçada» — verdade sobre a UI interna do
formulário, falso sobre a integração.)*

**Só o dono vê o mapa.** `x`, `y` e `shape` **não** entram no contrato público: o `getPublicBySlug`
não devolve mesas, e o `publicByCode`/`publicView` só expõem `tableNames` (que a R3 já decidiu não
renderizar). *(Decisão original: «o cliente não precisa de saber isso».)*

## 7. A timeline-cursor

Faixa horizontal por cima do mapa, com os slots do serviço selecionado:

- **Altura da barra** = % de mesas **ativas** ocupadas naquele slot, na área visível.
- **Número** = pessoas sentadas naquele slot.
- **Tocar/arrastar** move o cursor; o mapa por baixo salta para aquela hora.
- **Por omissão** aponta para *agora*, se for hoje e dentro do serviço; senão, para o início.

Um serviço de 12:00–14:30 tem 6 slots; um de 19:00–22:00 tem 7. Cabem em 343px (≈49px cada) —
mas um serviço contínuo de 12:00–23:00 tem 23 slots, logo a faixa **scrolla horizontalmente** e o
slot do cursor é trazido à vista.

**Ocupação no cliente**, das reservas do dia que a R2 já carrega e o socket mantém vivas — zero
endpoints novos, e a timeline mexe-se ao vivo quando entra uma reserva. Contam as reservas que
**intersetam** o slot, não as que começam nele: uma reserva de 20:00–22:00 conta às 20:00, 20:30,
21:00 e 21:30. Uma reserva que começou às 18:00 e ainda lá está às 19:00 conta no slot das 19:00 —
o cálculo é por interseção de intervalos, não por hora de início.

## 8. Serviços — CRUD e navegação

Nas Definições de reservas: criar/editar/apagar (nome, chips dos dias, abre, fecha).

**Validação:** dois serviços que partilhem um weekday não podem sobrepor-se no tempo → 400 com
mensagem clara. Mantém-se o teto das 23:00. *(A validação é nova; o backfill do §4.2 tem de
produzir um estado que a passe — ver «Reconciliar antes de agrupar».)*

**Navegação:** chips com os serviços do dia selecionado, derivados dos serviços — ou o serviço
sintético «Horário de abertura» do §5. Se o dia só tem um, não há chips.

**Apagar** avisa com a consequência real (§5).

## 9. Tolerância de atraso

`reservationGraceMin` (default 15) **só comunica**:
- Confirmação e email: «A tua mesa fica guardada 15 minutos» — substitui o texto fixo da R3.
- Painel: mostrado na reserva.

**Não marca falta sozinho** (libertaria a mesa de quem está a estacionar; o NO_SHOW é juízo do
dono, que já tem o botão) e **não afeta a atribuição** (a mesa já está bloqueada por
`reservationDurationMin`; a tolerância é expectativa, não capacidade).

## 10. Testes

- **Unit:** `servicesFor` ≡ `windowsFor` para os mesmos dados, **incluindo o fallback**;
  auto-layout com estado misto (mesas posicionadas + órfãs → as órfãs vão para células livres,
  nunca por cima); troca simétrica e sem perder mesas; ocupação por slot **por interseção**
  (reserva 20:00–22:00 conta em 4 slots, não no de 19:30; reserva que atravessa o início do
  serviço conta); estado «Livre até» com `duração=120` e reserva às 20:00 → às 18:30 **não** é
  «Livre».
- **Migração (o teste que interessa):** correr o backfill sobre janelas de exemplo — **≥1 janela,
  ≥2 tenants, e um par sobreposto no mesmo weekday** — e provar que (a) os serviços resultantes
  geram **exatamente os mesmos slots** que as janelas geravam, e (b) o resultado **passa na
  validação nova** do §8. Um teste com 0 janelas passa sem tocar em nada.
- **E2e:** CRUD de serviços; sobreposição → 400; apagar o último serviço avisa; `PUT
  /tables/layout` grava a área inteira e a troca é atómica; layout de outro tenant → 404; **o
  tablet de cozinha (KITCHEN) não chega ao layout** (o RolesGuard falha aberto — este teste é o
  que prova o decorador).
- **Browser (obrigatório, não delegável):** arrastar uma mesa e a posição sobreviver ao F5; scrub
  da timeline a mover o mapa; mesa livre → modal pré-preenchido com a mesa e a hora certas; mesa
  «Livre até» → explica em vez de oferecer; separadores de área; mudar a área de uma mesa no
  TablesManager e ela não aterrar em cima de outra.
- **Regressões:** e2e-reservas (124), e2e-kitchen (42), unit (78), loja pública intacta.

## 11. Fora de âmbito

**Nesta fase:** arrastar reservas entre mesas · paredes e objetos · rotação · zoom/pan · tamanho
proporcional aos lugares · mín/máx (§3) · o DROP da `ReservationWindow` (§4.2, migração B).
**Recomendado ao utilizador, fora deste spec:** separar o `prisma migrate deploy` do arranque da
API (§4) — hoje uma migração falhada derruba o negócio todo, não só as reservas.
**Trabalho à parte:** o horário repartido do Roma fica resolvido **nas reservas** (dois serviços
com nome fazem exatamente isso), mas **não na montra**: o `OpeningHour` continua com
`@@unique([tenantId, weekday])` e o `computeOpenNow` continua a dizer que o restaurante está
aberto às 17:00. Isso é das **encomendas** e tem o seu próprio ciclo.
**v2:** lista de espera · walk-ins no mapa · estados em tempo real (sentados/a pagar).
