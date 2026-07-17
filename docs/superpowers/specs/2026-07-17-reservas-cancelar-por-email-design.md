# Reservas — consultar/cancelar por número + email

**Data:** 2026-07-17
**Ramo:** a criar, a partir do estado em produção (R4)
**Estado:** design aprovado pelo utilizador; falta revisão adversarial + revisão final

> A R3 deu ao cliente uma forma de gerir a reserva: o **link de gestão** (com token secreto no
> fragmento), que vai no email de confirmação. Mas quem perde esse email fica sem saída. Esta
> mudança dá um **segundo caminho** — pesquisar a reserva pelo número + email, na própria página
> de reservar — sem tocar no caminho do token, que continua a funcionar.

## 1. Objetivo

Na página pública de reservar (`/[slug]/reservar`), o cliente pode consultar e **cancelar** a
sua reserva escrevendo o **número da reserva** e o **email** que usou. Só isso — não edita, não
altera. O objetivo é fechar o "perdi o email de confirmação e não sei como cancelar".

## 2. Decisões (aprovadas)

| Tema | Decisão |
|---|---|
| Prova de identidade | **número da reserva + email** (o email tem de bater com o da reserva) |
| Onde | link no fim da `/[slug]/reservar` que expande o fluxo **na mesma página** |
| Âmbito | só **consultar + cancelar** (não editar) — YAGNI |
| Caminho do token (link do email) | **intocado** — continua exatamente como está |

## 3. A questão de segurança (o coração desta mudança)

Hoje o `code` **sozinho não chega**: `publicByCode`/`cancelByToken` exigem o token secreto
(`cancelTokenHash`), de propósito. O `code` tem 6 caracteres base32 — se bastasse para cancelar,
qualquer pessoa enumerava códigos e cancelava reservas alheias (negação de inventário contra o
restaurante). O email a ter de bater é o que substitui o token como prova.

Três defesas, todas reutilizando o que já existe:

1. **Só reservas ONLINE — as MANUAIS ficam de fora (invariante existente que o desenho ANTERIOR
   quebrava).** O sistema exclui **de propósito** as reservas manuais (feitas pelo restaurante ao
   telefone/balcão) do cancelamento público: o `verifyToken` devolve sempre 404 quando
   `cancelTokenHash` é null, com o comentário «MANUAL nunca acessível», e há um teste e2e dedicado
   a isso. Mas o `createManual` **também grava `contactEmailKey`** — logo casar só pela key deixava
   um terceiro (que soubesse código+email) cancelar a reserva VIP/depósito/evento que o restaurante
   gere à parte. **O acesso por email exige `cancelTokenHash != null`** (equivalente a `source ==
   'ONLINE'`), antes do match de email. Assim mantém-se o invariante: sem token = fora do
   self-service público, seja qual for o caminho.
2. **Email normalizado.** A comparação usa o `contactEmailKey` (o `emailKey()` da R3: `trim +
   lowercase`), que a reserva ONLINE já grava. Comparação por igualdade da key, nunca do valor cru.
   *(O `@IsEmail()` do DTO já rejeita emails malformados antes de chegar aqui; o `trim` do
   `emailKey` é defesa redundante, inofensiva.)*
3. **Código normalizado para MAIÚSCULAS.** Os códigos são gerados em maiúsculas e a coluna é
   `@unique` case-sensitive. No caminho do token o código vem do URL (exato); aqui o cliente
   escreve-o à mão, e no telemóvel sai muitas vezes em minúsculas. O lookup faz
   `code.trim().toUpperCase()` antes de procurar — senão o cliente legítimo nunca encontra a
   reserva.
4. **Resposta neutra — sem oráculo de enumeração.** Reserva inexistente, não-ONLINE, email que não
   bate, ou fora do TTL → **sempre** a mesma resposta: `404 "Reserva não encontrada."` O cliente
   nunca sabe se falhou o código ou o email — e é isso que impede o formulário de confirmar que um
   código existe.
5. **Throttle apertado por IP.** 5/min nos dois endpoints novos (o `@Throttle` que o POST público
   já usa). O `req.ip` é fiável desde a correção do `trust proxy` (lista `['loopback',
   'uniquelocal']`). O que **realmente** torna a enumeração inviável, porém, é a entropia: o código
   é 6 chars sobre um alfabeto de 32 (~1,07×10⁹ combinações), gerado por CSPRNG — a 5/min, mesmo com
   o email conhecido, o esforço esperado é astronómico. **Nota:** se um dia o código for encurtado,
   isto reabre a força-bruta; a segurança depende do comprimento do código, não do throttle.

