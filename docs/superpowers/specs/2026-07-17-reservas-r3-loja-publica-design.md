# Reservas R3 — Loja pública, link partilhável e botão para sites

**Data:** 2026-07-17
**Ramo:** `matheus-reservas-fase3`
**Estado:** design aprovado pelo utilizador; falta revisão adversarial + revisão final do utilizador

> Fecha o ciclo das reservas: a R1 (backend) e a R2 (painel) estão em produção mas
> **inertes para o cliente final** — não há por onde reservar. A R3 abre-as ao público.

## 1. Objetivo

Três formas de o cliente final chegar à reserva, todas geradas no painel do dono:

1. **Página na loja** — `menooo.com/<slug>/reservar` (+ separador "Reservar" na montra)
2. **Link direto partilhável** — para Instagram, Google, WhatsApp, email
3. **Botão para o site do restaurante** — variante do `embed.js` que já existe

Mais a **proteção anti-spam** (Turnstile), que a revisão da R1 marcou como obrigatória
**antes** de abrir ao público.

## 2. Decisões (aprovadas)

| Tema | Decisão |
|---|---|
| Ordem | R3 (link público) antes do R4 (painel estilo TheFork) |
| Fluxo | Pessoas → dia → hora → dados → confirmada na hora (auto-confirmação da R1) |
| Anti-spam | **Cloudflare Turnstile** (gratuito, invisível) no POST público — obrigatório |
| Divulgação | Página + link direto + botão `embed.js` `data-reservas="1"` |
| Interruptor | Sobe para o topo da aba Reservas do painel (hoje está enterrado nas Definições) |

## 3. Contrato existente (R1 — não mudar)

- `GET /public/stores/:slug/reservation-slots?date&party` → `{ slots: string[] }` (404 se
  gating falhar: loja inativa, subscrição não usável ou `reservationsEnabled=false`;
  `party > max` → `{ slots: [], reason: 'party', contactPhone }`)
- `POST /public/stores/:slug/reservations` `{ date, time, partySize, customerName,
  customerPhone, customerEmail, notes?, marketingConsent? }` → `{ code, startsAt, endsAt,
  partySize, tableNames, manageUrl }`. Throttle 5/min/IP + cap 2 reservas ativas por
  contacto (429). Erros: 422 (hora fora da grelha / grupo grande), 409 (`{ message,
  alternatives }`), 400 (data inválida).
- `GET /public/reservations/:code` — token no header `X-Reservation-Token` (NUNCA query)
- `POST /public/reservations/:code/cancel` `{ token }`
- `getPublicBySlug` já devolve `reservationsEnabled` (R2).

## 4. Anti-spam — Turnstile (a peça nova de backend)

**Porquê:** a reserva **auto-confirma e ocupa uma mesa real** sem verificar email/telefone.
Um restaurante com 7 mesas tem ~1500 vagas em 30 dias; a 5 POST/min um só IP enche a
agenda inteira em ~5 h, e o cap de 2/contacto não trava (basta variar o email). Cada POST
dispara ainda 2 emails → vetor de email-bombing contra terceiros.

**Como:**
- Env novas: `TURNSTILE_SECRET_KEY` (API) e `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (storefront).
- **Se `TURNSTILE_SECRET_KEY` estiver vazia, a verificação é ignorada** (no-op) — o local
  e os testes continuam a correr sem chaves, e o e2e não precisa de mudar. Isto é o mesmo
  padrão do Stripe no repo (envs vazias = modo manual).
- `POST /public/stores/:slug/reservations` aceita `turnstileToken?: string`. Quando a
  secret existe: valida contra `https://challenges.cloudflare.com/turnstile/v0/siteverify`
  (POST form: `secret`, `response`, `remoteip`), timeout 5 s. Falha/ausência → **403
  `'Não foi possível validar o pedido. Recarrega a página e tenta de novo.'`**
- Falha de REDE ao contactar a Cloudflare → **deixa passar** (fail-open) e loga: um
  restaurante não pode perder reservas porque a Cloudflare está em baixo. *(Decisão
  explícita: o risco de spam durante uma falha da Cloudflare é menor que o de recusar
  clientes reais.)*
