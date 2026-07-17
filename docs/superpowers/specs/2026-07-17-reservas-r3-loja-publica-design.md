# Reservas R3 — Loja pública, link partilhável e botão para sites

**Data:** 2026-07-17
**Ramo:** `matheus-reservas-fase3`
**Estado:** design aprovado + revisão adversarial incorporada; falta revisão final do utilizador

> Fecha o ciclo das reservas: a R1 (backend) e a R2 (painel) estão em produção mas
> **inertes para o cliente final** — não há por onde reservar. A R3 abre-as ao público.

## 1. Objetivo

Três formas de o cliente final chegar à reserva, todas geradas no painel do dono:

1. **Página na loja** — `menooo.com/<slug>/reservar` (+ botão "Reservar mesa" na montra)
2. **Link direto partilhável** — para Instagram, Google, WhatsApp, email
3. **Botão para o site do restaurante** — variante do `embed.js` que já existe

Mais o que a revisão adversarial provou ser preciso para isto **poder** abrir ao público
sem partir nada: anti-spam a sério, contrato público completo e prontidão do dono.

## 2. Decisões (aprovadas)

| Tema | Decisão |
|---|---|
| Ordem | R3 (link público) antes do R4 (painel estilo TheFork) |
| Fluxo | Pessoas → dia → hora → dados → confirmada na hora (auto-confirmação da R1) |
| Anti-spam | **Cloudflare Turnstile** no POST público — obrigatório em produção |
| Divulgação | Página + link direto + botão `embed.js` `data-reservas="1"` |
| Interruptor | Sobe para o topo da aba Reservas, dentro de um **bloco de prontidão** |

## 3. Pré-requisito de segurança — `trust proxy` (CORRIGIDO, ao 2.º tentar)

**Não é um detalhe da R3: era uma falha viva na API que já está em produção.**

`main.ts` fazia `app.set('trust proxy', 1)` com o comentário «atrás do Caddy» — posto na F1 da
cozinha **como medida de segurança**, para um Caddy que na altura não existia. O `@nestjs/throttler`
identifica o cliente por `req.ip`; com `trust proxy: 1` o `req.ip` passa a sair do
`X-Forwarded-For`, **que o cliente escreve**. Um XFF por pedido = um balde por pedido.

> **A primeira versão deste § estava errada e a correção que descrevia teria partido a
> produção.** Dizia «o Caddy não existe» com base no `docker-compose.prod.yml` (`8083:3001`) e
> nos defaults do repo. Ninguém perguntou à produção. **O repo mente:**
>
> ```
> dig +short api.menooo.com          -> 187.124.4.163
> curl -sI https://api.menooo.com/api/health -> HTTP/2 200      => HÁ um Caddy (TLS terminado)
> curl -s  http://187.124.4.163:8083/api/health -> 200          => a porta direta TAMBÉM está aberta
> ```
>
> Existem **dois** caminhos, logo nenhum valor escalar serve:
> - `1` → confia no XFF de qualquer origem → pela porta 8083 o atacante escolhe o próprio
>   `req.ip`. **Era a falha real.**
> - `false` (a "correção" anterior) → ignora o XFF do Caddy → todo o tráfego legítimo passa a ter
>   `req.ip` = IP do Caddy, **um só balde partilhado** → **429 em clientes reais**. Trocava uma
>   falha por uma avaria.

**Correção aplicada:** uma **lista de proxies de confiança**.

```ts
app.set('trust proxy', process.env.TRUST_PROXY ?? ['loopback', 'uniquelocal']);
```

O XFF só conta quando o **peer da ligação** é mesmo o proxy (`loopback` = Caddy no host;
`uniquelocal` = redes privadas, se algum dia for container). Provado em
`apps/api/src/trust-proxy.spec.ts`:

| Cenário | `req.ip` | Consequência |
|---|---|---|
| Atacante direto na 8083 com `XFF: 9.9.9.9` | `1.2.3.4` (o socket dele) | throttle funciona |
| Cliente real pelo Caddy, `XFF: 88.1.2.3` | `88.1.2.3` | baldes por cliente, sem 429 falsos |
| XFF forjado **através** do Caddy (`9.9.9.9, 203.0.113.50`) | `203.0.113.50` | a forja é ignorada |

