# Melhorias do Menu (pedidos do Matheus + testadora Roma) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Três melhorias pedidas, todas **só de frontend** (o backend já suporta tudo):
1. **Editar o preço** de um produto depois de criado (hoje obriga a apagar e recriar).
2. **Ordenar** produtos e categorias à mão.
3. **Preço final nas personalizações de escolha única** (tamanhos): mostrar "Grande — 14,50 €" em vez de "+3,00 €" (pedido da Roma).

*(O 4.º pedido — horários repartidos almoço/jantar — é maior (schema+backend+UI+loja) e tem plano próprio; ver §Fora de âmbito.)*

**Architecture:** Nada de migrações nem endpoints novos. `PATCH /products/:id` já aceita `price`; `Product.sortOrder`/`Category.sortOrder` já existem e o catálogo já ordena por `[{sortOrder}, {name}]` (catalog.service.ts:29,57,242,246) tanto no painel como na loja pública. As três tasks são independentes e podem correr em paralelo (ficheiros disjuntos).

**Tech Stack:** Next.js 15/React 18, TanStack Query, Tailwind (linguagem editorial do repo).

## Global Constraints

- Copy PT-PT; ZERO emojis; linguagem editorial (chips com ponto+MAIÚSCULAS, `rounded-xl border-line`, `shadow-card`, `tabular-nums`).
- Preços: aceitar vírgula OU ponto (`parseFloat(v.replace(',', '.'))`) — padrão do `AddProductForm` (menu/page.tsx:472).
- Node/pnpm: `PATH="$HOME/.local/node/bin:$PATH"`. Working dir: `/Users/matheus.moraes/dev/comanda`.
- Typecheck limpo por task (`pnpm --filter @comanda/dashboard typecheck` / `@comanda/storefront`).

---

### Task 1: Editar o preço inline no painel

**Files:**
- Modify: `apps/dashboard/src/app/menu/page.tsx` (componente `ProductRow`)

**Interfaces:**
- Consumes: `useUpdateProduct()` (já existe, aceita `{ id, price }`).
- Produces: o `<span>` do preço passa a ser um botão que abre edição inline, no MESMO padrão do `editDesc` que já existe neste componente (linhas ~181-257).

- [ ] **Step 1:** No `ProductRow`, juntar estado a seguir ao `editDesc`:

```ts
  const [editPrice, setEditPrice] = useState(false);
  const [price, setPrice] = useState(Number(product.price).toFixed(2).replace('.', ','));
```

- [ ] **Step 2:** Guardar (junto ao `saveDesc`):

```ts
  async function savePrice() {
    const value = parseFloat(price.replace(',', '.'));
    if (Number.isNaN(value) || value < 0) {
      toast.error('Preço inválido');
      return;
    }
    try {
      await update.mutateAsync({ id: product.id, price: value });
      setEditPrice(false);
      toast.success('Preço atualizado');
    } catch {
      toast.error('Erro ao guardar o preço');
    }
  }
```

- [ ] **Step 3:** Substituir o `<span>` do preço (menu/page.tsx:261-263) por:

```tsx
          {editPrice ? (
            <span className="flex items-center gap-1.5">
              <input
                autoFocus
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void savePrice();
                  if (e.key === 'Escape') {
                    setPrice(Number(product.price).toFixed(2).replace('.', ','));
                    setEditPrice(false);
                  }
                }}
                inputMode="decimal"
                className="w-20 rounded-lg border border-line bg-white px-2 py-1 text-right text-[13px] tabular-nums outline-none focus:border-brand"
              />
              <span className="text-[13px] text-ink-mute">€</span>
              <button
                onClick={savePrice}
                title="Guardar preço"
                className="rounded-lg bg-brand p-1.5 text-white hover:bg-brand-dark"
              >
                <Check size={13} />
              </button>
              <button
                onClick={() => {
                  setPrice(Number(product.price).toFixed(2).replace('.', ','));
                  setEditPrice(false);
                }}
                title="Cancelar"
                className="rounded-lg border border-line p-1.5 text-ink-mute hover:bg-cream"
              >
                <X size={13} />
              </button>
            </span>
          ) : (
            <button
              onClick={() => setEditPrice(true)}
              title="Editar preço"
              className="group/price flex items-center gap-1 rounded-lg bg-brand-soft px-2.5 py-1 text-[13px] font-semibold tabular-nums text-brand-dark transition-colors hover:bg-brand/20"
            >
              {Number(product.price).toFixed(2)} €
              <Pencil size={11} className="opacity-0 transition-opacity group-hover/price:opacity-100" />
            </button>
          )}
```

