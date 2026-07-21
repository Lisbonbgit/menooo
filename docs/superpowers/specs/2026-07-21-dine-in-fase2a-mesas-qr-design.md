# Dine-in Fase 2a — Mesas de sala + QR + menu na mesa — Design

**Data:** 2026-07-21
**Ramo:** `matheus-dine-in-fase2a`
**Estado:** aprovado no brainstorming; a aguardar revisão do spec.

## 1. Contexto

O dine-in (pedidos na mesa por QR) está dividido em fases. A Fase 1 (menus separados
Delivery/Sala) já está em produção. A **Fase 2** (pedir na mesa) é grande — foi dividida em:
- **Fase 2a (este spec):** conceito de **mesa de sala** próprio + o Menooo **gera o QR** de cada
  mesa + sub-abas "QR Code"/"Ver Menu" no painel + o cliente lê o QR e vê o **menu de Sala** com a
  mesa identificada. *Ainda só para ver — o pedir é a 2b.*
- **Fase 2b (depois):** pedir na mesa, a **conta da mesa** (tab que o staff fecha), a vista de
  "mesas abertas", e a correção do isolamento de menu no `createPublicOrder`.

**Decisões do utilizador:** mesas de sala num conceito **separado** das reservas; o Menooo **gera
QR novos** (o dono imprime e cola); a conta da mesa (2b) é um **tab** que o staff fecha no fim.

## 2. Requisito de segurança (TOPO): isolamento de QR por restaurante

**Um QR (token) só pode alguma vez servir o restaurante a que pertence — nunca outro.** Garantido por:
- `DineTable.qrToken` é **único globalmente** (nenhum tenant pode ter o token de outro).
- O QR é gerado **sempre com o slug do próprio dono** (autenticado e preso ao seu tenant — só cria
  mesas para si).
- O endpoint público que resolve o QR faz a busca **com o slug E o token juntos**
  (`where: { qrToken, tenant: { slug } }`): se o token não pertencer àquele restaurante → **404
  neutro**. Mesmo trocando o slug no URL à mão, não serve o menu de outro.
- **Teste obrigatório:** um `qrToken` do restaurante A pedido com o slug do restaurante B → 404.

## 3. Âmbito

**Entra:** modelo `DineTable`; CRUD das mesas no painel; geração+impressão do QR; sub-abas
"QR Code" e "Ver Menu" (só no menu de Sala); rota pública `/[slug]/mesa/[qrToken]` que mostra o
menu de Sala (só leitura) com a mesa identificada.

**Não entra (2b):** pedir na mesa, a conta da mesa, "mesas abertas", isolamento de menu no pedido.

## 4. Modelo de dados

Entidade nova (separada da `Table` das reservas):
```prisma
model DineTable {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name      String   // livre, ex. "Mesa 1"
  qrToken   String   @unique @default(cuid()) // credencial do QR; única no sistema todo
  active    Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId])
}
```
Migração **aditiva** (tabela nova + a relação no `Tenant`; não toca em nada existente). Sem
backfill. `pg_dump` antes no deploy por prudência.

## 5. API

**Dono/staff (novo módulo `dine-tables`, `@Roles(OWNER, STAFF)`):**
- `GET /dine-tables` — lista as mesas de sala do tenant (por `sortOrder`).
- `POST /dine-tables` `{ name }` — cria uma mesa (gera `qrToken`).
- `POST /dine-tables/bulk` `{ count, prefix? }` — cria N mesas ("Mesa 1..N") de uma vez.
- `PATCH /dine-tables/:id` `{ name?, active? }` — edita (tenancy: `updateMany({id, tenantId})`).
- `DELETE /dine-tables/:id` — apaga (na 2a não há pedidos ligados; em 2b passará a recusar/soft se
  houver conta aberta).

**Público:**
- `GET /public/stores/:slug/mesa/:qrToken` — resolve a mesa **com slug+token juntos** e a loja
  ACTIVE/subscrição usável e a mesa `active`; devolve `{ id, name }`. **404 neutro** caso contrário.
  Não expõe nada além do nome da mesa.

## 6. QR (geração no painel)

Gerado **client-side no painel** com a biblioteca **`qrcode`** (dependência nova no dashboard;
gera data-URL/SVG no browser — sem serviço externo, sem backend de imagem). O QR codifica o URL
`${NEXT_PUBLIC_STORE_URL ?? 'https://menooo.com'}/${slug}/mesa/${qrToken}` (o `slug` vem de
`/tenants/me`; a env do URL da loja adiciona-se se não existir no dashboard). Cada mesa tem um botão
**"Imprimir QR"** que abre uma vista de impressão (o QR grande + a etiqueta "Mesa X" + o nome da loja).

## 7. Painel — sub-abas na aba Menu

Em `apps/dashboard/src/app/menu/page.tsx`, o `MenuTab` ganha `'qr'` e `'preview'`, **visíveis só
quando `menuAtivo === 'dine_in'`** (só fazem sentido no menu de Sala):
- **"QR Code"**: lista das mesas de sala (hooks novos `useDineTables` etc.); criar/editar/apagar;
  atalho "adicionar várias mesas"; por mesa, ver e **imprimir o QR**.
- **"Ver Menu"**: pré-visualizar o menu de Sala como o cliente o vê — abre, em nova aba, o URL de
  uma mesa (`/[slug]/mesa/[qrToken]` da 1ª mesa ativa). Se ainda não houver mesas, indica "cria uma
  mesa primeiro no separador QR Code".

## 8. Storefront — rota do menu da mesa

`apps/storefront/src/app/[slug]/mesa/[qrToken]/page.tsx` (+ client), ao lado de
`[slug]/reserva/[code]`:
- Resolve `GET /public/stores/:slug/mesa/:qrToken`. Se 404 → "Mesa não encontrada".
- Mostra o **menu de Sala** (via `useMenu(slug, 'dine_in')` — o endpoint já aceita `?type=dine_in`,
  Fase 1) com um cabeçalho **"Mesa X"** e o tema da loja (`StoreTheme` via `useStore(slug)`, como as
  outras páginas).
- **Só leitura** nesta fase: reaproveita a renderização de categorias/produtos do `StoreClient` **em
  modo `readOnly`** (sem botão "+", sem `ProductOptions`, sem `CartBar`). O pedir é a 2b (que liga o
  carrinho a esta mesma vista).

## 9. Testes

- **Migração** aditiva aplica sem tocar em dados (a tabela `DineTable` nasce vazia).
- **Isolamento (obrigatório):** criar mesa no restaurante A → o `qrToken` resolve com o slug de A
  (200) mas com o slug de B **→ 404**; token inexistente → 404.
- **CRUD:** criar/editar/apagar mesa; o bulk cria N; tenancy (um dono não vê/edita mesas de outro).
- **Rota pública:** `/[slug]/mesa/[qrToken]` resolve e mostra o menu de **Sala** (não o de Delivery).
- e2e novo (`e2e-dine-tables.mjs`) ou estender um existente.

## 10. Fora de âmbito / riscos

- Sem pedir, sem conta da mesa, sem "mesas abertas" (tudo 2b).
- Dependência nova (`qrcode`) só no dashboard, client-side — sem serviço externo.
- Nota deploy: migração aditiva; `pg_dump` antes.
- O `NEXT_PUBLIC_STORE_URL` no dashboard: confirmar/adicionar (build-arg) para o QR apontar para o
  storefront de produção.