O teste foi **validado por mutação**: emulando o `trust proxy: 1` antigo fica vermelho em
`trust('1.2.3.4') === false` e no `req.ip` do atacante (`9.9.9.9` em vez de `1.2.3.4`) — e os
dois casos do caminho do Caddy **continuam verdes**, o que confirma que o `1` só estava partido
na porta direta. Tem de ser **unit e não e2e**: o e2e liga-se de `127.0.0.1`, que é um proxy de
confiança, logo nunca exercitaria o caso do atacante.

Alcance da falha original: **todos** os limites da API, incluindo `POST /auth/login`, que não
tinha `@Throttle` nenhum — só o global de 100/min, contornável. Força bruta de passwords sem
travão. O `@Throttle` do login entra na Task 7.

**Ações fora deste spec, para o utilizador decidir:**
- Este commit deve ir a produção **antes** e independentemente da R3.
- **Fechar a porta direta** (`127.0.0.1:8083:3001` no compose) continua a ser boa higiene — mas
  já não é o que segura isto de pé, e por isso deixou de ser bloqueante.
- Recomendo `@Throttle` dedicado no `login` (ex. 10/min): 100/min ainda são 144k
  tentativas/dia por IP.
- **Se o `menooo.com` for para a Cloudflare, manter o DNS em «DNS only» (nuvem cinzenta).**
  Ligar a nuvem laranja acrescenta um salto ao XFF e, com `trust proxy` mal calibrado, o
  `req.ip` passa a ser a edge da Cloudflare **para toda a gente** → 429 aleatórios em
  clientes reais. O Turnstile **não exige** proxy nem DNS na Cloudflare.

## 4. Contrato público — o que falta expor (aditivo, não quebra a R1)

O `getPublicBySlug` devolve hoje `id, slug, name, logoUrl, coverUrl, brandColor, heroColor,
city, currency, acceptsDelivery, acceptsPickup, deliveryFee, minOrderValue, isOpen,
reservationsEnabled`. Sem os campos abaixo a página é **inconstruível** como desenhada:

| Campo | Porquê |
|---|---|
| `reservationMaxPartySize` | default **12**; com chips 1–8 os grupos de 9–12 são reserváveis mas não têm botão. Perda pura da mesa mais valiosa da noite. |
| `reservationMaxAdvanceDays` | default 30, configurável; numa loja com 7 a montra mostraria 23 chips a dizer sempre "sem horários" |
| `phone` | o passo "mais de N" manda «liga-nos» e não há número; idem no beco do 403 |
| `address`, `zipCode` | uma reserva é o cliente a deslocar-se — sem morada não há confiança |

`interface Store` (storefront/lib/types.ts) acompanha. `phone` é `String?` no schema → tratar
o `null` (degradar para "contacta-nos pela loja").

**Novo endpoint em lote** — `GET /public/stores/:slug/reservation-days?from&to&party`
→ `{ days: [{ date, hasSlots }] }`.

Porquê: o passo "Dia" precisa de saber que dias têm vaga. Um pedido por dia = **30 pedidos**,
e cada mudança de nº de pessoas refá-los (1→2→4 pessoas ≈ 90–120 pedidos/min) contra o
**global de 100/min por IP** → 429 a meio do fluxo, pior em wi-fi de família/CGNAT.
Três das quatro lentes convergiram aqui de forma independente.

*Medido:* 30 dias sequenciais custam **60 ms** (2 ms/chamada) — **a latência não é o
problema**, o orçamento do throttle e as ~120 queries por abertura de página é que são.
O `slotsForDayTx` já carrega os `busy` de uma janela de 36 h; generalizar para o intervalo dá
1 `gatedTenant` + 1 `reservation.findMany` + 1 `table.findMany` e itera os dias em memória
(o `assignTables` já é puro).

**Throttle nos slots:** `@Throttle({ default: { limit: 30, ttl: 60_000 } })` no handler dos
slots (hoje só tem o global) + cache curto (30–60 s) por `(tenant, data, party)`. É um
amplificador barato de carga contra o Postgres partilhado com as encomendas, e entrega o mapa
de ocupação de qualquer restaurante a quem o peça.