(`Check`, `X` e `Pencil` já estão importados neste ficheiro.)

- [ ] **Step 4:** Typecheck + verificação no browser (editar o preço de um produto da demo; Enter guarda, Esc cancela; vírgula e ponto funcionam; a loja pública mostra o preço novo). Commit `feat(dashboard): editar o preço do produto sem o apagar`.

---

### Task 2: Ordenar categorias e produtos

**Files:**
- Modify: `apps/dashboard/src/app/menu/page.tsx` (cabeçalho da categoria + `ProductRow`)

**Interfaces:**
- Consumes: `useUpdateCategory()` e `useUpdateProduct()` (ambos aceitam `sortOrder`); as listas já vêm ordenadas por `[{sortOrder}, {name}]` do servidor.
- Produces: setas ▲▼ que trocam o `sortOrder` entre vizinhos (swap), com as pontas desativadas.

- [ ] **Step 1: Helper de troca** — ao nível do módulo em `menu/page.tsx`:

```ts
/**
 * Troca a posição de dois vizinhos numa lista ordenada. Reescreve o sortOrder de
 * TODA a lista pelo índice (0,1,2…) porque os valores herdados podem estar todos a
 * zero (default do schema) — sem isto, trocar dois zeros não mudava nada.
 */
function reorder<T extends { id: string }>(list: T[], index: number, dir: -1 | 1): { id: string; sortOrder: number }[] {
  const next = [...list];
  const target = index + dir;
  if (target < 0 || target >= next.length) return [];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((item, i) => ({ id: item.id, sortOrder: i }));
}
```

- [ ] **Step 2: Categorias** — no cabeçalho de cada categoria (junto ao botão de apagar, menu/page.tsx:~150), acrescentar:

```tsx
                <button
                  onClick={() => moveCategory(idx, -1)}
                  disabled={idx === 0}
                  title="Subir categoria"
                  className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-cream hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  onClick={() => moveCategory(idx, 1)}
                  disabled={idx === categories.length - 1}
                  title="Descer categoria"
                  className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-cream hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronDown size={16} />
                </button>
```

com, no componente da página (onde `categories` está disponível e existe `useUpdateCategory`):

```ts
  const updateCategory = useUpdateCategory();

  async function moveCategory(index: number, dir: -1 | 1) {
    const changes = reorder(categories, index, dir);
    if (changes.length === 0) return;
    try {
      // sequencial: são poucos e evita corridas de escrita no mesmo tenant
      for (const c of changes) await updateCategory.mutateAsync({ id: c.id, sortOrder: c.sortOrder });
      toast.success('Ordem guardada');
    } catch {
      toast.error('Erro ao reordenar');
    }
  }
```

(o `.map((cat) => ...)` das categorias passa a `.map((cat, idx) => ...)`; juntar `ChevronUp`/`ChevronDown` ao import do lucide-react.)

- [ ] **Step 3: Produtos** — o mesmo dentro de cada categoria: o `productsByCategory(cat.id).map((p) => ...)` passa a `.map((p, i, arr) => ...)` e o `<ProductRow>` recebe `onMove={(dir) => moveProduct(arr, i, dir)}`, `canUp={i > 0}`, `canDown={i < arr.length - 1}`; o `ProductRow` renderiza as duas setas (mesmo visual) à esquerda do preço. `moveProduct` espelha o `moveCategory` mas com `useUpdateProduct`.

- [ ] **Step 4:** Typecheck + verificação no browser (subir/descer categorias e produtos na demo; recarregar a página mantém a ordem; a loja pública reflete). Commit `feat(dashboard): ordenar categorias e produtos com setas`.