Mais o **TTL** que já existe: reservas com `startsAt + 24h < agora` → 404 (o acesso não é eterno).

> **Oráculo de timing (aceite como risco baixo, não corrigido):** o `findUnique` por `code` é
> rápido para um código inexistente e mais lento para um que existe (carrega a linha). A latência
> distingue «este código existe» sem conhecer o email. Com 10⁹ códigos e 5/min, enumerar por timing
> é tão inviável quanto por conteúdo, por isso não se justifica a complexidade de igualar as
> queries. Registado para não se afirmar «neutro incluindo timing», que não é verdade.

## 4. Backend — dois endpoints novos

Ambos em `public-reservations.controller.ts`, `@Public()`, `@Throttle({ default: { limit: 5,
ttl: 60_000 } })`. A lógica vive no `reservations.service.ts`, espelhando o `publicByCode`/
`cancelByToken` mas trocando `verifyToken` por uma verificação de email.

### `POST /public/reservations/lookup` `{ code, email }`

A autorização por email é uma só, partilhada pelos dois métodos — `authorizeByEmail(code, email)`
— para não haver duas cópias que divirjam:

```ts
private async authorizeByEmail(code: string, email: string) {
  const key = emailKey(email);
  if (!key) throw new NotFoundException('Reserva não encontrada.');
  const row = await this.prisma.reservation.findUnique({
    where: { code: code.trim().toUpperCase() },  // o cliente escreve à mão; o código é maiúsculas
    include: { tables: { include: { table: true } }, tenant: true },
  });
  // Resposta NEUTRA para TODOS os casos — sem revelar se o código existe:
  //  - row null (código errado)
  //  - cancelTokenHash null (reserva MANUAL — nunca acessível ao público, igual ao caminho do token)
  //  - contactEmailKey !== key (email não bate)
  //  - fora do TTL (startsAt + 24h já passou)
  if (
    !row ||
    !row.cancelTokenHash ||               // ← o guard que fecha as reservas MANUAIS/legado
    row.contactEmailKey !== key ||
    row.startsAt.getTime() + 24 * 3_600_000 < Date.now()
  ) {
    throw new NotFoundException('Reserva não encontrada.');
  }
  return row;
}
```

### `POST /public/reservations/lookup` `{ code, email }`

```ts
async publicByEmail(code: string, email: string) {
  const row = await this.authorizeByEmail(code, email);
  return this.publicReservationView(row); // MESMO shape do publicByCode, tableNames incluído
}
```

> **Refactor mínimo:** o `publicByCode` monta o objeto de resposta inline. Extrair essa montagem
> para um `publicReservationView(row)` privado, chamado pelos dois caminhos. **A view MANTÉM o
> `tableNames`** — o `publicByCode` já o devolve hoje (o cliente é que decidiu não o renderizar, na
> R3); dropá-lo mudaria o contrato de um endpoint em produção. O `publicByEmail` devolve-o na mesma;
> é inofensivo (não é renderizado). Não muda o contrato do `publicByCode`.

### `POST /public/reservations/:code/cancel-by-email` `{ email }`

```ts
async cancelByEmail(code: string, email: string) {
  const row = await this.authorizeByEmail(code, email);
  return this.doCancel(row); // idêntico ao cancelByToken a partir da guarda de estado
}
```

> **Refactor mínimo:** o corpo do `cancelByToken` a partir da guarda de estado (o `if (status !==
> CONFIRMED …)` até ao `return { ok: true }`, incluindo a guarda atómica `updateMany(status:
> CONFIRMED)`, o `emitReservationUpdated` e o `afterCancel`) é extraído para `doCancel(row)`,
> chamado pelos dois. A autorização (token vs email) fica em cada método; a mecânica de cancelamento
> é uma só — garante que cancelar por email e por token são idênticos (mesmo «até endsAt», mesma
> emissão de socket e emails).

**DTOs** (`dto/public-reservation.dto.ts`): o `forbidNonWhitelisted: true` obriga a declará-los.

```ts
export class LookupReservationDto {
  @IsString() @IsNotEmpty() @MaxLength(20) code!: string;   // o código é curto (base32 6)
  @IsEmail() @MaxLength(200) email!: string;
}
export class CancelByEmailDto {
  @IsEmail() @MaxLength(200) email!: string;
}
```

## 5. Frontend — na página de reservar

Em `apps/storefront/src/app/[slug]/reservar/ReservarClient.tsx`, o bloco de consultar/cancelar
tem de renderizar **em todos os estados** da página.