## 5. Anti-spam — Turnstile

**Porquê:** a reserva **auto-confirma e ocupa uma mesa real** sem verificar email/telefone.

**Fail-closed, não no-op silencioso.** A analogia com o Stripe que a versão anterior deste
spec fazia estava invertida: no Stripe, envs vazias = modo manual visível; aqui, secret vazia
= proteção desligada **em silêncio** com o endpoint 100% aberto a auto-confirmar mesas. O
mesmo estado nasce de um typo, de uma chave revogada ou de um `.env` perdido num redeploy
(já aconteceu neste grupo).

- Arranque com `NODE_ENV=production` e `TURNSTILE_SECRET_KEY` vazia → log ERROR + flag no
  `/health`, e `createPublic` responde **503** («Reservas online temporariamente
  indisponíveis»), salvo `TURNSTILE_OPTIONAL=1` explícito. Estado a vermelho no bloco de
  prontidão do painel (§9), que é onde o dono decide abrir ao público.
- Local/dev/e2e sem chaves continuam a correr (a flag só morde em produção).

**Fronteira do fail-open — precisa de ser exata:**
- **Só** a rejeição do `fetch`/`AbortError` (rede/timeout) deixa passar.
- Qualquer resposta **parseada** com `success !== true` → **403**. Inclui
  `timeout-or-duplicate` (é assim que a Cloudflare garante uso único do token — **não é
  preciso store de idempotência nossa**, mas só funciona se este ramo não cair no fail-open)
  e `invalid-input-response`.
- Resposta não-2xx ou não-JSON (5xx com HTML, corpo truncado) → **403**, nunca open.
- O fail-open é **auto-induzível**: cada POST passa a fazer uma chamada de saída com timeout
  de 5 s; sob flood o pool satura, os siteverify expiram e cada timeout abre a porta — a
  proteção enfraquece exatamente sob a carga que existe para travar. Mitigação: teto de
  concorrência nas chamadas ao siteverify + contador de falhas consecutivas com log ERROR
  distinto e contador no `/health`. Em modo degradado **apertar** (1/min/IP) em vez de abrir.

**Binding:** a sitekey é pública por construção. Widget com `action: 'reserva'`; no servidor
exigir `success === true && action === 'reserva' && allowedHostnames.includes(hostname)`.
Sitekey **exclusiva** do fluxo de reservas — no dia em que for reutilizada noutro form, os
tokens passam a ser intermutáveis.

**DTO:** `main.ts` usa `forbidNonWhitelisted: true`, logo `@IsOptional() @IsString()
@MaxLength(2048) turnstileToken?: string` no `CreatePublicReservationDto` **não é opcional
de facto** — sem ele, todos os POSTs levam 400 assim que a sitekey existir.

