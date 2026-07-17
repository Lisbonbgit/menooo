# Reservas R4 — Mapa de sala, serviços com nome e timeline de lotação

**Data:** 2026-07-17
**Ramo:** `matheus-reservas-fase4` (a partir de `matheus-reservas-fase3`, que ainda não foi merged)
**Estado:** design aprovado pelo utilizador; falta revisão adversarial + revisão final do utilizador

> A R1 (backend), a R2 (painel) e a R3 (loja pública) deram ao dono uma **lista** de reservas.
> A R4 dá-lhe a **sala**: onde as mesas estão, como está a casa a cada hora, e que serviços
> existem. É o pedido original — «que a aba de reservar se pareça mais com o TheFork».

## 1. Objetivo

A aba Reservas ganha uma vista **Mapa** ao lado da **Lista** que já existe. As duas partilham
o dia e a hora selecionados: trocar de vista nunca perde o contexto.

O mapa não é decoração. É a vista de trabalho: **a sala, àquela hora**.

## 2. Decisões (aprovadas pelo utilizador)

| Tema | Decisão |
|---|---|
| Para que serve o mapa | **Ver o serviço em cima dele** — arrastas a sala uma vez, depois é a vista de trabalho com cursor de tempo |
| Geometria | **Grelha com encaixe** (não tela livre com zoom/pan) |
| Áreas | **Um mapa por área, com separadores** — encaixa no `Table.area`, que já governa o juntar mesas |
| Lotação | **A timeline É o cursor de tempo** — uma faixa só, não um gráfico + um seletor |
| Serviços | **Entidade com nome + dias** («Almoço, seg-sex, 12:00–14:30»), não um nome por janela |
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
mesa mais apertada, cai na grande só se não houver outra». Um `minSeats` a funcionar como
preferência não mudaria **uma única atribuição**: seria coluna, migração, UI e testes para zero
diferença de comportamento.

Só duas variantes ganhariam o seu sustento, e ambas foram recusadas: o **mínimo duro** (recusa a
reserva para guardar a mesa grande — perde reservas em noites vazias) e o **máximo com cadeira
extra** (uma mesa de 4 que serve 5 — o `seats` é um número ónico e não o exprime). Se um dia o
sistema estiver mesmo a queimar mesas grandes, volta-se a isto **com um caso real à frente**.

## 4. Schema (aditivo, exceto a substituição das janelas)

### 4.1 `Table` — posição no mapa

```prisma
  x     Int?    // coluna na grelha; null = ainda não colocada (auto-layout coloca)
  y     Int?    // linha na grelha
  shape String  @default("square") // 'square' | 'round' — só leitura visual
```

Não mexer em `seats`, `area`, `joinable`, `bookableOnline`, `sortOrder`. O `sortOrder` continua
a ser o desempate do `assignTables` **e** a ordem do auto-layout.

**Todas as mesas ocupam uma célula**, seja a M2 ou a M8. Tentador fazer o tamanho refletir os
lugares, mas isso traz colisões e reflow a cada edição — e o que se precisa de ler no mapa é
«qual mesa é aquela», não a escala. O nº de lugares vai na etiqueta.

### 4.2 `ReservationService` — substitui `ReservationWindow`

```prisma
model ReservationService {
  id          String @id @default(cuid())
  tenantId    String
  tenant      Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name        String // "Almoço", "Jantar" — livre, é o dono que decide
  weekdays    Int[]  // 0=domingo … 6=sábado (mesma convenção do OpeningHour)
  openMinute  Int
  closeMinute Int    // o último slot COMEÇA aqui (janela de seating, não de estadia)
  sortOrder   Int    @default(0)
  @@index([tenantId])
}
```

**Migração** (`reservation_services`): cria a tabela, agrupa as `ReservationWindow` existentes
por `(openMinute, closeMinute)` dentro de cada tenant, e cria um serviço por grupo com os
`weekdays` desse grupo. Nome derivado: `openMinute < 17*60 ? 'Almoço' : 'Jantar'`; se dois
grupos colidirem no nome, sufixo ` 2`. Só depois dropa a `ReservationWindow`.

> Em produção há poucas janelas (as reservas ainda não estão públicas e o `reservationsEnabled`
> é `false` por omissão), mas a migração **não pode assumir isso**: tem de ser determinística e
> correr com 0, 1 ou N janelas. `pg_dump` antes do deploy, como sempre.

**O raio de explosão fica contido de propósito:** `windowsFor(tenant, weekday)` passa a
`servicesFor(tenant, weekday)` e devolve **exatamente a mesma forma** —
`{ openMinute, closeMinute }[]`. O `slotMinutes`, o `slotsForDayTx`, o `publicDays`, o
`localDateTimeToUtc` e os testes de DST **não são tocados**. A mudança vive no painel e na
camada que lê as janelas.

Ficheiros afetados (levantados, não estimados): `reservations.service.ts`, `dto/panel.dto.ts`,
`dashboard/lib/reservations-hooks.ts`, `reservation-types.ts`, `ReservationSettings.tsx`,
`ReadinessCard.tsx` (que mostra as horas efetivas com proveniência — passa a dizer o nome do
serviço).

### 4.3 `Tenant` — tolerância

```prisma
  reservationGraceMin Int @default(15)
```

## 5. O mapa

**Grelha com encaixe.** Cada área é uma grelha de 12 colunas; as linhas crescem conforme
preciso. Arrastar move a mesa de célula; largar em cima de outra **troca as duas** (é o gesto
que se espera, e evita o estado «duas mesas na mesma célula»).

