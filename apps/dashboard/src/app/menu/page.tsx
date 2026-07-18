'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  EyeOff,
  Eye,
  UtensilsCrossed,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  GripVertical,
  X,
  Check,
  Pencil,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ImageUploader } from '@/components/ImageUploader';
import {
  useCategories,
  useProducts,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useCreateProduct,
  useDeleteProduct,
  useToggleProduct,
  useUpdateProduct,
  useReorderProducts,
  useReorderCategories,
  useProductDetail,
  useModifierGroups,
  useAttachGroup,
  useDetachGroup,
} from '@/lib/catalog-hooks';
import type { Category, Product } from '@/lib/types';
import { PersonalizacoesTab } from './PersonalizacoesTab';

type MenuTab = 'geral' | 'personalizacoes';

// taxas de IVA em Portugal (23 normal, 13 intermédia, 6 reduzida, 0 isento)
const VAT_RATES = [23, 13, 6, 0];

// Arrasto (caminho extra; as setas ↑↓ são o principal). Iguais ao FloorMap.
/** Distância a partir da qual o gesto deixa de ser um toque e passa a ser um arrasto. */
const MOVE_TOL = 6;
/** Toque longo que arma o arrasto no dedo (o rato arma logo ao mexer). */
const LONG_PRESS_MS = 280;

interface RowDrag {
  id: string;
  index: number;
  pointerId: number;
  el: HTMLElement;
  startY: number;
  lastY: number;
  armed: boolean;
  moved: boolean;
  longPress?: ReturnType<typeof setTimeout>;
}