**Rollout (a ordem importa):** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` é **build-time** (inlinada no
bundle) e `TURNSTILE_SECRET_KEY` é **runtime**. «Pus as chaves no `.env` e reiniciei» produz
API a exigir token + storefront sem widget = **403 em 100% das reservas**. Logo: `ARG`/`ENV`
no Dockerfile + `args` no `docker-compose.prod.yml`, **rebuild** da imagem do storefront
(não restart), storefront com sitekey **primeiro**, secret na API só depois.

**Quando o widget falha no cliente** (bloqueadores, redes corporativas, browser antigo):
timeout de ~8 s → mostrar o fallback de telefone em vez de submeter para um 403 garantido.
Logar `turnstile_rejected` com o slug — um dono a perder 100% das reservas por isto é hoje
indistinguível de «não temos procura».

**E2e — o caminho real É testável.** A Cloudflare publica secrets de teste:
`1x0000000000000000000000000000000AA` (passa sempre), `2x...AA` (falha sempre → prova o 403)
e `3x...AA` (token já gasto → prova o tratamento de replay). Cobrir os três. A versão
anterior deste spec só testava o no-op — ou seja, o único caminho coberto era aquele em que a
proteção não existe.

## 6. Tetos — o travão que o Turnstile não é

O Turnstile **preça** o ataque, não o limita: uma farm de browsers headless cunha tokens a
custo quase nulo. Os tetos é que são o controlo real.

- **Normalização do cap.** O cap compara strings cruas (`OR: [{ customerEmail }, {
  customerPhone }]`): `Ana@x.pt` ≠ `ana@x.pt ` são 2 contactos para o cap e **a mesma caixa
  de correio**; `+351912345678` ≠ `912 345 678` idem. Guardar `contactEmailKey`
  (trim+lowercase) e `contactPhoneKey` (só dígitos, últimos 9), indexadas com `tenantId`,
  contar por elas e manter os originais para exibição.
  *(Fora de âmbito: desfazer aliasing de gmail — arrisca falsos positivos e YAGNI.)*
- **Falsos positivos caros.** O cap de 2 apanha o casal/família que partilha telefone e a
  mesma pessoa a marcar sexta + domingo — o cliente fiel, exatamente quem o restaurante quer.
  **Subir para 3** e devolver sempre `contactPhone` no erro (o padrão do `reason: 'party'` já
  existe), renderizado como `<a href="tel:">`. Hoje a mensagem manda «Contacta-o diretamente»
  sem dar o contacto: beco sem saída.
- **Email-bombing.** Cada create dispara 2 emails e cada cancel mais 2, e o cancel público
  **não tem Turnstile**: 1 desafio = até 4 emails, 2 deles para um endereço escolhido pelo
  atacante e nunca verificado. O ciclo create→cancel→create nunca chega ao cap (só conta
  `CONFIRMED` futuras). O `MAIL_FROM` é **único e partilhado por toda a plataforma** (Resend)
  → uma campanha queima a reputação de envio de **todos** os tenants.
  → Limite por destinatário no `MailService` (≤5 emails de reserva por endereço/24 h,
  descartados com log).

  > ⚠️ **SÓ nos 2 emails que vão ao CLIENTE** (confirmação e cancelamento), onde o destinatário
  > é escolhido por quem reserva. **NUNCA nos alertas ao RESTAURANTE.** A 1.ª versão deste spec
  > mandava aplicá-lo «aos 4 métodos `sendReservation*`» — e dois deles vão para o dono, num
  > endereço **fixo** por tenant. O teto virava uma arma: 5 reservas e o dono deixava de receber
  > alertas 24 h, sendo o email o único canal dele quando não tem o painel aberto. Um restaurante
  > com procura normal passa dos 5/dia sozinho. O bombing do dono trava-se pelo cap por contacto
  > e pelo Turnstile — nunca silenciando-o. *(Blocker apanhado por duas lentes da revisão do
  > código; testes em `mail.service.spec.ts` incluem baldes independentes.)*
  >
  > O teto por destinatário também **não** se aplica ao `send()` genérico: emails de conta
  > (verificação, reposição de password) não podem ser silenciados por tráfego de reservas.

  *(Fora de âmbito: teto diário por tenant de reservas ONLINE — o cap por contacto normalizado
  e o Turnstile cobrem o essencial; entra se a procura o justificar.)*

**Nota — um achado da revisão que verifiquei e REJEITEI:** a lente de UX afirmou que tornar
o email opcional parte o cap, porque `OR: [{ customerEmail: undefined }, …]` faria o Prisma
casar com todas as reservas. **Testado com dados reais (3 reservas futuras): devolve 0, não
3.** O Prisma remove o membro inteiro do `OR`, não o transforma em match-all. A armadilha não
existe nesta versão. *(O email mantém-se obrigatório no canal ONLINE — decisão da R1,
`customerEmail String?` = «obrigatório ONLINE; opcional MANUAL». Torná-lo opcional é uma
decisão de produto em aberto para o utilizador, não um bug.)*

## 7. Página de reserva — `apps/storefront/src/app/[slug]/reservar`

Server component `page.tsx` + `ReservarClient.tsx`. Padrões a espelhar: `CheckoutClient.tsx`
(passos, `api.post`, toasts, `Field`) e o `StoreTheme`.

**Não pode ser estática.** O `notFound()` do gating seria ele próprio cacheado com
`revalidate: 300`: o dono liga as reservas, copia o link do §9, abre → **404 durante 5 min**.
É o primeiro gesto que ele faz. Logo `cache: 'no-store'` (ou `dynamic = 'force-dynamic'`) na
busca da loja; `revalidate: 300` só no `generateMetadata`.

**Indexável** — o §1 vende o Google como canal. Copiar o `noindex` do checkout era analogia
errada: o checkout é um passo privado de funil; `/reservar` é uma landing pública e sem
estado, que é exatamente o que se procura por «reservar mesa \<restaurante\>». `index: true`,
title «Reservar mesa — \<Loja\>» + description com a cidade, e entrada no `sitemap.ts` para
lojas com reservas (implica `reservationsEnabled` no `listPublicStores`, que hoje só mapeia
`{ slug, updatedAt }`). Só `/reserva/[code]` fica noindex.

**Fluxo (um ecrã):**
1. **Topo** — nome, morada, chip `tel:` e o `AddressMap` que já existe (Nominatim, grátis,
   sem chave; no checkout serve a morada do cliente, aqui a do restaurante).
2. **Pessoas** — chips `1..reservationMaxPartySize` (wrap; 12 chips cabem no mobile) +
   «mais de {max} · liga-nos» com o telefone do payload, sem round-trip. Teto de 50 (o
   `publicSlots` atira 400 acima disso).
3. **Dia** — `min(30, reservationMaxAdvanceDays)` chips, via `reservation-days` (1 pedido).
4. **Hora** — chips dos slots do dia tocado.
5. **Dados** — nome, telefone, email, notas, Turnstile. Notas com placeholder que vende o
   campo: «Ex.: aniversário, cadeira de bebé, mesa na esplanada, acesso com carrinho» — numa
   reserva a nota **é** a intenção, e é metade do valor de receber a reserva online.
   Por cima do submit: «Reserva grátis e sem compromisso — podes cancelar a qualquer momento
   no link que te damos a seguir.» (a política real já é esta, e está escondida no código).
6. **Confirmação** — código grande, dia/hora/pessoas, morada, e «Gerir a minha reserva» como
   **botão** (`href` com `#t=`), nunca o URL como texto: o manage URL **é** a credencial, e
   texto literal põe um bearer token em todos os screenshots («olha, reservei!» → story do
   Instagram). Mesmo clique, zero token visível. «Copiar link» via clipboard, se preciso.
   Mais a linha de tolerância: «Chega à hora marcada; se te atrasares, liga ao restaurante
   para não perderes a mesa» (não há campo de tolerância no schema — R4).

