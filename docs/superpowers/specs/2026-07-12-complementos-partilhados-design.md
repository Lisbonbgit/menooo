# Grupos de complementos reutilizáveis

**Data:** 2026-07-12 · **Estado:** aprovado pelo Matheus

## Objetivo

Hoje os grupos de opções (`ModifierGroup`, ex.: "Tamanho", "Extras") são criados
produto a produto. Passar ao modelo das plataformas de delivery: o grupo
cria-se uma vez na biblioteca do restaurante e anexa-se a vários produtos.
Mudar uma opção ou um preço na biblioteca reflete-se em todos os produtos que
usam o grupo.

## Decisões do utilizador

1. **Gestão por abas na página Menu do dashboard:** aba "Vista geral"
   (categorias/produtos, como hoje) e aba "Personalizações" (biblioteca de
   grupos de complementos).
2. **Edição só na biblioteca:** dentro do produto apenas se anexa/desanexa;
   opções e preços editam-se na aba Personalizações.
3. **Sem overrides por produto:** grupo igual = opções e preços iguais em
   todos os produtos. Casos diferentes = grupos diferentes.

## Modelo de dados (Prisma)

- `ModifierGroup`: perde `productId`/`product`; ganha `tenantId` + relação
  `Tenant` (onDelete: Cascade) e `@@index([tenantId])`. Mantém `name`,
  `required`, `minSelect`, `maxSelect`. O `sortOrder` do grupo deixa de fazer
  sentido no grupo e passa para a ligação.
- Novo modelo `ProductModifierGroup`:
  `{ id, productId → Product (Cascade), groupId → ModifierGroup (Cascade),
  sortOrder Int @default(0) }`, com `@@unique([productId, groupId])` e índices
  por `productId` e `groupId`.
- `Modifier` inalterado (pertence ao grupo).
- Encomendas inalteradas (`OrderItemModifier` já é snapshot de nome+preço).

### Migração (data-preserving, uma migração SQL)

1. Criar tabela `ProductModifierGroup`; adicionar `tenantId` NULL a
   `ModifierGroup`.
2. Backfill: `tenantId` copiado do produto dono; uma linha de junção por
   grupo existente (`sortOrder` herdado do grupo).
3. `tenantId` passa a NOT NULL; remover coluna `productId`.

Resultado: cada grupo atual vira grupo da biblioteca já anexado ao seu
produto (1:1). Comportamento das lojas no dia da migração: inalterado.

## API (módulo catalog)

**Biblioteca (tenant-scoped, roles OWNER/STAFF como hoje):**
- `GET /catalog/modifier-groups` — lista com `modifiers` e `usedIn`
  (contagem de produtos via junção).
- `POST /catalog/modifier-groups` — `{ name, required?, maxSelect? }`.
- `PATCH /catalog/modifier-groups/:id` — mesmos campos.
- `DELETE /catalog/modifier-groups/:id` — apaga grupo + opções + ligações
  (cascade). A UI avisa quando `usedIn > 0`.
- CRUD de `modifiers` mantém rotas atuais; a verificação de tenant passa a
  ser via `group.tenantId` (era via `group.product.tenantId`).

**Ligações:**
- `POST /catalog/products/:productId/modifier-groups/:groupId` — anexa
  (`sortOrder` = fim da lista). Par duplicado → 409.
- `DELETE /catalog/products/:productId/modifier-groups/:groupId` — desanexa.
- A rota antiga `POST /catalog/products/:productId/modifier-groups`
  (criar grupo dentro do produto) é removida — criar é na biblioteca.

**Leitura (sem quebrar consumidores):** `getProduct`, o catálogo público
(`public-catalog`) e o `include` do `orders.service` passam a ler os grupos
via junção, mas devolvem o MESMO formato JSON de hoje
(`modifierGroups: [{ id, name, required, minSelect, maxSelect, modifiers: [...] }]`,
ordenado pelo `sortOrder` da ligação). Storefront não muda.

## Dashboard (página Menu)

**Abas** no topo: `Vista geral` | `Personalizações` (estado local, sem rota nova).

**Vista geral** — como hoje, exceto o painel "Opções" do produto:
- Lista os grupos anexados: nome, badges (obrigatório / até N) e resumo das
  opções em chips **só de leitura** (nome + preço).
- "**+ Anexar grupo**": seletor com os grupos da biblioteca ainda não
  anexados a este produto.
- Desanexar (X) com confirmação leve (não apaga o grupo).
- Atalho "Editar na biblioteca" muda para a aba Personalizações.
- Estado vazio: explica que os grupos se criam na aba Personalizações.

**Personalizações** — a biblioteca:
- Form de criação no topo (nome, obrigatório, máx. escolhas) — o mesmo
  formulário que hoje existe dentro do produto.
- Cartão por grupo: nome (editável), badges, chips de opções com o
  interaction pattern atual (`AddModifierChip`, apagar no X), badge
  "usado em N produtos" (0 = "sem produtos").
- Apagar grupo: confirm com aviso do nº de produtos afetados.

**Código:** `menu/page.tsx` (582 linhas) divide-se: a biblioteca vai para um
componente novo `menu/PersonalizacoesTab.tsx` (ou pasta `_components`),
mantendo a página como composição das duas abas. Hooks novos em
`catalog-hooks`: `useModifierGroups`, `useCreateModifierGroup` (novo alvo),
`useUpdateModifierGroup`, `useDeleteModifierGroup`, `useAttachGroup`,
`useDetachGroup`; invalidação cruzada (mexer na biblioteca invalida
`product-detail`).

## Erros e casos-limite

- Anexar duplicado → 409 da API; UI esconde grupos já anexados do seletor.
- Apagar grupo em uso → confirm explícito com contagem; desanexa por cascade.
- Grupo órfão (0 produtos) é válido — fica na biblioteca.
- Checkout: validação de `modifierIds` continua a ser contra os grupos do
  produto (agora via junção); IDs de modifiers não mudam na migração.

## Fora de âmbito

- Overrides de preço por produto; reordenação drag-and-drop dos grupos no
  produto (a API aceita `sortOrder`, a UI ordena por ordem de anexação);
  duplicar/fundir grupos automaticamente na migração.

## Critérios de sucesso

- Criar "Extras" uma vez, anexar a 3 produtos, e as opções aparecem nos 3 na
  loja; mudar um preço na biblioteca muda nos 3.
- Encomenda com opções valida, calcula e imprime como hoje.
- Migração corre no VPS sem tocar nas encomendas nem mudar a loja pública.
- typecheck + build verdes nos 3 apps.