export default function MenuPage() {
  const categories = useCategories();
  const products = useProducts();
  const createCategory = useCreateCategory();
  const reorderCategories = useReorderCategories();

  // Sobe/desce uma categoria uma posição. Envia a lista COMPLETA reindexada (a API recusa
  // subconjuntos). As setas ficam desativadas enquanto um reorder está em curso (serializar).
  function moveCategory(index: number, dir: -1 | 1) {
    const list = categories.data ?? [];
    const alvo = index + dir;
    if (alvo < 0 || alvo >= list.length) return;
    const ids = list.map((c) => c.id);
    [ids[index], ids[alvo]] = [ids[alvo], ids[index]];
    reorderCategories.mutate({ ids });
  }

  const [tab, setTab] = useState<MenuTab>('geral');
  const [newCategory, setNewCategory] = useState('');
  // Modal de edição ao nível da página: um `fixed` dentro do `.stagger` (que anima com
  // `transform`) ficaria preso à caixa da secção, não ao ecrã. Fica aqui, fora do stagger.
  const [editing, setEditing] = useState<Product | null>(null);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) {
      toast.error('Escreve primeiro o nome da categoria no campo ao lado (ex.: Pizzas).');
      return;
    }
    try {
      await createCategory.mutateAsync(newCategory.trim());
      setNewCategory('');
      toast.success('Categoria criada');
    } catch {
      toast.error('Erro ao criar categoria');
    }
  }

  const productsByCategory = (categoryId: string) =>
    (products.data ?? []).filter((p) => p.categoryId === categoryId);

  return (
    <AppShell
      title="Menu"
      actions={
        tab === 'geral' ? (
          <form onSubmit={addCategory} className="flex gap-2">
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Nova categoria (ex.: Pizzas)"
              className="w-52 rounded-xl border border-line bg-white px-3.5 py-2 text-[13.5px] shadow-card outline-none focus:border-brand"
            />
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
            >
              <Plus size={16} /> Categoria
            </button>
          </form>
        ) : undefined
      }
    >
      {/* abas: produtos vs biblioteca de complementos */}
      <div className="mb-5 flex w-fit gap-1 rounded-xl border border-line bg-white p-1 shadow-card">
        {(
          [
            ['geral', 'Vista geral'],
            ['personalizacoes', 'Personalizações'],
          ] as [MenuTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={
              'rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors ' +
              (tab === id ? 'bg-brand text-white' : 'text-ink-soft hover:bg-cream')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* as duas abas ficam montadas (hidden) para não perder painéis
          abertos e texto por guardar ao saltar para a biblioteca e voltar */}
      <div className={tab === 'personalizacoes' ? undefined : 'hidden'}>
        <PersonalizacoesTab />
      </div>

      <div className={tab === 'geral' ? undefined : 'hidden'}>
        {categories.isLoading && <p className="text-ink-mute">A carregar…</p>}

        {categories.data?.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line py-16 text-center">
            <UtensilsCrossed size={30} className="text-ink-mute" strokeWidth={1.5} />
            <div>
              <p className="font-medium">O teu menu está vazio</p>
              <p className="mt-1 text-[13px] text-ink-mute">
                Cria a primeira categoria acima — por exemplo “Pizzas” ou “Bebidas”.
              </p>
            </div>
          </div>
        )}

        <div className="stagger space-y-5">
          {categories.data?.map((cat, i) => (
            <CategorySection
              key={cat.id}
              category={cat}
              products={productsByCategory(cat.id)}
              onEdit={setEditing}
              onGoToLibrary={() => setTab('personalizacoes')}
              onMoveUp={() => moveCategory(i, -1)}
              onMoveDown={() => moveCategory(i, 1)}
              isFirst={i === 0}
              isLast={i === (categories.data?.length ?? 0) - 1}
              reorderPending={reorderCategories.isPending}
            />
          ))}
        </div>
      </div>

      {editing && (
        <ProductForm
          key={editing.id}
          mode="edit"
          categoryId={editing.categoryId}
          product={editing}
          categories={categories.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </AppShell>
  );
}

/** Cabeçalho (nome editável em linha — T5), lista de produtos e formulário de adicionar. */
function CategorySection({
  category,
  products,
  onEdit,
  onGoToLibrary,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  reorderPending,
}: {
  category: Category;
  products: Product[];
  onEdit: (product: Product) => void;
  onGoToLibrary: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  reorderPending: boolean;
}) {
  const deleteCategory = useDeleteCategory();
  const updateCategory = useUpdateCategory();
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(category.name);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('O nome da categoria não pode ficar vazio.');
      return;
    }
    try {
      await updateCategory.mutateAsync({ id: category.id, name: trimmed });
      setEditName(false);
      toast.success('Categoria atualizada');
    } catch {
      toast.error('Erro ao guardar o nome');
    }
  }

  function cancelName() {
    setName(category.name);
    setEditName(false);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-line bg-cream/40 px-5 py-3.5">
        {editName ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveName();
                }
                if (e.key === 'Escape') cancelName();
              }}
              className="rounded-lg border border-line bg-white px-2.5 py-1 font-display text-[16px] font-semibold outline-none focus:border-brand"
            />
            <button
              onClick={saveName}
              title="Guardar"
              className="rounded-lg bg-brand p-1.5 text-white hover:bg-brand-dark"
            >
              <Check size={14} />
            </button>
            <button
              onClick={cancelName}
              title="Cancelar"
              className="rounded-lg border border-line p-1.5 text-ink-mute hover:bg-cream"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setName(category.name);
              setEditName(true);
            }}
            className="group/cat flex items-center gap-1.5 text-left"
            title="Editar nome da categoria"
          >
            <h2 className="font-display text-[17px] font-semibold">{category.name}</h2>
            <Pencil
              size={13}
              className="shrink-0 text-ink-mute opacity-0 transition-opacity group-hover/cat:opacity-100"
            />
          </button>
        )}
        <div className="flex items-center gap-3">
          {/* Ordenar categorias: subir/descer. As setas são o caminho fiável (o arrasto vertical
              disputaria o scroll da página). Desativadas nos extremos e enquanto grava. */}
          <div className="flex items-center">
            <button
              onClick={onMoveUp}
              disabled={isFirst || reorderPending}
              title="Subir categoria"
              className="rounded-lg p-1 text-ink-mute transition-colors hover:bg-cream hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronUp size={16} />
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast || reorderPending}
              title="Descer categoria"
              className="rounded-lg p-1 text-ink-mute transition-colors hover:bg-cream hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronDown size={16} />
            </button>
          </div>
          <span className="text-[12px] text-ink-mute">{products.length} produtos</span>
          <button
            onClick={async () => {
              if (!confirm(`Apagar a categoria "${category.name}" e os seus produtos?`)) return;
              await deleteCategory.mutateAsync(category.id);
              toast.success('Categoria apagada');
            }}
            className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-red-50 hover:text-red-600"
            title="Apagar categoria"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <ProductList
        category={category}
        products={products}
        onEdit={onEdit}
        onGoToLibrary={onGoToLibrary}
      />

      <ProductForm mode="create" categoryId={category.id} />
    </section>
  );
}

