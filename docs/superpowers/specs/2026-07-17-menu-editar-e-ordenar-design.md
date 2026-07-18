# Menu — editar artigos por completo e ordenar itens/categorias

**Data:** 2026-07-17
**Ramo:** a criar, a partir do estado em produção
**Estado:** design aprovado pelo utilizador; falta revisão adversarial + revisão final

> Dois buracos no painel do menu: (1) um artigo já criado só deixa mudar descrição/imagem/IVA —
> não o **nome**, o **preço** nem a **categoria**; (2) não há forma de escolher a ordem dos itens
> nem das categorias. O backend já suporta ambos — falta o painel.

## 1. O que já existe (não tocar)

Verificado no código, não assumido:

- **`UpdateProductDto`** (`catalog/dto/product.dto.ts`) já aceita `name, description, price,
  vatRate, imageUrl, categoryId, sortOrder, active` — **todos** os campos.
- **`UpdateCategoryDto`** já aceita `name, sortOrder`.
- **`Product.sortOrder`** e **`Category.sortOrder`** já existem no schema (`Int @default(0)`).
- **`PATCH catalog/products/:id`** e **`PATCH catalog/categories/:id`** já existem.
- A **montra pública** já ordena por `sortOrder` — a ordem definida no painel reflete-se na loja
  sem mais nada.

Logo, esta mudança é **sobretudo painel**, mais **um** endpoint de backend (reordenação em lote).

## 2. Decisões (aprovadas)

| Tema | Decisão |
|---|---|
| Editar artigo | botão **"Editar"** → **modal** pré-preenchido com **todos** os campos |
| Ordenar | **arrastar** ↑↓ (itens dentro da categoria, e categorias entre si) + **setas** ↑↓ como alternativa fiável no telemóvel |
| Gravar a ordem | **endpoint de reordenação em lote**, numa transação (não N PATCHs individuais) |
| Edição inline atual (descrição/imagem) | **mantém-se** — é um atalho cómodo, não custa nada |

## 3. Backend — o endpoint novo (reordenação em lote)

Só isto é novo no backend. Dois endpoints. **O `CatalogController` já tem `@UseGuards(RolesGuard)
+ @Roles(OWNER, STAFF)` a nível de classe** (verificado) — os métodos novos herdam a proteção; um
`@Roles` por método é redundante (ao contrário do controller de reservas, que os redeclara). Não
é preciso, mas não faz mal.

```ts
// PUT catalog/categories/reorder   { ids: string[] }
// PUT catalog/products/reorder     { categoryId: string, ids: string[] }
```

> **`PUT`, e declarado ANTES das rotas `:id`.** O módulo usa `@Patch` por convenção — se alguém
> trocar para `@Patch('products/reorder')`, fica sombreado por `@Patch('products/:id')` (que o Nest
> regista primeiro) → `:id = 'reorder'` → 404. É a mesma armadilha do `tables/layout` da R4. Manter
> `PUT` e declarar a rota **antes** das `:id`.

**`ReorderDto`:**

```ts
export class ReorderCategoriesDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) ids!: string[];
}
export class ReorderProductsDto {
  @IsString() @IsNotEmpty() categoryId!: string;   // reordena DENTRO de uma categoria
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) ids!: string[];
}
```

**Serviço** — espelha o `setLayout` da R4 (`reservations.service.ts`): **count e updates DENTRO da
mesma transação**, `updateMany({ id, tenantId })` como segunda barreira de tenant (não há unique
composto `(id, tenantId)`, logo o `update({ where: { id } })` solto escreveria por id sem rede), e
**exige a lista COMPLETA** — não um subconjunto.