---

### Task 3: Preço final nas personalizações de escolha única (tamanhos)

**Files:**
- Modify: `apps/storefront/src/components/ProductOptions.tsx`

**Interfaces:**
- Produces: em grupos de **escolha única com preços diferentes**, cada opção mostra o **preço final** (`produto + delta`) em vez do delta. Extras (multi-seleção) e grupos sem variação de preço ficam exatamente como estão.

**Regra (decisão de design):** um grupo é "variante" quando `maxSelect === 1` **e** pelo menos um dos seus modificadores tem `priceDelta !== 0`. Assim:
- "Tamanho" (0 / +2 / +3) → mostra `11,50 €` · `13,50 €` · `14,50 €` — é o que a Roma pediu.
- "Extras" (multi-seleção, +1,00) → continua `+1,00 €` (o delta é a informação certa).
- "Ponto da carne" (escolha única, todos a 0) → continua sem preço nenhum (não polui).

- [ ] **Step 1:** No `ProductOptions.tsx`, ao nível do módulo:

```ts
/**
 * Grupos de VARIANTE (ex.: Tamanho) mostram o preço final da opção; grupos de
 * EXTRAS mostram só o acréscimo. Heurística sem configuração nova: escolha única
 * (maxSelect === 1) com preços diferentes entre opções.
 */
function isVariantGroup(group: { maxSelect: number; modifiers: { priceDelta: string }[] }): boolean {
  return group.maxSelect === 1 && group.modifiers.some((m) => Number(m.priceDelta) !== 0);
}
```

- [ ] **Step 2:** Substituir o bloco do preço da opção (ProductOptions.tsx:127-130) por:

```tsx
                    {isVariantGroup(g) ? (
                      <span className="text-[12.5px] font-semibold tabular-nums text-ink-soft">
                        {(Number(product.price) + Number(m.priceDelta)).toFixed(2)} €
                      </span>
                    ) : (
                      Number(m.priceDelta) > 0 && (
                        <span className="text-[12.5px] font-semibold tabular-nums text-ink-soft">
                          +{Number(m.priceDelta).toFixed(2)} €
                        </span>
                      )
                    )}
```

(`g` é o grupo do `.map` envolvente — confirmar o nome da variável no ficheiro e usar o correto; `product` já está no scope.)

- [ ] **Step 3:** Typecheck do storefront + verificação no browser na loja demo (`menooo.com`/local `:3000/pizzaria-demo`): abrir uma pizza com Tamanho+Extras — os tamanhos mostram 11,50/13,50/14,50 e os extras continuam +1,00. O total do carrinho não muda (a matemática já era `product.price + soma dos deltas` — ProductOptions.tsx:45 — só muda o que se MOSTRA).
- [ ] **Step 4:** Commit `feat(storefront): tamanhos mostram o preço final em vez do acréscimo`.

---

### Task 4: Verificação integrada (CONTROLLER)

- [ ] Painel: editar preço (vírgula/ponto/Enter/Esc), reordenar categorias e produtos, recarregar → ordem mantida.
- [ ] Loja: preço novo reflete; tamanhos com preço final, extras com `+`; adicionar ao carrinho → total correto.
- [ ] Regressões: `node apps/api/scripts/e2e-reservas.mjs` 96/96 e `e2e-kitchen.mjs` 42/42 (não deviam ser tocados, mas o menu alimenta as encomendas).

---

## Fora de âmbito (plano próprio)

- **Horários repartidos** (almoço + jantar): exige mudar `OpeningHour` (hoje `@@unique([tenantId, weekday])` = 1 faixa/dia), `computeOpenNow` (hoje `hours.find` → tem de passar a "alguma faixa contém agora"), `setMyHours`/DTO, a UI de horários no painel e a apresentação na loja. As **janelas de reserva** da R1 já resolvem o caso das reservas (até 2 janelas/dia) — isto é para as ENCOMENDAS.
- Drag-and-drop na ordenação (as setas resolvem o pedido; DnD é polimento).
- Flag explícita "mostrar preço final" por grupo (a heurística cobre o pedido sem configuração).
