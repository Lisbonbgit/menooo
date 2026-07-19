# Dine-in Fase 1 — Catálogo de Sala (menus separados) — Design

**Data:** 2026-07-19
**Ramo:** `matheus-dine-in-fase1`
**Estado:** aprovado no brainstorming; a aguardar revisão do spec.

## 1. Contexto

O Menooo vai ganhar **pedidos na mesa por QR code** (dine-in): o cliente senta-se,
lê o QR da mesa, vê o menu no telemóvel já com a mesa identificada, pede, e o
pedido vai para a cozinha e é impresso. Isto é grande e foi dividido em fases:

- **Fase 1 (este spec):** o catálogo passa a suportar **dois menus separados** por
  loja — "Delivery" (o atual) e "Sala" (novo, independente). *Fundação: sem um menu
  de Sala, o cliente na mesa não teria o que ver.*
- **Fase 2:** QR por mesa + rota do menu da mesa + tipo de pedido dine-in + sub-abas
  "QR Code" e "Ver Menu".
- **Fase 3:** impressão em duas impressoras (caixa + cozinha).
- **Fase 4:** revamp visual do menu (Destaque, Observações por item, quantidade no modal).

**Decisões do utilizador que moldam a Fase 1:**
- Os dois menus são **totalmente separados** — categorias, produtos, preços **e**
  personalizações (grupos de opções) próprios de cada menu.
- **Não há cópia** entre menus. O menu de Sala **começa vazio** e é construído de raiz.
  (O utilizador rejeitou a cópia automática "para não dar problema".)

## 2. Âmbito

**Entra:**
- Entidade `Menu` (dois tipos: `DELIVERY`, `DINE_IN`) por loja.
- `menuId` em `Category` e `ModifierGroup`; o `Product` herda o menu da sua categoria.
- Migração aditiva que põe tudo o que existe hoje no menu Delivery e cria o menu Sala vazio.
- Endpoints de catálogo passam a ser **por menu** (mantendo o Delivery como omissão).
- Painel: seletor **Delivery / Sala** na aba Menu; tudo o que já existe passa a operar
  dentro do menu escolhido; estado vazio para a Sala.

**Não entra (fases seguintes):** QR, rota do cliente na mesa, tipo de pedido dine-in,
2 impressoras, revamp visual. **Não muda nada** para o cliente de delivery/levantamento.

## 3. Modelo de dados

Nova entidade e enum:

```prisma
enum MenuType {
  DELIVERY // o menu servido na loja online (entrega + levantamento) — o atual
  DINE_IN  // o menu servido ao cliente sentado à mesa (via QR, Fase 2)
}

model Menu {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  type      MenuType
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  categories     Category[]
  modifierGroups ModifierGroup[]

  @@unique([tenantId, type]) // exatamente um menu de cada tipo por loja
  @@index([tenantId])
}
```

Alterações a modelos existentes:
- `Category` ganha `menuId String` + relação para `Menu` (`onDelete: Cascade`) + `@@index([menuId])`.
- `ModifierGroup` ganha `menuId String` + relação para `Menu` (`onDelete: Cascade`) + `@@index([menuId])`.
- `Product` **não** ganha `menuId`. O produto pertence a uma `Category` (campo
  `categoryId`, obrigatório) e o menu do produto é o menu da sua categoria. Evita-se
  desnormalização e o risco de um produto e a sua categoria ficarem em menus diferentes.
- `ProductModifierGroup` e `Modifier`: **sem alteração** (a ligação e as opções vivem
  dentro de um produto/grupo que já estão num menu).

**Porque `Menu` como entidade (e não uma etiqueta `channel` no produto):** dá um sítio
para pôr definições próprias de cada menu no futuro, dá a constraint "um de cada tipo",
e mantém as queries limpas (`where: { menuId }`) em vez de espalhar a etiqueta por cada linha.