```ts
async reorderCategories(tenantId: string, ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new BadRequestException('IDs repetidos.');
  return this.prisma.$transaction(async (tx) => {
    // COMPLETUDE: a lista tem de trazer TODAS as categorias do tenant. Um subconjunto deixaria as
    // omitidas com o sortOrder antigo, a colidir com os índices 0..n-1 → ordem baralhada, sem erro.
    const total = await tx.category.count({ where: { tenantId } });
    const owned = await tx.category.count({ where: { id: { in: ids }, tenantId } });
    if (owned !== ids.length || owned !== total) {
      throw new BadRequestException('A lista tem de conter todas as categorias, sem repetidos.');
    }
    for (const [i, id] of ids.entries()) {
      await tx.category.updateMany({ where: { id, tenantId }, data: { sortOrder: i } });
    }
    return { reordered: ids.length };
  });
}
```

`reorderProducts` é igual, mas o `total`/`owned` filtram por `categoryId` (todos os produtos
**daquela** categoria — o painel renderiza a categoria inteira, ativos e inativos, logo pode sempre
mandar a lista completa). Impede reordenar para uma categoria de outro tenant, misturar IDs de
categorias diferentes, ou deixar produtos de fora.

> **Porquê lote e não N PATCHs:** arrastar um item para o topo mexe no `sortOrder` de **todos** os
> que estão acima. N PATCHs teriam estado intermédio visível (dois itens com o mesmo `sortOrder`
> por um instante) e, se um falhasse a meio, a ordem ficava baralhada. A transação grava tudo ou
> nada. É o padrão do `PUT /tables/layout` da R4.

## 4. Frontend — editar (modal)

Em `apps/dashboard/src/app/menu/page.tsx`:

- **Formulário de produto em dois modos (criar + editar).** O `AddProductForm` (linha ~462) tem
  nome/preço/IVA/descrição, com o `categoryId` fixo por prop e **sem** picker de categoria, imagem
  ou ativo. Não é um *lift* limpo: o componente partilhado **ramifica por modo** — em edição
  acrescenta o **select de categoria**, o `ImageUploader` e o toggle **ativo**. O preço é estado em
  string com vírgula (`parseFloat(price.replace(',', '.'))`) — na edição, pré-preencher convertendo
  a string decimal da API.
- Cada **`ProductRow`** ganha um botão **"Editar"** que abre o modal pré-preenchido. "Guardar" →
  `PATCH catalog/products/:id`.

> ⚠️ **Duas regras do payload do modal — as duas já morderam este projeto:**
>
> 1. **Campos de texto limpos vão como `''`, NUNCA `undefined`.** O `AddProductForm` faz hoje
>    `description: description.trim() || undefined` (linha 483). Se o modal de edição herdar esse
>    idioma, **limpar** a descrição de um produto omite a chave no PATCH → o backend mantém a
>    antiga e a UI diz «sucesso» sem mudar nada (a armadilha do `undefined`, 3ª vez). No modo
>    edição, o texto vazio é `''`.
> 2. **O modal NÃO envia `sortOrder`.** A ordem é dona **exclusiva** do caminho de arrastar (§5).
>    Um modal aberto antes de um arrasto captura o `sortOrder` velho; ao gravar, «arrancaria» o
>    produto de volta à posição antiga. O payload leva só os campos do formulário — `name`,
>    `price`, `vatRate`, `description`, `categoryId`, `imageUrl`, `active` — e **omite `sortOrder`**
>    (o único campo onde o omitir é o certo). Idem para o `active` da forma: é o toggle do modal que
>    manda, não o Eye da linha, se ambos existirem.

> **Mudar de categoria no modal recoloca o produto no fim da nova.** O `updateProduct` faz
> `data: dto` sem tocar no `sortOrder`, logo um produto que vinha de `sortOrder=4` aterra a meio (ou
> empatado) na categoria de destino. → no `updateProduct`, **quando o `categoryId` muda**, pôr o
> produto no fim: `sortOrder = (max sortOrder da categoria destino) + 1`. Assim aparece previsível
> (último), e o dono reordena depois se quiser.

- **Editar categoria:** o nome passa a ser editável (o `UpdateCategoryDto` já aceita `name`) —
  inline, espelhando o padrão da edição inline da descrição que já existe no `ProductRow` (o
  cabeçalho da categoria é um flex row com espaço para trocar o `h2` por um input). Sem modal.

