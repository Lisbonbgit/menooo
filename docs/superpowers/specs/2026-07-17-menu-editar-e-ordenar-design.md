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

Só isto é novo no backend. Dois endpoints, `OWNER/STAFF` (o `RolesGuard` falha aberto — o
decorador é obrigatório), tenancy pelo `@TenantId()`:

```ts
// PUT catalog/categories/reorder   { ids: string[] }
// PUT catalog/products/reorder     { categoryId: string, ids: string[] }
```

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

**Serviço** — atribui `sortOrder = índice`, numa transação, validando que os IDs são **todos** do
tenant (e, nos produtos, todos da categoria dada):

```ts
async reorderCategories(tenantId: string, ids: string[]) {
  const owned = await this.prisma.category.count({ where: { id: { in: ids }, tenantId } });
  if (owned !== ids.length || new Set(ids).size !== ids.length) {
    throw new BadRequestException('Lista de categorias inválida.');
  }
  await this.prisma.$transaction(
    ids.map((id, i) => this.prisma.category.update({ where: { id }, data: { sortOrder: i } })),
  );
  return { reordered: ids.length };
}
```

`reorderProducts` é igual, mas o `count` filtra também por `categoryId` — impede reordenar um
produto para uma categoria de outro tenant, ou misturar IDs de categorias diferentes.

> **Porquê lote e não N PATCHs:** arrastar um item para o topo mexe no `sortOrder` de **todos** os
> que estão acima. N PATCHs teriam estado intermédio visível (dois itens com o mesmo `sortOrder`
> por um instante) e, se um falhasse a meio, a ordem ficava baralhada. A transação grava tudo ou
> nada. É o padrão do `PUT /tables/layout` da R4.

## 4. Frontend — editar (modal)

Em `apps/dashboard/src/app/menu/page.tsx`:

- **Extrair o formulário de produto** do `AddProductForm` (linha ~462) para um componente que
  serve os dois modos — criar e editar. Hoje o `AddProductForm` tem nome/preço/IVA/descrição; o
  modal de editar acrescenta os campos que faltam: **categoria** (select das categorias do
  tenant), **imagem** (o `ImageUpload` que o `ProductRow` já usa), **ativo/inativo** (toggle).
- Cada **`ProductRow`** ganha um botão **"Editar"** que abre o modal pré-preenchido com o produto.
  "Guardar" → `PATCH catalog/products/:id` com os campos alterados.

> **Armadilha conhecida (3× neste projeto):** enviar `undefined` num PATCH faz o `JSON.stringify`
> deitar a chave fora → o backend mantém o valor antigo e a UI diz «sucesso» sem mudar nada. O
> modal envia **os campos todos** do produto (não só os que mudaram), ou constrói o payload com
> cuidado — mas nunca deixa um campo tocado virar `undefined`.

- **Editar categoria:** o nome da categoria também passa a ser editável (o `UpdateCategoryDto` já
  aceita `name`) — um lápis/inline ou um mini-modal, o que for mais simples no layout atual.

## 5. Frontend — ordenar (arrastar + setas)

- **Produtos dentro da categoria:** a lista `productsByCategory(cat.id).map(ProductRow)` (linha
  ~159) passa a ser arrastável. Ao largar, reindexa a lista local (otimista) e chama
  `PUT catalog/products/reorder { categoryId, ids }`. Se falhar, reverte e mostra erro.
- **Categorias:** a lista `categories.data.map(cat)` (linha ~133) idem, com
  `PUT catalog/categories/reorder { ids }`.
- **Arrastar:** `pointer events` + `setPointerCapture` (um só caminho para rato e dedo, sem
  biblioteca — o padrão do `FloorMap` da R4; o HTML5 drag-and-drop não dispara em touch).
- **Setas ↑↓** em cada linha (produto e categoria): sobem/descem uma posição e gravam pelo mesmo
  endpoint. É a alternativa fiável no telemóvel e para acessibilidade.
- **react-query:** após reordenar, `invalidateQueries` das categorias/produtos para o estado
  servido bater com o otimista.

## 6. Testes

- **E2e (`e2e-*.mjs` do catálogo, ou acrescentar ao existente):**
  - editar um produto muda **nome, preço e categoria** (os três que hoje não davam) e persiste;
  - `PUT products/reorder` grava o `sortOrder` pela ordem dada; ler de volta confirma a ordem;
  - `PUT categories/reorder` idem;
  - reorder com um ID de **outro tenant** → 400 (tenancy);
  - reorder de produtos com um ID de **outra categoria** → 400;
  - a montra pública reflete a ordem nova (lê `sortOrder`).
- **Regressões:** criar produto, a edição inline de descrição/imagem/IVA, e a montra continuam a
  funcionar.
- **Browser (obrigatório):** editar um produto pelo modal (mudar nome+preço+categoria), ver na
  lista; arrastar um produto para outra posição e sobreviver ao F5; arrastar uma categoria; as
  setas no telemóvel; confirmar a ordem na loja pública.

## 7. Fora de âmbito

Mover um produto para outra categoria **por arrastar** (faz-se pelo modal, campo categoria) ·
ordenar os grupos de personalização · reordenar por número escrito à mão (o arrastar+setas
cobre) · undo do arrastar.
