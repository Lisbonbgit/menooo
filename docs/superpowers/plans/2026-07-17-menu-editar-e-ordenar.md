# Menu — editar artigos por completo + ordenar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** No painel do menu, editar todos os campos de um artigo já criado (nome, preço, categoria, IVA, imagem, ativo) por um modal, e escolher a ordem de itens e categorias por setas ↑↓ (principal) + arrastar (extra), gravada em lote.

**Architecture:** Aditivo. O backend já aceita alterar tudo (`UpdateProductDto`/`UpdateCategoryDto`) e já tem `sortOrder`; a montra já ordena por ele. Novo: um endpoint de reordenação em lote (transação, lista completa, tenancy dentro da transação — espelha o `setLayout` da R4). Frontend: formulário de produto em modo criar+editar, edição inline do nome da categoria, e reordenação otimista com a forma de mutação do FloorMap.

**Tech Stack:** NestJS 10 + Prisma 6 · Next.js (App Router) + react-query + axios · scripts e2e em node puro.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-17-menu-editar-e-ordenar-design.md`. Em dúvida, o spec manda.
- **PT-PT** na copy visível e nos comentários.
- **A ordem (`sortOrder`) é dona EXCLUSIVA do caminho de reordenar.** O modal de edição **NUNCA
  envia `sortOrder`**; o reorder **NUNCA** é tocado pelo PATCH de edição.
- **Armadilha do `undefined` (3ª vez neste projeto):** no modal, campos de texto limpos vão como
  `''`, nunca `undefined` — senão o `JSON.stringify` deita a chave fora, o backend mantém o valor
  antigo e a UI mente «sucesso». O `AddProductForm` faz hoje `description || undefined` (linha ~483);
  o modo edição **não** herda esse idioma.
- **Reorder = lista COMPLETA.** O endpoint exige todos os itens da categoria/tenant; um subconjunto
  deixa os omitidos com `sortOrder` a colidir. O painel renderiza a categoria inteira (ativos +
  inativos), logo pode sempre mandar a lista toda.
- **Rota `PUT` (não `@Patch`), declarada ANTES das `:id`** — senão o Nest resolve `reorder` como
  `:id` → 404 (a armadilha do `tables/layout`).
- **Tenancy dentro da transação** com `updateMany({ id, tenantId })` (não há unique composto).
- **Ambiente:** `export PATH="$HOME/.local/node/bin:$PATH"`. Postgres :5433. Demo: `dono@pizzaria-demo.pt` / `demo1234`. Antes do e2e: `pkill -9 -f "dist/main"`, rebuild, um de cada vez, limpar a demo.
- **NUNCA** contra produção. **NUNCA** deploy. **NUNCA** `git push`.

---

## File Structure

**API — modificar**
- `apps/api/src/modules/catalog/catalog.service.ts` — `reorderCategories`, `reorderProducts`; `updateProduct` (recolocar no fim ao mudar categoria) à volta de `:105`
- `apps/api/src/modules/catalog/catalog.controller.ts` — rotas `PUT …/reorder` **antes** das `:id` (`:66,76`)
- `apps/api/src/modules/catalog/dto/` — `ReorderCategoriesDto`, `ReorderProductsDto`
- `apps/api/scripts/` — e2e do catálogo (novo ou acrescentar)

**Dashboard — modificar**
- `apps/dashboard/src/app/menu/page.tsx` — form em modo criar+editar (`AddProductForm:462`), botão Editar no `ProductRow:176`, nome de categoria inline (`:133`), reordenação nas listas (`:133`, `:159`)
- `apps/dashboard/src/lib/catalog-hooks.ts` — `useReorderProducts`, `useReorderCategories` (mutação estilo FloorMap)

---

### Task 1: Backend — reorder em lote (transação, completo, tenancy)

**Files:**
- Modify: `catalog.service.ts`, `catalog.controller.ts`, `dto/`

**Interfaces:**
- Produces: `reorderCategories(tenantId, ids): Promise<{reordered}>`, `reorderProducts(tenantId, categoryId, ids)`
- Produces: `PUT catalog/categories/reorder {ids}`, `PUT catalog/products/reorder {categoryId, ids}`

- [ ] **Step 1: Teste e2e que falha — lista incompleta → 400**

O invariante central: mandar um **subconjunto** dos IDs tem de dar 400 (senão baralha a ordem).

```js
// pré: uma categoria com 3 produtos [p1,p2,p3]
// reorder com a lista completa mas trocada → 200 e a ordem inverte
check('reorder completo → 200', (await reorderProducts(catId, [p3,p2,p1])).status === 200);
// reorder com só 2 dos 3 → 400
check('reorder INCOMPLETO → 400', (await reorderProducts(catId, [p1,p2])).status === 400);
```

- [ ] **Step 2: DTOs** (`ReorderCategoriesDto {ids}`, `ReorderProductsDto {categoryId, ids}` — código no spec §3).

- [ ] **Step 3: Serviço** — `reorderCategories`/`reorderProducts` com count+updateMany DENTRO da transação, exigindo `owned === ids.length === total` (código exato no spec §3).

- [ ] **Step 4: Rotas** — `PUT('categories/reorder')` e `PUT('products/reorder')` **antes** das `@Get/@Patch('products/:id')` (linhas 66/76). Herdam o `@Roles(OWNER,STAFF)` de classe.

- [ ] **Step 5: Correr + Commit**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
pkill -9 -f "dist/main"; pnpm --filter @comanda/api build && (node --enable-source-maps apps/api/dist/main &)
node apps/api/scripts/<e2e-catalogo>.mjs   # o incompleto → 400, o completo → 200
git add -A && git commit -m "feat(menu): reorder em lote de produtos e categorias (T1)"
```