**Sem mesa.** Não mostrar `tableNames` ao cliente (ecrã, email, gestão). O R4 existe para o
dono **arrastar** reservas entre mesas; consolidar «Mesa 7» num email imutável cria clientes
que chegam e exigem a Mesa 7 depois de terem sido movidos, e força a R4 a escolher entre não
realocar ou construir notificações que não existem. É por isto que o TheFork não mostra a
mesa. O campo fica no contrato (não é breaking) — é só não o renderizar.

**Dados:** `api.get` + `useQuery({ queryKey: ['slots', slug, date, party], staleTime: 0,
gcTime: 0, retry: false })`. *(A versão anterior dizia «`cache: 'no-store'`, nunca o ISR da
loja» — errado: o `lib/api.ts` é axios, onde `cache` é no-op, e um pedido do cliente nunca
esteve sob o ISR. O risco real é a cache do react-query: depois de um 409, serviria a hora já
ocupada outra vez.)* `invalidateQueries` no 409 e na confirmação.

**Erros:**
- **409** — chips clicáveis com as `alternatives`. **Ordenar por proximidade da hora pedida
  antes do `slice(0, 4)`** (hoje são os 4 primeiros slots do dia: quem tenta 21:00 recebe
  «12:00 · 12:30 · 13:00» — não é alternativa, lê-se como avaria), e re-ordenar
  cronologicamente só para exibir.