**Nunca vazio.** As mesas sem `x`/`y` são colocadas automaticamente em grelha por `sortOrder`,
no cliente, e só ficam gravadas quando o dono arrasta a primeira. Um mapa vazio no primeiro
gesto seria a pior forma de conhecer a funcionalidade.

**Gravar:** `PUT /tables/layout` com `{ area, positions: [{ id, x, y }] }` — em bloco e numa
transação, porque uma troca são **duas** mesas a mudar e um estado intermédio inválido seria
visível. Um `PATCH` por mesa não daria atomicidade à troca.

**Estado de cada mesa à hora do cursor:**

| Estado | Aspeto |
|---|---|
| Livre | contorno, nome + lugares |
| Reservada | cor da loja, primeiro nome do cliente + nº de pessoas |
| Juntas | as duas mesas da mesma reserva, ligadas visualmente |

CANCELLED / COMPLETED / NO_SHOW **não ocupam** — o slot volta, como já acontece hoje.

**Tocar numa mesa livre** abre o modal de reserva manual **já preenchido** com aquela mesa e
aquela hora (a R2 já suporta mesa forçada). É o que transforma o mapa em ferramenta em vez de
poster. Tocar numa mesa reservada abre a reserva.

**Só o dono vê o mapa.** O cliente nunca; nada disto entra no contrato público. *(Decisão
original do utilizador: «o cliente não precisa de saber isso».)*

## 6. A timeline-cursor

Faixa horizontal por cima do mapa, com os slots do serviço selecionado:

- **Altura da barra** = % de mesas ocupadas naquele slot (na área visível).
- **Número** = pessoas sentadas naquele slot.
- **Tocar/arrastar** move o cursor de tempo; o mapa por baixo salta para aquela hora.
- **Por omissão** aponta para *agora*, se for hoje e dentro do serviço; senão, para o início do
  serviço.

Responde a duas perguntas com um só controlo: «quando é que a noite aperta?» e «e nessa hora,
como está a sala?». Um gráfico à parte mais um seletor de hora seriam dois sítios a dizer o
mesmo.

**Cálculo no cliente:** as reservas do dia já vêm todas (a R2 carrega-as e o socket mantém-nas
vivas). A ocupação por slot é derivada em memória — zero endpoints novos, e a timeline mexe-se
ao vivo quando entra uma reserva.

## 7. Serviços — CRUD e navegação

Nas Definições de reservas: criar/editar/apagar serviço (nome, chips dos dias, abre, fecha).

**Validação:** dois serviços do mesmo tenant que partilhem um weekday **não podem sobrepor-se**
no tempo — senão os slots duplicavam e a grelha de horas mentia. 400 com mensagem clara.
Mantém-se a regra de o `closeMinute` não passar das 23:00 (já existe).

**Navegação:** na aba Reservas, chips com os serviços do dia selecionado («Almoço | Jantar»),
derivados dos serviços — não escritos à mão. Se o dia só tem um serviço, não há chips (não se
navega para lado nenhum).

## 8. Tolerância de atraso

`reservationGraceMin` (default 15) **só comunica**:
- Ecrã de confirmação e email: «A tua mesa fica guardada 15 minutos.» — substitui o texto fixo
  que a R3 pôs.
- Painel: mostrado na reserva.

**Não marca falta sozinho.** Um automatismo aqui libertaria a mesa de quem está a estacionar, e
o NO_SHOW é um juízo do dono — que já tem o botão. Também **não afeta a atribuição**: a reserva
já bloqueia a mesa por `reservationDurationMin`; a tolerância é expectativa, não capacidade.

## 9. Testes

- **Unit:** `services.util` (`servicesFor` ≡ o antigo `windowsFor` para os mesmos dados);
  auto-layout (N mesas → N células distintas, ordem = `sortOrder`); troca de posições
  (swap é simétrico e não perde mesas); ocupação por slot (uma reserva de 20:00–22:00 conta
  nos slots 20:00, 20:30, 21:00, 21:30 e não no das 19:30).
- **Migração:** teste que corre o backfill sobre janelas de exemplo e prova que os serviços
  resultantes geram **os mesmos slots** que as janelas geravam. É o único teste que interessa
  aqui: a migração não pode mudar a disponibilidade de ninguém.
- **E2e:** CRUD de serviços; sobreposição no mesmo weekday → 400; `PUT /tables/layout` grava e
  a troca é atómica; layout de outro tenant → 404 (tenancy).
- **Browser (obrigatório, não delegável):** arrastar uma mesa e ver a posição sobreviver ao F5;
  scrub da timeline a mover o mapa; mesa livre → modal pré-preenchido; separadores de área.
- **Regressões:** e2e-reservas (124), e2e-kitchen (42), unit (78), e a loja pública intacta.

## 10. Fora de âmbito

**Nesta fase:** arrastar reservas entre mesas · paredes e objetos · rotação · zoom/pan ·
tamanho da mesa proporcional aos lugares · mín/máx por mesa (§3).
**Trabalho à parte:** horário repartido do Roma — **a R4 resolve-o de facto** (dois serviços
com nome fazem exatamente isso), mas o `OpeningHour` continua com `@@unique([tenantId, weekday])`
e o `computeOpenNow` da montra continua a achar que o restaurante está aberto às 17:00. Isso é
das **encomendas**, não das reservas, e fica para o seu próprio ciclo.
**v2:** lista de espera · walk-ins no mapa · estados de mesa em tempo real (sentados/a pagar).