---

### Task 2: Backend — mudar de categoria recoloca no fim

**Files:**
- Modify: `catalog.service.ts` (`updateProduct:105`)

- [ ] **Step 1: Teste que falha** — mover um produto para uma categoria com produtos em 0..2 tem de o pôr em `sortOrder = 3` (fim), não empatado.

```js
// p vem de sortOrder=5 na categoria A; move-se para B (que tem sortOrder 0,1,2)
await updateProduct(p, { categoryId: B });
// p em B tem de ficar no fim (sortOrder 3), não a meio/empatado
```

- [ ] **Step 2: Implementar** — em `updateProduct`, quando `dto.categoryId` muda a categoria:

```ts
async updateProduct(tenantId: string, id: string, dto: UpdateProductDto) {
  const data: Prisma.ProductUpdateInput = { ...dto };
  // Mudar de categoria: o sortOrder vinha numerado na categoria de ORIGEM. Recolocar no FIM da
  // destino, senão o produto aterra empatado/aleatório (o desempate é por name/id).
  if (dto.categoryId) {
    const atual = await this.prisma.product.findFirst({ where: { id, tenantId }, select: { categoryId: true } });
    if (atual && atual.categoryId !== dto.categoryId) {
      const last = await this.prisma.product.aggregate({
        where: { tenantId, categoryId: dto.categoryId }, _max: { sortOrder: true },
      });
      data.sortOrder = (last._max.sortOrder ?? -1) + 1;
    }
  }
  return this.prisma.product.update({ where: { id }, data, /* … o resto como está */ });
}
```

> Cuidado: manter o resto do `updateProduct` como está (o `where`/`include` atuais). Só acrescentar
> o cálculo do `sortOrder` no caso de troca de categoria.

- [ ] **Step 3: Correr + Commit**

```bash
node apps/api/scripts/<e2e-catalogo>.mjs
git add -A && git commit -m "feat(menu): mudar de categoria recoloca o produto no fim (T2)"
```

---

### Task 3: Frontend — modal de editar produto (todos os campos)

**Files:**
- Modify: `apps/dashboard/src/app/menu/page.tsx`, `apps/dashboard/src/lib/catalog-hooks.ts`

- [ ] **Step 1: Form em dois modos**

Generalizar o `AddProductForm` (linha ~462) para `ProductForm({ mode: 'create' | 'edit', product?, categoryId? })`:
- **create:** como hoje (categoryId por prop, sem picker).
- **edit:** acrescenta o **select de categoria** (as `categories.data`), o `ImageUploader` (onChange
  → **estado local**, guarda diferido — não `mutateAsync` imediato como no `ProductRow:202`), e o
  toggle **ativo**. Pré-preenche do `product`, convertendo o preço decimal para string com vírgula.

- [ ] **Step 2: O payload do PATCH — as duas regras**

```ts
// campos limpos vão como '' (nunca undefined) E o sortOrder NUNCA é enviado (é do reorder)
const payload = {
  name: name.trim(),
  price: parseFloat(price.replace(',', '.')),
  vatRate,
  description: description.trim(),          // '' quando vazio, não undefined
  categoryId,
  imageUrl: imageUrl ?? '',
  active,
  // sem sortOrder — de propósito
};
await updateProduct.mutateAsync({ id: product.id, ...payload });
```