- **429** — hoje o cap (429) e o throttle (429) são indistinguíveis, e o
  `ThrottlerException` traz literalmente «ThrottlerException: Too Many Requests» **em
  inglês** para o cliente português. A R1 ainda não tem consumidor público — é o último
  momento barato para separar: cap → **409** `{ message, code: 'CONTACT_CAP', contactPhone }`,
  429 exclusivo do throttle, e no cliente **nunca ecoar `data.message` num 429** («Demasiados
  pedidos deste dispositivo. Espera um minuto.»).
- **403 do Turnstile** — **nunca mandar recarregar**: nessa altura o cliente já escolheu tudo
  e escreveu os dados, e o token expira sozinho (~5 min), logo este 403 acontece a **gente
  legítima que hesitou**. `turnstile.reset()` em silêncio, manter o estado, re-submeter uma
  vez; só a segunda falha mostra erro, e sem perder o formulário. Obter o token no submit,
  não à carga da página.
- **404 de gating a meio do fluxo** — «As reservas online desta loja estão indisponíveis» +
  link para `/[slug]`.

## 8. Página de gestão — `/[slug]/reserva/[code]`

`page.tsx` server component cuja única função é `generateMetadata` com `robots: { index:
false, follow: false }` e título genérico (nunca o nome do cliente), a renderizar
`ReservaClient.tsx`.

- O token vem no fragmento `#t=`, que **nunca chega ao servidor** → só é legível no cliente →
  **«sem token válido → 404 neutro» não pode ser um 404 HTTP**: o documento sai 200 e o
  «Reserva não encontrada» é estado renderizado. Assumir a diferença.
- Ler o hash e correr o `history.replaceState` **de forma síncrona no topo do componente**,
  antes de qualquer outro efeito.
- **TTL:** o `cancelTokenHash` é hoje uma credencial bearer **eterna** — `verifyToken` só
  compara o hash, sem noção de tempo nem estado. Continua válido depois do jantar, depois de
  CANCELLED, para sempre. É isto que transforma cada vetor (histórico sincronizado com a
  conta Google, extensões com permissão `tabs`, email reencaminhado, screenshot,
  `sessionStorage` num quiosque) de «janela» em «permanente». → rejeitar (404 neutro) quando
  `startsAt + 24 h < now`. Expirar por **tempo**, não por estado, para quem clica no link
  logo após cancelar continuar a ver «reserva cancelada» em vez de um 404 confuso.
  *(Impacto de fuga limitado: `publicByCode` não devolve nome/telefone/email — só permite
  cancelar.)*
- **Cancelar até `endsAt`, não `startsAt`.** Hoje quem se atrasa 10 min e quer avisar recebe
  «Esta reserva já não pode ser cancelada» e a mesa fica CONFIRMED a bloquear 120 min até o
  dono marcar NO_SHOW à mão. Um cancelamento tardio é sempre melhor para o dono que um
  no-show mudo. Esconder o botão quando o estado não permite, mostrar o estado real e sempre
  «Se não conseguires vir, liga-nos: \<phone\>» (→ expor `phone` no `GET
  /public/reservations/:code`).
- `useStore(slug)` + `<StoreTheme>` em **todos** os ramos de return (padrão do
  `CheckoutClient`, que o renderiza 3×) — o `StoreTheme` mete CSS vars no `useEffect` e
  remove-as no unmount, não se aplica sozinho; o `publicByCode` não devolve as cores. Prever
  o FOUC (primeiro paint em laranja Menooo). *(Ponto bom: o `getPublicBySlug` **não** é gated
  por `reservationsEnabled`, logo a gestão sobrevive a o dono desligar as reservas.)*

**Correção de justificação:** o §6 anterior dizia que usava fragmento porque «nunca chega aos
logs» (verdade) e juntava `Referrer-Policy: no-referrer` como se protegesse o token. **Não
protege:** o fragmento nunca vai no `Referer` por spec de HTTP. O `no-referrer` protege o
`code` no path — útil, mas não é o que o spec pensava. Manter, com a justificação certa. O
vetor real é tudo o que corre na origem do storefront ler `location.hash`/`sessionStorage`:
hoje não há **nenhum** script de terceiros no storefront (zero gtag/GTM/fbq e zero
`dangerouslySetInnerHTML`) — está a salvo **por acidente**. Nota explícita no spec: nenhum
script de terceiros no layout sem strip prévio do fragmento; um pixel de GA/Meta amostra
`location.href` **com** o fragmento no primeiro paint, antes de o `replaceState` correr.