> ⚠️ **Não pode ir «no fim» ingenuamente.** O `ReservarClient` tem returns antecipados —
> `placed` (reserva acabada de fazer), `store.isLoading`, `store.isError` e, sobretudo, `gated`
> (reservas desligadas / loja fora de horário). Cada um devolve o seu ecrã antes do return
> principal. Pôr o bloco só no return final fá-lo **desaparecer exatamente quando as reservas
> estão desligadas** — um dos momentos em que um cliente com reserva feita mais quer cancelar.
> → o bloco é um componente próprio (`ManageReservationBlock`, ficheiro à parte) renderizado
> **também no ramo `gated`** (por baixo da mensagem «reservas indisponíveis») e no fim do fluxo
> normal. Não depende do `store` estar ligado — só precisa do `slug`.

**Comportamento:**

- Um link/botão discreto: **"Já tens uma reserva? Consultar ou cancelar"**. Fechado por omissão
  (não distrai quem vem reservar).
- Ao abrir, um bloco com dois campos — **Número da reserva** e **Email** — e **"Procurar"**.
- Resultado:
  - **Encontrada:** cartão com estado (Confirmada/Cancelada/…), dia, hora, pessoas, e — se ainda
    for cancelável — o botão **"Cancelar reserva"** com o mesmo diálogo de confirmação da página
    de gestão ("A mesa fica livre para outra pessoa e não dá para desfazer").
  - **Não encontrada / erro:** a mensagem do servidor ("Reserva não encontrada."). Mesma
    mensagem para código errado, email errado ou reserva antiga — o cliente não distingue, e é
    isso que queremos.
  - **429:** nunca ecoar o `data.message` (vem em inglês do `ThrottlerException`) → "Demasiados
    pedidos. Espera um minuto e tenta de novo." (o padrão que a R3 já usa).
- Após cancelar: o cartão passa a "Cancelada" e o botão desaparece — igual à página de gestão.

**Reutilizar, não duplicar:** o cartão de estado + o diálogo de cancelamento já vivem no
`ReservaClient.tsx` (a página de gestão por token) e — verificado na revisão — dependem só de `r`,
`phone`, `canCancel`, `confirming` e da mutação de cancelamento; **todo o acoplamento a
token/sessionStorage está fora do cartão**. Extrair o cartão para um componente partilhado (ex.
`ReservationCard`) que ambos usam. A única diferença é a montagem do POST (token vs `{email}`).

**429 e mensagens:** o `serverMessage()` do `ReservarClient` devolve o `data.message` cru; só um
`if (status === 429)` inline no `send()` protege do inglês do `ThrottlerException`. O bloco novo
tem de repetir essa guarda — senão o cliente vê «Too Many Requests». As outras mensagens (404, 400
de email malformado) vêm do servidor.

**Nada de token aqui.** Este fluxo não lê nem escreve o fragmento `#t=`. É um caminho paralelo,
autenticado por email a cada pedido (lookup e cancel revalidam ambos) — não guarda sessão.

## 6. Testes

- **E2e (`e2e-reservas.mjs`):**
  - lookup com código+email certos → 200 com os dados;
  - lookup com email errado → 404 **igual** ao de código inexistente (prova a resposta neutra);
  - **código em minúsculas → encontra na mesma** (prova o `.toUpperCase()`);
  - **reserva MANUAL (sem `cancelTokenHash`) com email certo → 404** no lookup E no cancel — o
    guard que mantém as manuais fora do self-service (é o achado central da revisão; sem este teste
    a regressão passa despercebida);
  - cancelar por email → 200, o slot volta a ficar livre, `cancelledBy=CUSTOMER`;
  - cancelar por email com email errado → 404;
  - reserva fora do TTL (startsAt+24h no passado) → 404 no lookup e no cancel;
  - o throttle dispara (6.º pedido → 429).
- **Regressões:** o caminho por token (`publicByCode`/`cancelByToken`) intacto — os testes da R3
  continuam verdes, incluindo «MANUAL nunca acessível»; cancelar por token e por email produzem o
  mesmo efeito (o `doCancel` é um só).
- **Browser:** na `/[slug]/reservar`, abrir o bloco, pesquisar uma reserva real (código em
  minúsculas), ver o cartão, cancelar, confirmar que passou a "Cancelada" e que o slot voltou; e
  com reservas DESLIGADAS na loja, confirmar que o bloco continua a aparecer.

## 7. Fora de âmbito

Editar a reserva por aqui · reenviar o link de gestão por email · código de confirmação por
SMS/email (o email a bater já é a prova) · autenticação por telefone (o utilizador escolheu email).