**Constraints de unicidade:** nem `Category` nem `Product` têm hoje unicidade por nome
(confirmado no schema — só `@@index`), por isso **não há unique constraint para reescrever**;
os dois menus podem ter uma categoria "Pizzas" sem colisão.

## 4. Migração (aditiva, preserva dados, re-executável)

Migração Prisma com SQL manual (o `@default(cuid())` **não** cria default na BD — todo o
INSERT em SQL tem de sintetizar o id, lição da R4). Passos, por esta ordem:

1. `CREATE TYPE "MenuType" AS ENUM ('DELIVERY','DINE_IN');`
2. `CREATE TABLE "Menu" (...)` com o `@@unique([tenantId, type])`.
3. Inserir **um menu de cada tipo por cada tenant**, com ids **determinísticos** para o
   INSERT ser re-executável:
   ```sql
   INSERT INTO "Menu" ("id","tenantId","type","createdAt","updatedAt")
   SELECT 'mnu_dlv_' || t.id, t.id, 'DELIVERY', now(), now() FROM "Tenant" t
   ON CONFLICT ("tenantId","type") DO NOTHING;
   INSERT INTO "Menu" ("id","tenantId","type","createdAt","updatedAt")
   SELECT 'mnu_din_' || t.id, t.id, 'DINE_IN', now(), now() FROM "Tenant" t
   ON CONFLICT ("tenantId","type") DO NOTHING;
   ```
4. `Category`: `ADD COLUMN "menuId" TEXT;` → `UPDATE "Category" c SET "menuId" =
   'mnu_dlv_' || c."tenantId";` → `ALTER COLUMN "menuId" SET NOT NULL;` + FK + índice.
5. `ModifierGroup`: igual ao ponto 4 (backfill para o menu Delivery da sua loja).

Resultado: **todo o catálogo de hoje fica no menu Delivery**; o menu Sala existe e está
vazio. A loja online continua a servir exatamente o mesmo. No deploy: `pg_dump` antes
(regra do projeto).

## 5. API

**Princípio:** o cliente nunca envia um `menuId` cru — envia o **tipo** (`delivery` |
`dine_in`); o serviço resolve o `menuId` a partir de `(tenantId, type)`. Assim não há
risco de referências cruzadas entre lojas.

Endpoints autenticados (`@Roles(OWNER,STAFF)`), com o menu como parâmetro (query
`?menu=delivery|dine_in`, **omissão = `delivery`** para retrocompatibilidade):
- `GET /catalog/categories?menu=` — categorias do menu.
- `POST /catalog/categories` — cria no menu indicado (campo `menu` no corpo).
- `PUT /catalog/categories/reorder` — reordena dentro de **um** menu (valida que todos os
  ids pertencem ao mesmo menu da loja).
- `PATCH/DELETE /catalog/categories/:id` — o menu deriva da categoria (o `:id` já a fixa).
- `GET /catalog/products?menu=` — produtos do menu (`where: { category: { menuId } }`).
- `POST /catalog/products` — o menu deriva da `categoryId` enviada (a categoria já está num menu).
- `PUT /catalog/products/reorder` — dentro de uma categoria (já é por menu).
- `GET/PATCH/DELETE /catalog/products/:id` — menu deriva do produto.
- `GET /catalog/modifier-groups?menu=` / `POST /catalog/modifier-groups` (campo `menu`) —
  biblioteca de opções **por menu**.
- attach/detach de grupo e CRUD de modifiers: sem parâmetro novo (derivam do produto/grupo).

**Endpoint público:** `GET /public/stores/:slug/menu?type=delivery|dine_in` — **sem `type`
devolve o Delivery** (o storefront atual não muda). `type=dine_in` fica pronto para a Fase 2.

**Guardas de integridade (no serviço):**
- Criar categoria/grupo num menu resolve o menu por `(tenantId, type)` — 404 se o tipo for inválido.
- **Anexar um grupo a um produto** exige que o grupo e o produto estejam no **mesmo menu**
  (o menu do produto = menu da sua categoria); senão 400.