> ⚠️ **NUNCA acrescentar `X-Frame-Options`/`frame-ancestors` ao storefront** — o `embed.js`
> de todos os clientes atuais depende de ser embebível, e o `Referrer-Policy` deste §
> convida a um `headers()` novo no `next.config.mjs`, que é exatamente onde isso se
> acrescenta por reflexo. Dar o `source` exato (`/:slug/reserva/:code`). Se algum dia entrar
> CSP, tem de permitir `https://challenges.cloudflare.com`.

## 9. Entrada na montra

- CTA **"Reservar mesa"** no bloco do hero, **a seguir à linha de `InfoChip`**
  (Entrega/Take-away/Mínimo), que renderiza sempre.
  *(Correção da versão anterior: «junto à navegação de categorias» está errado — a nav só
  existe com `menu.data.length > 1`, logo numa loja com 0 ou 1 categoria — justamente quem
  mais quer reservas — o botão desaparecia; e dentro de um `overflow-x-auto` sairia do ecrã
  em lojas com muitas categorias.)*
- `interface Store` ganha `reservationsEnabled` (já vem do payload).
- **ISR:** ligar/desligar demora até 5 min a refletir na montra — aceitável (o gating do
  servidor é imediato). Não vale para `/reservar`, ver §7.
- **Reservas desligadas ≠ loja inexistente.** O link direto e o botão do site são
  permanentes; o dono desliga uma semana (obras) ou falha um pagamento e o link espalhado
  pela internet passaria a dizer que o **restaurante não existe**. Na `/reservar`: loja
  inexistente → 404; loja ACTIVE com reservas off → «As reservas online estão temporariamente
  indisponíveis — liga-nos: \<phone\>» + link para o menu.

## 10. Botão para sites — `embed.js`

`data-reservas="1"` → o botão abre `/<slug>/reservar` e o rótulo por omissão passa a
«Reservar Mesa». Sem o atributo → comportamento atual, sem alterações.

**Duas instâncias é o caso óbvio** (o §11 dá ao dono um 2.º snippet: encomendas + reservas) e
o `embed.js` atual parte-se: `window.MenoooWidget.open` é **sobrescrito** pela 2.ª instância;
cada uma regista o seu listener global em `[data-menooo-order]` → um clique abre **os dois
overlays empilhados**; os dois botões flutuantes são `position:fixed; bottom:20px` → ficam
**um por cima do outro**; os dois handlers de Escape disparam; e `iframe.title =
'Encomendar'` está hardcoded (a11y errada para reservas).

→ **Um só script** com `data-reservas="1"` a renderizar os dois botões (mais simples), ou
contrato explícito de duas instâncias: namespace por modo (`MenoooWidget.order` /
`.reservas`, com `.open` como alias do primeiro por retrocompatibilidade), gatilho próprio
`data-menooo-reservar` com o listener a filtrar só o seu, empilhamento
(`bottom: 20 + n*68 px` via contador) e `iframe.title` derivado do modo.

## 11. Painel — prontidão, interruptor e divulgação

**Bloco de prontidão, não um interruptor solto.** Nada impede hoje `reservationsEnabled=true`
com **0 mesas**: o gating só vê status + subscrição + flag, e sem mesas o `slotsForDayTx`
devolve `{slots:[]}` para todos os dias. Resultado: a montra ganha o botão «Reservar mesa», o
cliente abre e vê 30 dias vazios — **uma loja publicamente partida** — e o dono não recebe
sinal nenhum (o único aviso é um banner âmbar dentro do separador «Dia», que ele pode nunca
ver). O interruptor do topo é **exatamente o botão que cria esse estado**.

Checklist com: (1) ≥1 mesa ativa reservável, (2) janelas ou horário por weekday, (3) email de
alertas, (4) link copiado. Bloquear o toggle enquanto (1) falhar («Cria pelo menos 1 mesa
reservável antes de ligar») **e recusar no servidor**: `PATCH reservationsEnabled=true` com 0
mesas → 400. E2e: «ligar sem mesas é recusado».