## 5. Frontend — ordenar (arrastar + setas)

**As setas ↑↓ são o caminho PRINCIPAL; o arrastar é o extra.** O menu é uma lista vertical com
scroll da página, e arrastar na vertical disputa o **mesmo eixo** do scroll — pior que no
`FloorMap` (que arrasta numa tela 2D de tamanho fixo, só com scroll horizontal). As setas são à
prova de bala em qualquer ecrã; o arrastar é conforto no rato.

- **Setas ↑↓** em cada linha (produto e categoria): sobem/descem uma posição. É o caminho fiável.
- **Arrastar (rato + touch):** `pointer events` + `setPointerCapture`, mas **com o long-press para
  armar (~280ms) e o `touchmove` não-passivo com `preventDefault`** que o `FloorMap` usa (linhas
  352-392) — sem isto, num touch a lista faz scroll em vez de arrastar. Não é um *drop-in* do
  FloorMap; é preciso portar essa parte.
- **Ambos gravam pelo mesmo endpoint** e enviam a **lista completa** da categoria (o backend
  exige-o, §3). Como todos os `sortOrder` estão a **0 hoje** (confirmado — a criação nunca envia
  `sortOrder`), o primeiro gesto de cada lista estabelece a base reindexando tudo.

**Mutação otimista — copiar a forma do `saveLayout` do FloorMap, não o `onSuccess: invalidate`
simples:**

- `onMutate`: `cancelQueries` + snapshot + `setQueryData` que **reordena mesmo o array** (o
  `productsByCategory` é um `.filter()` sem `.sort()` no cliente — reescrever só o `sortOrder` nos
  objetos **não muda a ordem visível**; a lista ficaria congelada até o refetch e depois saltava).
- `onError`: rollback do snapshot + toast.
- `onSettled`: `invalidateQueries`.
- **Serializar:** desativar as setas / bloquear novo commit de arrasto enquanto um `PUT` está em
  curso — dois reorders concorrentes correm no `sortOrder` final e fazem a lista piscar
  ordem2→ordem1→ordem2.

## 6. Testes

- **E2e (`e2e-*.mjs` do catálogo, ou acrescentar ao existente):**
  - editar um produto muda **nome, preço e categoria** (os três que hoje não davam) e persiste;
  - **limpar a descrição** (enviar `''`) → lê de volta vazia (prova que não vira `undefined` — a
    armadilha nomeada; sem este teste a regressão passa despercebida);
  - **mudar de categoria** recoloca o produto no **fim** da nova (`sortOrder = max+1`, não empatado);
  - `PUT products/reorder` com a lista COMPLETA grava o `sortOrder` pela ordem dada; ler confirma;
  - `PUT categories/reorder` idem;
  - **reorder com lista INCOMPLETA (subconjunto) → 400** (o invariante da completude);
  - reorder com um ID de **outro tenant** → 400 (tenancy);
  - reorder de produtos com um ID de **outra categoria** → 400;
  - a montra pública reflete a ordem nova (lê `sortOrder`).
- **Regressões:** criar produto, a edição inline de descrição/imagem/IVA, e a montra continuam a
  funcionar.
- **Browser (obrigatório):** editar um produto pelo modal (mudar nome+preço+categoria + **limpar a
  descrição**), ver na lista; **as setas ↑↓** a mover produto e categoria e a sobreviver ao F5;
  arrastar um produto (rato); confirmar a ordem na loja pública; e que um modal aberto **antes** de
  um arrasto, ao gravar, **não** desfaz a ordem (não envia `sortOrder`).

## 7. Fora de âmbito

Mover um produto para outra categoria **por arrastar** (faz-se pelo modal, campo categoria) ·
ordenar os grupos de personalização · reordenar por número escrito à mão (o arrastar+setas
cobre) · undo do arrastar.