- [ ] **Step 3: Botão "Editar" no `ProductRow`** (linha ~176) que abre o modal com o `product`.

- [ ] **Step 4: typecheck + Commit**

```bash
pnpm --filter @comanda/dashboard exec tsc --noEmit
git add -A && git commit -m "feat(menu): modal de editar produto com todos os campos (T3)"
```

---

### Task 4: Frontend — reordenar (setas principal, arrastar extra)

**Files:**
- Modify: `apps/dashboard/src/app/menu/page.tsx`, `apps/dashboard/src/lib/catalog-hooks.ts`

- [ ] **Step 1: Hooks de reorder — forma do FloorMap `saveLayout`**

```ts
export function useReorderProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { categoryId: string; ids: string[] }) =>
      (await api.put(`/catalog/products/reorder`, v)).data,
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['products'] });
      const prev = qc.getQueryData(['products']);
      // REORDENAR o array (não só reatribuir sortOrder — a lista é .filter() sem sort no cliente)
      qc.setQueryData(['products'], (old: Product[] = []) => reorderInList(old, v.categoryId, v.ids));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['products'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}
```

`reorderInList` reordena fisicamente os produtos da categoria pela ordem dos `ids`, mantendo os das
outras categorias. `useReorderCategories` é igual, sobre `['categories']`.

- [ ] **Step 2: Setas ↑↓ (o caminho principal)**

Em cada `ProductRow` e em cada cabeçalho de categoria, setas ↑↓ que trocam com o vizinho e chamam
o reorder com a **lista completa** reindexada. **Desativar as setas enquanto a mutação está
`isPending`** (serializar — dois reorders concorrentes fazem a lista piscar).

- [ ] **Step 3: Arrastar (extra, rato + touch)**

`pointer events` + `setPointerCapture`, com o **long-press-para-armar (~280ms) + `touchmove`
não-passivo com `preventDefault`** do `FloorMap` (senão o touch faz scroll da página em vez de
arrastar). Ao largar, mesma mutação das setas.

- [ ] **Step 4: typecheck + Commit**

```bash
pnpm --filter @comanda/dashboard exec tsc --noEmit
git add -A && git commit -m "feat(menu): reordenar por setas + arrastar, otimista (T4)"
```

---

### Task 5: Frontend — nome de categoria inline

**Files:**
- Modify: `apps/dashboard/src/app/menu/page.tsx` (cabeçalho da categoria, linha ~133)

- [ ] **Step 1:** No cabeçalho da categoria (flex row com `h2` + contador + lixo), um lápis que troca
  o `h2` por um `input`, espelhando a edição inline da descrição do `ProductRow` (linhas ~213-241).
  "Guardar" → `PATCH catalog/categories/:id { name }`.

- [ ] **Step 2: typecheck + Commit**

```bash
pnpm --filter @comanda/dashboard exec tsc --noEmit
git add -A && git commit -m "feat(menu): editar o nome da categoria inline (T5)"
```

---

### Task 6: E2e + verificação em browser

**Files:**
- Modify: `apps/api/scripts/<e2e-catalogo>.mjs`

- [ ] **Step 1: Casos** (spec §6): editar muda nome+preço+categoria e persiste; **limpar descrição →
  lê vazia** (a armadilha do undefined); mudar categoria → `sortOrder = max+1`; reorder completo
  grava; **reorder incompleto → 400**; ID de outro tenant → 400; ID de outra categoria → 400; a
  montra pública reflete a ordem.

- [ ] **Step 2: Correr** — o e2e do catálogo + o de reservas (regressão) + kitchen, ambiente limpo, um de cada vez.

- [ ] **Step 3: Browser (obrigatório)** — editar pelo modal (nome+preço+categoria + **limpar
  descrição**); as **setas** a mover produto e categoria, sobreviver ao F5; arrastar um produto
  (rato); a ordem na loja pública; e um **modal aberto antes de um arrasto**, ao gravar, **não**
  desfaz a ordem.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(menu): e2e + verificação do editar/ordenar (T6)"
```

---

## Notas de rollout

- Sem migração — usa colunas que já existem.
- Deploy junto com o cancelar-por-email (features independentes, um só deploy). O host é nomeado pelo utilizador.