**Horas efetivas, com proveniência.** `OpeningHour` tem `@@unique([tenantId, weekday])` = UMA
faixa por dia, logo um restaurante que fecha das 15h às 19h é obrigado a declarar 12:00–23:00
contínuo, e o fallback (`closeMinute − 60`) gera slots das 12:00 às 22:00 — **incluindo 17:00
com a cozinha fechada**. As `ReservationWindow` existem para isto mas ficaram opcionais e
vazias por omissão, e a R3 abre esse default ao público. Mostrar no bloco «Sáb 12:00–22:00 —
vem do teu horário de abertura, não de janelas» + CTA «Definir janelas de almoço/jantar».
*(O horário repartido a sério é o pedido do Roma — trabalho à parte, com schema.)*

**Email de alertas — entra no âmbito da R3.** O alerta existe (`restaurantNotifyEmail =
tenant.email ?? OWNER`) e o `UpdateTenantDto` já aceita `email`, mas o painel **não tem
campo** (ficou como follow-up da R2). Como o `tenant.email` é escrito no signup, no dia 1 os
alertas vão para a caixa de quem criou a conta (muitas vezes o contabilista/agência). A R3 é
o momento em que passam a existir reservas reais a alertar: se o dono não tem o painel
aberto, **o email é o único canal**. É um `<input>` + um campo já suportado pelo DTO, com
«Enviar email de teste».

**Interruptor:** sobe para o topo, **mesma mutação e mesma `queryKey` da config**, com
invalidação. O `ReservationSettings` copia a config para estado local e o `save` só envia o
que mudou — um toggle otimista noutra key deixaria o cartão com `form` obsoleto e o próximo
«Guardar» **voltaria a desligar as reservas em silêncio**. Fonte única.

**Cartão "Partilha as tuas reservas":** link direto (copiar), snippet do botão (copiar), nota
«cola no site antes de `</body>`» — padrão do `WebsiteWidget` que já existe.

## 12. Testes

- **Unit:** ordenação das `alternatives` por proximidade; normalização de
  `contactEmailKey`/`contactPhoneKey`; TTL do token.
- **E2e (`e2e-reservas.mjs`):** Turnstile com os 3 secrets de teste da Cloudflare (passa /
  403 / replay); **tracker do throttle** — dois POSTs do mesmo socket com XFF diferentes
  partilham o balde e o 6.º dá 429 (prova a §3, e impede a regressão); ligar reservas sem
  mesas → 400; `reservation-days` bate certo com `reservation-slots` dia a dia; cap por
  contacto normalizado (`Ana@x.pt` e `ana@x.pt` contam como um).
- **Storefront (browser):** fluxo completo; 409 mostra alternativas ordenadas; gestão cancela
  e o slot volta; reservas off → estado suave, não 404; **popup do widget de encomendas
  continua a abrir** (regressão do §8/§10).
- **Regressões:** e2e-kitchen 42/42, unit, encomendas e widget atual intactos.

## 13. Fora de âmbito

**R4 (aprovado):** mapa de sala arrastável · serviços com nome · timeline de lotação ·
capacidade mín-máx · tolerância de atraso configurável.
**Trabalho à parte:** horário repartido (schema) · `@Throttle` no login · email opcional no
canal ONLINE (decisão de produto).
**v2:** lembrete no dia · confirmação de telefone · depósitos · lista de espera · recorrentes.

**Cortado do MVP:** `.ics` gerado no cliente. A promessa técnica cumpre-se, mas no telemóvel o
retorno é fraco: um `blob:`/`data:` `.ics` no Safari iOS não é entregue ao Calendário (vai
para Ficheiros), no Chrome Android desce para Transferências em silêncio — o que faz o iOS
entregar ao Calendário é o `Content-Type: text/calendar` servido por HTTP. Resultado
provável: um botão que parece não fazer nada. → anexar o `.ics` ao **email** de confirmação
(o nodemailer já aceita `attachments`; Gmail e Apple Mail renderizam um cartão nativo de
«Adicionar ao calendário», sem UI nenhuma da nossa parte).