- **Mudar a categoria de um produto** (editar) só permite categorias do **mesmo menu** do
  produto; o dropdown de categorias no modal só mostra as do menu atual, e o backend valida.

## 6. Painel (dashboard)

`apps/dashboard/src/app/menu/page.tsx`:
- Um **seletor de menu** no topo — **Delivery / Sala** — controla um estado `menuAtivo`.
- As queries `useCategories`, `useProducts`, `useModifierGroups` passam a receber o menu
  ativo e a incluí-lo na `queryKey` (trocar de menu refaz a query, sem misturar caches).
- As duas sub-abas atuais (Vista geral, Personalizações) mantêm-se, agora **dentro** do
  menu selecionado (a Personalizações também é por menu).
- Estado vazio da Sala: *"Ainda não há nada no menu de Sala — cria a primeira categoria."*
- O modal de editar produto: o dropdown de categoria mostra só as categorias do menu atual.

Sem alterações no `AppShell`/navegação lateral (o QR e as sub-abas "QR Code"/"Ver Menu"
são da Fase 2).

## 7. Compatibilidade / não-regressão

- O storefront de delivery (`apps/storefront`) **não muda** — chama `GET
  /public/stores/:slug/menu` sem `type` e recebe o Delivery, igual a hoje.
- O painel e a API entram no mesmo deploy; enquanto a omissão for `delivery`, nada parte
  se algum pedido antigo não enviar o menu.
- Scripts de dados afetados (têm de atribuir o menu Delivery): `apps/api/prisma/seed.ts` e
  `apps/api/scripts/refresh-demo.mjs` (criam categorias/produtos) — passam a criar/usar o
  menu Delivery da loja.

## 8. Testes

- **Migração preserva dados:** depois de migrar, a contagem de categorias e produtos no
  menu Delivery é igual à de antes; nenhum produto/categoria fica órfão (todos com `menuId`).
- **Isolamento entre menus:** criar uma categoria/produto/grupo na Sala **não** aparece no
  Delivery, e vice-versa (query por menu).
- **Guardas:** anexar um grupo da Sala a um produto do Delivery → 400; mudar um produto para
  uma categoria de outro menu → 400.
- **Retrocompatibilidade pública:** `GET /public/stores/:slug/menu` (sem `type`) devolve
  exatamente o menu que devolvia antes da Fase 1.
- **`e2e-catalogo`:** atualizado para exercitar o scoping por menu (criar na Sala, confirmar
  que o Delivery fica intacto), mantendo os testes atuais verdes.
- Validar sempre por mutação (um teste verde não vale até se o ver vermelho pela razão certa).

## 9. Fora de âmbito (fases seguintes)

QR por mesa, rota `/loja/mesa/...`, tipo de pedido `DINE_IN`, ligação pedido↔mesa, sub-abas
"QR Code"/"Ver Menu", 2 impressoras, e o revamp visual (Destaque, Observações por item,
quantidade no modal). Nada disto é tocado na Fase 1.

## 10. Riscos e decisões

- **Migração de FK obrigatória com backfill** é o ponto mais sensível — mitigada por: ids
  determinísticos + `ON CONFLICT DO NOTHING` (re-executável), `pg_dump` antes, e o teste de
  preservação de dados. Toda a base de produção (lojas reais) tem de ficar no Delivery.
- **`Product` sem `menuId`** (deriva da categoria): decisão consciente para evitar
  desnormalização; o custo é filtrar produtos por `category: { menuId }` (join), aceitável.
- **Personalizações por menu**: aumenta a gestão (a biblioteca de opções é por menu), mas foi
  a escolha do utilizador (menus totalmente separados). A aba Personalizações segue o seletor.
- O menu Delivery cobre **entrega e levantamento** (a etiqueta "Delivery" é só o nome visível;
  ajustável).