/** Lista ordenável de produtos: setas ↑↓ (principal) + arrasto (extra). Ambos enviam a lista
 *  COMPLETA da categoria ao reorder em lote. */
function ProductList({
  category,
  products,
  onEdit,
  onGoToLibrary,
}: {
  category: Category;
  products: Product[];
  onEdit: (product: Product) => void;
  onGoToLibrary: () => void;
}) {
  const reorder = useReorderProducts();
  const listRef = useRef<HTMLUListElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const dragRef = useRef<RowDrag | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dy, setDy] = useState(0);
  const [dropIns, setDropIns] = useState<number | null>(null);

  const setRowRef = useCallback((id: string, el: HTMLLIElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  // --- setas ↑↓ (troca com o vizinho) ------------------------------------
  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= products.length) return;
    const ids = products.map((p) => p.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate({ categoryId: category.id, ids });
  }

  // --- arrasto -----------------------------------------------------------

  // Índice de inserção IGNORANDO a linha arrastada: contamos quantas das outras ficam acima do
  // ponteiro. Ignorar a arrastada evita que o `translateY` dela baralhe a conta.
  const insertionAt = useCallback(
    (clientY: number, id: string): number => {
      const others = products.filter((p) => p.id !== id);
      for (let i = 0; i < others.length; i++) {
        const el = rowRefs.current.get(others[i].id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientY < r.top + r.height / 2) return i;
      }
      return others.length;
    },
    [products],
  );

  const armar = useCallback(
    (st: RowDrag) => {
      st.armed = true;
      setDragId(st.id);
      setDy(st.lastY - st.startY);
      setDropIns(insertionAt(st.lastY, st.id));
    },
    [insertionAt],
  );

  const limpar = useCallback((st: RowDrag) => {
    if (st.longPress) clearTimeout(st.longPress);
    try {
      if (st.el.hasPointerCapture(st.pointerId)) st.el.releasePointerCapture(st.pointerId);
    } catch {
      // o elemento pode já ter saído do DOM — não há captura para libertar
    }
    dragRef.current = null;
    setDragId(null);
    setDy(0);
    setDropIns(null);
  }, []);

  function onHandlePointerDown(e: React.PointerEvent<HTMLElement>, product: Product, index: number) {
    if (e.button !== 0 || reorder.isPending) return; // serializar: um reorder de cada vez
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // sem captura o arrasto ainda funciona enquanto o ponteiro não sair do elemento
    }
    const st: RowDrag = {
      id: product.id,
      index,
      pointerId: e.pointerId,
      el,
      startY: e.clientY,
      lastY: e.clientY,
      armed: false,
      moved: false,
    };
    dragRef.current = st;
    if (e.pointerType !== 'mouse') {
      // No dedo, arrastar só depois de um toque longo: senão a lista roubava o scroll da página.
      st.longPress = setTimeout(() => {
        if (dragRef.current === st && !st.moved) armar(st);
      }, LONG_PRESS_MS);
    }
  }

  function onHandlePointerMove(e: React.PointerEvent<HTMLElement>) {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    st.lastY = e.clientY;
    const d = e.clientY - st.startY;
    if (Math.abs(d) > MOVE_TOL) {
      st.moved = true;
      if (!st.armed) {
        if (e.pointerType === 'mouse') {
          armar(st); // o rato não faz scroll a arrastar: arma logo
        } else if (st.longPress) {
          clearTimeout(st.longPress); // o dedo mexeu antes de armar => é um scroll, não um arrasto
          st.longPress = undefined;
        }
      }
    }
    if (st.armed) {
      setDy(d);
      setDropIns(insertionAt(e.clientY, st.id));
    }
  }

  function onHandlePointerUp(e: React.PointerEvent<HTMLElement>) {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const { armed, id } = st;
    const ins = armed ? insertionAt(e.clientY, id) : null;
    limpar(st);
    if (armed && ins !== null) commit(id, ins);
  }

  function onHandlePointerCancel(e: React.PointerEvent<HTMLElement>) {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    limpar(st); // o browser levou o gesto (scroll) — não mexemos em nada
  }

  function commit(id: string, ins: number) {
    const novo = products.filter((p) => p.id !== id).map((p) => p.id);
    novo.splice(ins, 0, id);
    const atual = products.map((p) => p.id);
    if (novo.join('|') === atual.join('|')) return; // largou no mesmo sítio → sem PUT inútil
    reorder.mutate({ categoryId: category.id, ids: novo });
  }

  // O React regista o onTouchMove como PASSIVO: um preventDefault lá dentro não faz nada. Só um
  // listener nativo não-passivo trava o scroll do browser durante o arrasto — e, como o dedo tem
  // de estar quieto para armar, o primeiro touchmove chega já armado.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onTouchMove = (ev: TouchEvent) => {
      if (dragRef.current?.armed) ev.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  if (products.length === 0) {
    return (
      <ul className="divide-y divide-line">
        <li className="px-5 py-3 text-[13px] text-ink-mute">Sem produtos nesta categoria.</li>
      </ul>
    );
  }

  const others = dragId ? products.filter((p) => p.id !== dragId) : [];
  const indicatorBeforeId =
    dragId && dropIns !== null ? (others[dropIns]?.id ?? null) : undefined;
  const indicatorAtEnd = dragId != null && dropIns !== null && dropIns >= others.length;

  return (
    <ul ref={listRef} className="divide-y divide-line">
      {products.map((p, i) => (
        <ProductRow
          key={p.id}
          product={p}
          onEdit={onEdit}
          onGoToLibrary={onGoToLibrary}
          index={i}
          total={products.length}
          onMove={(dir) => move(i, dir)}
          onHandlePointerDown={(e) => onHandlePointerDown(e, p, i)}
          onHandlePointerMove={onHandlePointerMove}
          onHandlePointerUp={onHandlePointerUp}
          onHandlePointerCancel={onHandlePointerCancel}
          isDragging={dragId === p.id}
          dragOffset={dragId === p.id ? dy : 0}
          dropBefore={indicatorBeforeId === p.id}
          reorderPending={reorder.isPending}
          setRowRef={setRowRef}
        />
      ))}
      {indicatorAtEnd && (
        <li className="relative h-0" aria-hidden>
          <div className="absolute inset-x-0 top-0 h-0.5 bg-brand" />
        </li>
      )}
    </ul>
  );
}