- O widget Turnstile só é renderizado no storefront se `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  existir; sem chave, o form funciona na mesma (dev).
- **O utilizador cria as chaves** (Cloudflare → Turnstile → domínio `menooo.com`), como
  fez com o Stripe. Sem chaves em produção o endpoint fica como hoje (throttle + cap).

## 5. Página de reserva — `apps/storefront/src/app/[slug]/reservar`

Server component `page.tsx` (metadata + `generateMetadata` com o nome da loja, `noindex`
como o checkout) + `ReservarClient.tsx` com o fluxo. Padrões a espelhar:
[CheckoutClient.tsx](../../../apps/storefront/src/app/[slug]/checkout/CheckoutClient.tsx)
(passos, `api.post`, toasts, `Field`) e o `StoreTheme` (cores da loja).

**Fluxo (um ecrã, três blocos):**
1. **Pessoas** — botões 1–8 + "mais de 8" (mostra `contactPhone` da loja: "Para grupos
   maiores, liga-nos"). Máx. real vem do `reason: 'party'` do servidor.
2. **Dia** — próximos 30 dias (respeita `reservationMaxAdvanceDays`); dias sem slots
   aparecem esbatidos. Buscar slots com `cache: 'no-store'` (nunca o ISR da loja).
3. **Hora** — chips com os slots devolvidos pelo servidor; vazio → "Sem horários neste
   dia" + sugestão de outro dia.
4. **Dados** — nome, telefone, email (obrigatório: leva o código e o link de gestão),
   notas opcionais, checkbox de marketing (como o checkout), Turnstile invisível.
5. **Confirmação** — código grande, dia/hora/pessoas/mesa, **link de gestão mostrado no
   ecrã** (não só no email — resolve o "enganei-me no email") e botão "Adicionar ao
   calendário" (ficheiro .ics gerado no cliente, sem dependências).

**Erros:** mensagem do servidor sempre; no 409 mostrar os `alternatives` como chips
clicáveis ("Essa hora acabou de ficar ocupada — 20:30 · 21:00 · 21:30").

## 6. Página de gestão — `/[slug]/reserva/[code]`

Lê o token do fragmento `#t=...` do URL (o `manageUrl` da R1 usa fragmento de propósito:
nunca chega aos logs do servidor), guarda-o em `sessionStorage`, **limpa o URL com
`history.replaceState`** e mete `Referrer-Policy: no-referrer`. Mostra estado, dia/hora,
pessoas, mesa e **Cancelar reserva** (com confirmação). Sem token válido → 404 neutro
("Reserva não encontrada"), igual à API.

## 7. Entrada na montra

- `StoreClient.tsx`: quando `store.reservationsEnabled`, aparece um botão/separador
  **"Reservar mesa"** junto à navegação de categorias, que leva a `/[slug]/reservar`.
- `interface Store` (storefront/lib/types.ts) ganha `reservationsEnabled: boolean`.
- **ISR:** a loja tem `revalidate: 300`, logo ligar/desligar reservas demora até 5 min a
  refletir na montra — aceitável (o gating do servidor é imediato); documentado.

## 8. Botão para sites — `embed.js`

Novo atributo `data-reservas`:
- `data-reservas="1"` → o botão flutuante abre `/<slug>/reservar` e o rótulo por omissão
  passa a **"Reservar Mesa"**.
- Sem o atributo → comportamento atual (encomendas), **sem alterações** para quem já usa.
- Continuam a valer `data-label`, `data-color`, `data-position`.

## 9. Painel — divulgação e interruptor

Na aba **Reservas**:
- **Interruptor "Reservas online"** sobe para o topo (chip ligado/desligado + explicação
  "quando ligado, aparece o separador Reservar na tua loja"). Continua a existir nas
  Definições.
- Cartão **"Partilha as tuas reservas"** com: link direto (copiar), snippet do botão
  (copiar) e nota "cola no site antes de `</body>`" — no padrão do `WebsiteWidget` que já
  existe para encomendas.

## 10. Testes

- **E2e (apps/api/scripts/e2e-reservas.mjs):** acrescentar Turnstile — com secret vazia o
  POST passa sem token (no-op, prova o modo dev); *(a validação real contra a Cloudflare
  não é testável em e2e — verificada à mão pelo utilizador quando puser as chaves).*
- **Storefront (browser):** fluxo completo pessoas→dia→hora→dados→confirmação; 409 mostra
  alternativas; página de gestão cancela e o slot volta; sem `reservationsEnabled` a loja
  não mostra o separador e `/reservar` dá 404.
- **Regressões:** e2e-kitchen 42/42, unit 20/20, encomendas e widget de encomendas
  intactos.

## 11. Fora de âmbito (R4 e v2)

Mapa de sala arrastável · serviços com nome · timeline de lotação · capacidade mín-máx
(tudo **R4**, já aprovado) · lembrete por email no dia · confirmação de telefone ·
depósitos · lista de espera · reservas recorrentes.
