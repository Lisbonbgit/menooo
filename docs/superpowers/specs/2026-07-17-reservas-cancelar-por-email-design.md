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

1. **Email normalizado.** A comparação usa o `contactEmailKey` (o `emailKey()` da R3: `trim +
   lowercase`), que a reserva já grava. `Ana@X.pt ` e `ana@x.pt` batem certo. Comparação por
   igualdade da key, nunca do valor cru.
2. **Resposta neutra — sem oráculo de enumeração.** Código inexistente, email que não bate, ou
   reserva fora do TTL → **sempre** a mesma resposta: `404 "Reserva não encontrada."` Nunca
   "esse código existe mas o email está errado" — isso diria ao atacante que o código é válido.
3. **Throttle apertado por IP.** ~5/min nos dois endpoints novos (o padrão `@Throttle` que o
   POST público já usa). Com código+email a terem de bater os dois **e** 5 tentativas/min,
   enumerar é inviável. *(O `req.ip` é fiável desde a correção do `trust proxy`.)*

Mais o **TTL** que já existe: reservas com `startsAt + 24h < agora` → 404 (o acesso não é eterno).

## 4. Backend — dois endpoints novos

Ambos em `public-reservations.controller.ts`, `@Public()`, `@Throttle({ default: { limit: 5,
ttl: 60_000 } })`. A lógica vive no `reservations.service.ts`, espelhando o `publicByCode`/
`cancelByToken` mas trocando `verifyToken` por uma verificação de email.

### `POST /public/reservations/lookup` `{ code, email }`

```ts
async publicByEmail(code: string, email: string) {
  const key = emailKey(email);
  const row = await this.prisma.reservation.findUnique({
    where: { code },
    include: { tables: { include: { table: true } }, tenant: true },
  });
  // Resposta NEUTRA para os três casos — sem revelar se o código existe.
  if (!key || !row || row.contactEmailKey !== key) throw new NotFoundException('Reserva não encontrada.');
  if (row.startsAt.getTime() + 24 * 3_600_000 < Date.now()) throw new NotFoundException('Reserva não encontrada.');
  // devolve EXATAMENTE o mesmo shape do publicByCode (code, status, date, time, startsAt,
  // endsAt, partySize, restaurantName, restaurantPhone) — SEM tableNames (a R3 decidiu não os
  // mostrar ao cliente) e SEM o token.
  return this.publicReservationView(row);
}
```

> **Refactor mínimo:** o `publicByCode` monta o objeto de resposta inline. Extrair essa montagem
> para um `publicReservationView(row)` privado e reutilizá-lo aqui — para os dois caminhos
> devolverem exatamente o mesmo shape e não divergirem. Não muda o contrato do `publicByCode`.

### `POST /public/reservations/:code/cancel-by-email` `{ email }`

Espelha o `cancelByToken`, trocando só a autorização:

```ts
async cancelByEmail(code: string, email: string) {
  const key = emailKey(email);
  const row = await this.prisma.reservation.findUnique({
    where: { code },
    include: { tables: { include: { table: true } }, tenant: true },
  });
  if (!key || !row || row.contactEmailKey !== key) throw new NotFoundException('Reserva não encontrada.');
  if (row.startsAt.getTime() + 24 * 3_600_000 < Date.now()) throw new NotFoundException('Reserva não encontrada.');
  // A partir daqui é IGUAL ao cancelByToken: TTL já verificado, cancelar até endsAt, guarda
  // atómica updateMany(status: CONFIRMED), emitReservationUpdated + afterCancel.
  return this.doCancel(row);
}
```

> **Refactor mínimo:** o corpo do `cancelByToken` a partir da guarda de estado (o
> `if (status !== CONFIRMED …)` até ao `return { ok: true }`) é extraído para um `doCancel(row)`
> privado, chamado pelos dois. A autorização (token vs email) fica em cada método; a mecânica de
> cancelamento é uma só. Garante que cancelar por email e por token são idênticos — mesmo TTL,
> mesmo "até endsAt", mesma emissão de socket e emails.

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

Em `apps/storefront/src/app/[slug]/reservar/ReservarClient.tsx`, no fim (a seguir ao form de
reserva, fora do fluxo de passos):

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

**Reutilizar, não duplicar:** o cartão de reserva e o diálogo de cancelamento já existem no
`ReservaClient.tsx` (a página de gestão por token). Extrair o cartão de estado para um componente
partilhado (ex. `ReservationCard`) que ambos usam, ou — se for pequeno — replicar a marcação com
cuidado. A montagem do POST de cancelamento é a única diferença (token vs email).

**Nada de token aqui.** Este fluxo não lê nem escreve o fragmento `#t=`. É um caminho paralelo,
autenticado por email a cada pedido (lookup e cancel revalidam ambos) — não guarda sessão.

## 6. Testes

- **E2e (`e2e-reservas.mjs`):**
  - lookup com código+email certos → 200 com os dados (sem `tableNames`, sem token);
  - lookup com email errado → 404 **igual** ao de código inexistente (prova a resposta neutra);
  - cancelar por email → 200, o slot volta a ficar livre, `cancelledBy=CUSTOMER`;
  - cancelar por email com email errado → 404;
  - reserva fora do TTL (startsAt+24h no passado) → 404 no lookup e no cancel;
  - o throttle dispara (6.º pedido → 429).
- **Regressões:** o caminho por token (`publicByCode`/`cancelByToken`) intacto — os testes da R3
  continuam verdes; cancelar por token e por email produzem o mesmo efeito (o `doCancel` é um só).
- **Browser:** na `/[slug]/reservar`, abrir o bloco, pesquisar uma reserva real, ver o cartão,
  cancelar, confirmar que passou a "Cancelada" e que o slot voltou.

## 7. Fora de âmbito

Editar a reserva por aqui · reenviar o link de gestão por email · código de confirmação por
SMS/email (o email a bater já é a prova) · autenticação por telefone (o utilizador escolheu email).