function ProductRow({
  product,
  onEdit,
  onGoToLibrary,
  index,
  total,
  onMove,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
  onHandlePointerCancel,
  isDragging,
  dragOffset,
  dropBefore,
  reorderPending,
  setRowRef,
}: {
  product: Product;
  onEdit: (product: Product) => void;
  onGoToLibrary: () => void;
  index: number;
  total: number;
  onMove: (dir: -1 | 1) => void;
  onHandlePointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onHandlePointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onHandlePointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onHandlePointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  isDragging: boolean;
  dragOffset: number;
  dropBefore: boolean;
  reorderPending: boolean;
  setRowRef: (id: string, el: HTMLLIElement | null) => void;
}) {
  const toggle = useToggleProduct();
  const del = useDeleteProduct();
  const update = useUpdateProduct();
  const [open, setOpen] = useState(false);
  const [editDesc, setEditDesc] = useState(false);
  const [desc, setDesc] = useState(product.description ?? '');

  async function saveDesc() {
    try {
      await update.mutateAsync({ id: product.id, description: desc.trim() });
      setEditDesc(false);
      toast.success('Descrição guardada');
    } catch {
      toast.error('Erro ao guardar descrição');
    }
  }

  return (
    <li
      ref={(el) => setRowRef(product.id, el)}
      className={'relative bg-white transition-shadow ' + (isDragging ? 'z-20 shadow-lift' : '')}
      style={isDragging ? { transform: `translateY(${dragOffset}px)` } : undefined}
    >
      {dropBefore && <div className="absolute inset-x-0 -top-px z-10 h-0.5 bg-brand" aria-hidden />}
      <div className="flex items-center gap-2 px-3 py-3">
        {/* controlos de ordem — setas (principal) + pega de arrasto (extra) */}
        <div className="flex flex-col items-center text-ink-mute">
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0 || reorderPending}
            title="Mover para cima"
            className="rounded p-0.5 transition-colors hover:bg-cream hover:text-ink disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronUp size={15} />
          </button>
          <button
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerCancel}
            onContextMenu={(e) => e.preventDefault()}
            title="Arrastar para reordenar"
            className="cursor-grab touch-none rounded p-0.5 hover:text-ink active:cursor-grabbing"
            style={{ WebkitTouchCallout: 'none' }}
          >
            <GripVertical size={15} />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === total - 1 || reorderPending}
            title="Mover para baixo"
            className="rounded p-0.5 transition-colors hover:bg-cream hover:text-ink disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronDown size={15} />
          </button>
        </div>

        <div className="flex flex-1 items-center justify-between gap-3">
          <div className={'flex items-center gap-3 ' + (product.active ? '' : 'opacity-40')}>
            <ImageUploader
              variant="square"
              size="sm"
              value={product.imageUrl}
              onChange={(url) => update.mutateAsync({ id: product.id, imageUrl: url ?? '' })}
            />
            <div className="min-w-0">
              <p className="text-[14px] font-medium">
                {product.name}
                {!product.active && (
                  <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-[10.5px] font-semibold text-stone-500">
                    oculto
                  </span>
                )}
              </p>
              {editDesc ? (
                <div className="mt-1 flex items-start gap-1.5">
                  <textarea
                    autoFocus
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    rows={2}
                    maxLength={280}
                    placeholder="Ex.: Molho de tomate, mozzarella e manjericão fresco"
                    className="w-72 max-w-full resize-none rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-brand"
                  />
                  <button
                    onClick={saveDesc}
                    title="Guardar"
                    className="rounded-lg bg-brand p-1.5 text-white hover:bg-brand-dark"
                  >
                    <Check size={13} />
                  </button>
                  <button
                    onClick={() => {
                      setDesc(product.description ?? '');
                      setEditDesc(false);
                    }}
                    title="Cancelar"
                    className="rounded-lg border border-line p-1.5 text-ink-mute hover:bg-cream"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : product.description ? (
                <button
                  onClick={() => setEditDesc(true)}
                  className="group/desc mt-0.5 flex items-start gap-1 text-left text-[12px] text-ink-mute hover:text-ink"
                >
                  <span className="line-clamp-2">{product.description}</span>
                  <Pencil
                    size={11}
                    className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover/desc:opacity-100"
                  />
                </button>
              ) : (
                <button
                  onClick={() => setEditDesc(true)}
                  className="mt-0.5 flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
                >
                  <Plus size={12} /> Adicionar descrição
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="rounded-lg bg-brand-soft px-2.5 py-1 text-[13px] font-semibold text-brand-dark">
              {Number(product.price).toFixed(2)} €
            </span>
            <select
              value={product.vatRate}
              onChange={(e) => update.mutateAsync({ id: product.id, vatRate: Number(e.target.value) })}
              title="Taxa de IVA (incluída no preço)"
              className="rounded-lg border border-line bg-white px-1.5 py-1 text-[11.5px] text-ink-soft outline-none focus:border-brand"
            >
              {VAT_RATES.map((r) => (
                <option key={r} value={r}>
                  IVA {r}%
                </option>
              ))}
            </select>
            <button
              onClick={() => setOpen((v) => !v)}
              className={
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ' +
                (open
                  ? 'border-brand bg-brand-soft text-brand-dark'
                  : 'border-line text-ink-soft hover:border-brand/40')
              }
              title="Tamanhos, extras e outras opções"
            >
              <SlidersHorizontal size={13} />
              Opções
              <ChevronDown size={13} className={'transition-transform ' + (open ? 'rotate-180' : '')} />
            </button>
            <button
              onClick={() => onEdit(product)}
              className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-cream hover:text-ink"
              title="Editar produto"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={() => toggle.mutate({ id: product.id, active: !product.active })}
              className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-cream hover:text-ink"
              title={product.active ? 'Ocultar da loja' : 'Mostrar na loja'}
            >
              {product.active ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            <button
              onClick={async () => {
                if (!confirm(`Apagar "${product.name}"?`)) return;
                await del.mutateAsync(product.id);
                toast.success('Produto apagado');
              }}
              className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-red-50 hover:text-red-600"
              title="Apagar"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>
      {open && <OptionsEditor productId={product.id} onGoToLibrary={onGoToLibrary} />}
    </li>
  );
}

/** Grupos de complementos anexados ao produto. Editar opções/preços é na
 *  aba Personalizações; aqui só se anexa e desanexa. */
function OptionsEditor({
  productId,
  onGoToLibrary,
}: {
  productId: string;
  onGoToLibrary: () => void;
}) {
  const detail = useProductDetail(productId);
  const library = useModifierGroups();
  const attach = useAttachGroup();
  const detach = useDetachGroup();
  const [selected, setSelected] = useState('');

  const attached = detail.data?.modifierGroups ?? [];
  const attachedIds = new Set(attached.map((g) => g.id));
  const available = (library.data ?? []).filter((g) => !attachedIds.has(g.id));

  async function attachSelected() {
    if (!selected) return;
    try {
      await attach.mutateAsync({ productId, groupId: selected });
      setSelected('');
      toast.success('Grupo anexado');
    } catch {
      toast.error('Erro ao anexar o grupo');
    }
  }

  return (
    <div className="border-t border-dashed border-line bg-cream/30 px-5 py-4">
      {detail.isLoading && <p className="text-[12.5px] text-ink-mute">A carregar opções…</p>}

      {!detail.isLoading && attached.length === 0 && (
        <p className="mb-3 text-[12.5px] text-ink-mute">
          Sem grupos anexados. Os grupos de complementos (ex.: <strong>Tamanho</strong>,{' '}
          <strong>Extras</strong>) criam-se uma vez na aba{' '}
          <button onClick={onGoToLibrary} className="font-medium text-brand hover:underline">
            Personalizações
          </button>{' '}
          e anexam-se aqui aos produtos.
        </p>
      )}

      <div className="space-y-2.5">
        {attached.map((g) => (
          <div key={g.id} className="rounded-xl border border-line bg-white p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-semibold">{g.name}</span>
                {g.required ? (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase text-brand-dark">
                    obrigatório
                  </span>
                ) : (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10.5px] font-medium text-stone-500">
                    opcional
                  </span>
                )}
                <span className="text-[11px] text-ink-mute">
                  {g.maxSelect === 1 ? 'escolhe 1' : `até ${g.maxSelect}`}
                </span>
              </div>
              <button
                onClick={async () => {
                  if (!confirm(`Desanexar "${g.name}" deste produto? O grupo fica na biblioteca.`))
                    return;
                  try {
                    await detach.mutateAsync({ productId, groupId: g.id });
                    toast.success('Grupo desanexado');
                  } catch {
                    toast.error('Erro ao desanexar o grupo');
                  }
                }}
                className="rounded-lg p-1.5 text-ink-mute hover:bg-red-50 hover:text-red-600"
                title="Desanexar deste produto (não apaga o grupo)"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {g.modifiers.map((m) => (
                <span
                  key={m.id}
                  className="flex items-center gap-1.5 rounded-full border border-line bg-cream/60 px-3 py-1 text-[12px]"
                >
                  {m.name}
                  {Number(m.priceDelta) > 0 && (
                    <span className="font-semibold text-brand-dark">
                      +{Number(m.priceDelta).toFixed(2)} €
                    </span>
                  )}
                </span>
              ))}
              {g.modifiers.length === 0 && (
                <span className="text-[11.5px] text-ink-mute">sem opções ainda</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* anexar grupo da biblioteca */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {available.length > 0 ? (
          <>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] outline-none focus:border-brand"
            >
              <option value="">Anexar grupo…</option>
              {available.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.modifiers.length} {g.modifiers.length === 1 ? 'opção' : 'opções'})
                </option>
              ))}
            </select>
            <button
              onClick={attachSelected}
              disabled={!selected}
              className="flex items-center gap-1 rounded-xl bg-brand px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={14} /> Anexar
            </button>
          </>
        ) : (
          !library.isLoading &&
          attached.length > 0 && (
            <span className="text-[12px] text-ink-mute">
              Todos os grupos da biblioteca já estão anexados.
            </span>
          )
        )}
        <button
          onClick={onGoToLibrary}
          className="text-[12px] font-medium text-brand hover:underline"
        >
          Editar grupos na biblioteca →
        </button>
      </div>
    </div>
  );
}

/**
 * Formulário de produto em dois modos:
 *  - 'create' — em linha, colapsável, no fim de cada categoria (nome, preço, IVA, descrição).
 *  - 'edit'   — modal, com os campos extra: categoria, imagem (guarda diferida no estado local)
 *               e visível/oculto. Pré-preenche do product.
 *
 * PATCH (edit): o campo de texto limpo vai como "" (NUNCA undefined — senão o JSON.stringify
 * deita a chave fora e o backend mantém o valor antigo, e a UI mentia "guardado"). O sortOrder
 * NUNCA é enviado — a ordem é do reorder (um modal aberto antes de um arrasto revertia a posição).
 */
function ProductForm({
  mode,
  categoryId,
  product,
  categories,
  onClose,
}: {
  mode: 'create' | 'edit';
  categoryId: string;
  product?: Product;
  categories?: Category[];
  onClose?: () => void;
}) {
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const isEdit = mode === 'edit';

  const [open, setOpen] = useState(false); // só o modo 'create' (colapsado)
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(
    product ? Number(product.price).toFixed(2).replace('.', ',') : '',
  );
  const [vatRate, setVatRate] = useState<number>(product?.vatRate ?? 23);
  const [description, setDescription] = useState(product?.description ?? '');
  const [catId, setCatId] = useState(product?.categoryId ?? categoryId);
  // imagem: onChange guarda no estado LOCAL; o PATCH só sai no "Guardar" (guarda diferida).
  const [image, setImage] = useState<string | null>(product?.imageUrl ?? null);
  const [active, setActive] = useState(product?.active ?? true);

  const busy = create.isPending || update.isPending;

  // Escape fecha o modal.
  useEffect(() => {
    if (!isEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEdit, onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const priceNum = parseFloat(price.replace(',', '.'));
    if (!name.trim() || Number.isNaN(priceNum)) {
      toast.error('Indica nome e preço válidos');
      return;
    }

    if (isEdit && product) {
      try {
        await update.mutateAsync({
          id: product.id,
          categoryId: catId,
          name: name.trim(),
          price: priceNum,
          vatRate,
          description: description.trim(), // "" quando limpo — NUNCA undefined
          imageUrl: image ?? '', // "" quando removida — NUNCA undefined
          active,
          // sortOrder NUNCA é enviado — a ordem é do reorder.
        });
        toast.success('Produto atualizado');
        onClose?.();
      } catch {
        toast.error('Erro ao guardar as alterações');
      }
      return;
    }

    try {
      await create.mutateAsync({
        categoryId,
        name: name.trim(),
        price: priceNum,
        vatRate,
        description: description.trim() || undefined,
      });
      setName('');
      setPrice('');
      setVatRate(23);
      setDescription('');
      setOpen(false);
      toast.success('Produto adicionado');
    } catch {
      toast.error('Erro ao adicionar produto');
    }
  }

  // ----- modo edição: modal -----
  if (isEdit) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/40 p-4"
        onClick={onClose}
      >
        <form
          onSubmit={submit}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-lift"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-[17px] font-semibold">Editar produto</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-cream"
              title="Fechar"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex gap-4">
            <ImageUploader
              variant="square"
              size="md"
              value={image}
              onChange={(url) => setImage(url)}
            />
            <div className="flex-1 space-y-2.5">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do produto"
                className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-brand"
              />
              <div className="flex gap-2">
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Preço €"
                  inputMode="decimal"
                  className="w-28 rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-brand"
                />
                <select
                  value={vatRate}
                  onChange={(e) => setVatRate(Number(e.target.value))}
                  title="Taxa de IVA (incluída no preço)"
                  className="rounded-xl border border-line bg-white px-2 py-2 text-[13.5px] outline-none focus:border-brand"
                >
                  {VAT_RATES.map((r) => (
                    <option key={r} value={r}>
                      IVA {r}%
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <label className="mt-3 block text-[12.5px] font-medium text-ink-soft">Categoria</label>
          <select
            value={catId}
            onChange={(e) => setCatId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-brand"
          >
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label className="mt-3 block text-[12.5px] font-medium text-ink-soft">Descrição</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={280}
            placeholder="Ex.: Molho de tomate, mozzarella e manjericão fresco"
            className="mt-1 w-full resize-none rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-brand"
          />

          <div className="mt-3 flex items-center justify-between rounded-xl border border-line px-3.5 py-2.5">
            <div>
              <p className="text-[13px] font-medium">Visível na loja</p>
              <p className="text-[11.5px] text-ink-mute">
                Produtos ocultos não aparecem no menu público.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              onClick={() => setActive((v) => !v)}
              className={
                'relative h-6 w-11 shrink-0 rounded-full transition-colors ' +
                (active ? 'bg-brand' : 'bg-stone-300')
              }
              title={active ? 'Visível' : 'Oculto'}
            >
              <span
                className={
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' +
                  (active ? 'left-[22px]' : 'left-0.5')
                }
              />
            </button>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-line bg-white px-4 py-2 text-[13.5px] hover:bg-cream"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-brand px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ----- modo criação: em linha, colapsável -----
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 border-t border-line px-5 py-3 text-[13px] font-medium text-brand transition-colors hover:bg-brand-soft/40"
      >
        <Plus size={15} /> Adicionar produto
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2 border-t border-line bg-cream/30 px-5 py-3.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome do produto"
        autoFocus
        className="min-w-40 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-brand"
      />
      <input
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="Preço €"
        inputMode="decimal"
        className="w-24 rounded-xl border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-brand"
      />
      <select
        value={vatRate}
        onChange={(e) => setVatRate(Number(e.target.value))}
        title="Taxa de IVA (incluída no preço)"
        className="rounded-xl border border-line bg-white px-2 py-2 text-[13px] outline-none focus:border-brand"
      >
        {VAT_RATES.map((r) => (
          <option key={r} value={r}>
            IVA {r}%
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-xl bg-brand px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-dark"
      >
        Guardar
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-xl border border-line bg-white px-4 py-2 text-[13px] hover:bg-cream"
      >
        Cancelar
      </button>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Descrição (opcional) — ex.: Molho de tomate, mozzarella e manjericão fresco"
        rows={2}
        maxLength={280}
        className="w-full resize-none rounded-xl border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-brand"
      />
    </form>
  );
}
