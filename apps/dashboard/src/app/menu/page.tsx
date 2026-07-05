'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  EyeOff,
  Eye,
  UtensilsCrossed,
  SlidersHorizontal,
  ChevronDown,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import {
  useCategories,
  useProducts,
  useCreateCategory,
  useDeleteCategory,
  useCreateProduct,
  useDeleteProduct,
  useToggleProduct,
  useProductDetail,
  useCreateModifierGroup,
  useDeleteModifierGroup,
  useCreateModifier,
  useDeleteModifier,
} from '@/lib/catalog-hooks';
import type { Product } from '@/lib/types';

export default function MenuPage() {
  const categories = useCategories();
  const products = useProducts();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();

  const [newCategory, setNewCategory] = useState('');

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
      }
    >
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
        {categories.data?.map((cat) => (
          <section
            key={cat.id}
            className="overflow-hidden rounded-xl border border-line bg-white shadow-card"
          >
            <div className="flex items-center justify-between border-b border-line bg-cream/40 px-5 py-3.5">
              <h2 className="font-display text-[17px] font-semibold">{cat.name}</h2>
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-ink-mute">
                  {productsByCategory(cat.id).length} produtos
                </span>
                <button
                  onClick={async () => {
                    if (!confirm(`Apagar a categoria "${cat.name}" e os seus produtos?`)) return;
                    await deleteCategory.mutateAsync(cat.id);
                    toast.success('Categoria apagada');
                  }}
                  className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-red-50 hover:text-red-600"
                  title="Apagar categoria"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <ul className="divide-y divide-line">
              {productsByCategory(cat.id).map((p) => (
                <ProductRow key={p.id} product={p} />
              ))}
              {productsByCategory(cat.id).length === 0 && (
                <li className="px-5 py-3 text-[13px] text-ink-mute">Sem produtos nesta categoria.</li>
              )}
            </ul>

            <AddProductForm categoryId={cat.id} />
          </section>
        ))}
      </div>
    </AppShell>
  );
}

function ProductRow({ product }: { product: Product }) {
  const toggle = useToggleProduct();
  const del = useDeleteProduct();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <div className={product.active ? '' : 'opacity-40'}>
          <p className="text-[14px] font-medium">
            {product.name}
            {!product.active && (
              <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-[10.5px] font-semibold text-stone-500">
                oculto
              </span>
            )}
          </p>
          {product.description && (
            <p className="text-[12px] text-ink-mute">{product.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-brand-soft px-2.5 py-1 text-[13px] font-semibold text-brand-dark">
            {Number(product.price).toFixed(2)} €
          </span>
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
      {open && <OptionsEditor productId={product.id} />}
    </li>
  );
}

/** Subgrupos de opções do produto (ex.: Tamanho, Extras) com preços. */
function OptionsEditor({ productId }: { productId: string }) {
  const detail = useProductDetail(productId);
  const createGroup = useCreateModifierGroup();
  const deleteGroup = useDeleteModifierGroup();
  const createModifier = useCreateModifier();
  const deleteModifier = useDeleteModifier();

  const [groupName, setGroupName] = useState('');
  const [required, setRequired] = useState(false);
  const [maxSelect, setMaxSelect] = useState(1);

  const groups = detail.data?.modifierGroups ?? [];

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return toast.error('Dá um nome ao grupo (ex.: Tamanho).');
    try {
      await createGroup.mutateAsync({ productId, name: groupName.trim(), required, maxSelect });
      setGroupName('');
      setRequired(false);
      setMaxSelect(1);
      toast.success('Grupo criado');
    } catch {
      toast.error('Erro ao criar grupo');
    }
  }

  return (
    <div className="border-t border-dashed border-line bg-cream/30 px-5 py-4">
      {detail.isLoading && <p className="text-[12.5px] text-ink-mute">A carregar opções…</p>}

      {!detail.isLoading && groups.length === 0 && (
        <p className="mb-3 text-[12.5px] text-ink-mute">
          Sem grupos de opções. Cria por exemplo <strong>Tamanho</strong> (obrigatório, escolhe 1)
          ou <strong>Extras</strong> (até 3) — os preços somam ao produto.
        </p>
      )}

      <div className="space-y-3">
        {groups.map((g) => (
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
                  if (!confirm(`Apagar o grupo "${g.name}" e as suas opções?`)) return;
                  await deleteGroup.mutateAsync({ id: g.id, productId });
                  toast.success('Grupo apagado');
                }}
                className="rounded-lg p-1.5 text-ink-mute hover:bg-red-50 hover:text-red-600"
                title="Apagar grupo"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {g.modifiers.map((m) => (
                <span
                  key={m.id}
                  className="flex items-center gap-1.5 rounded-full border border-line bg-cream/60 py-1 pl-3 pr-1.5 text-[12px]"
                >
                  {m.name}
                  {Number(m.priceDelta) > 0 && (
                    <span className="font-semibold text-brand-dark">
                      +{Number(m.priceDelta).toFixed(2)} €
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      await deleteModifier.mutateAsync({ id: m.id, productId });
                    }}
                    className="rounded-full p-0.5 text-ink-mute hover:bg-red-100 hover:text-red-600"
                    title="Remover opção"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <AddModifierChip
                onAdd={async (name, delta) => {
                  try {
                    await createModifier.mutateAsync({ groupId: g.id, productId, name, priceDelta: delta });
                  } catch {
                    toast.error('Erro ao adicionar opção');
                  }
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* novo grupo */}
      <form onSubmit={addGroup} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-ink-soft">Novo grupo</label>
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Ex.: Tamanho, Extras…"
            className="w-40 rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] outline-none focus:border-brand"
          />
        </div>
        <label className="flex items-center gap-1.5 pb-2.5 text-[12px]">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-3.5 w-3.5 accent-brand"
          />
          obrigatório
        </label>
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-ink-soft">Máx. escolhas</label>
          <select
            value={maxSelect}
            onChange={(e) => setMaxSelect(parseInt(e.target.value, 10))}
            className="rounded-xl border border-line bg-white px-2 py-2 text-[12.5px]"
          >
            {[1, 2, 3, 4, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <button className="flex items-center gap-1 rounded-xl bg-brand px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-brand-dark">
          <Plus size={14} /> Grupo
        </button>
      </form>
    </div>
  );
}

/** Chip inline para acrescentar uma opção ao grupo. */
function AddModifierChip({ onAdd }: { onAdd: (name: string, delta: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [delta, setDelta] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-full border border-dashed border-brand/50 px-3 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft"
      >
        <Plus size={12} /> opção
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-brand bg-white py-1 pl-2 pr-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="nome"
        className="w-20 bg-transparent text-[12px] outline-none"
      />
      <input
        value={delta}
        onChange={(e) => setDelta(e.target.value)}
        placeholder="+€"
        inputMode="decimal"
        className="w-11 bg-transparent text-[12px] outline-none"
      />
      <button
        onClick={async () => {
          if (!name.trim()) return;
          await onAdd(name.trim(), parseFloat(delta.replace(',', '.')) || 0);
          setName('');
          setDelta('');
        }}
        className="rounded-full bg-brand p-1 text-white hover:bg-brand-dark"
        title="Guardar opção"
      >
        <Plus size={12} />
      </button>
      <button
        onClick={() => setOpen(false)}
        className="rounded-full p-1 text-ink-mute hover:text-ink"
        title="Fechar"
      >
        <X size={12} />
      </button>
    </span>
  );
}

function AddProductForm({ categoryId }: { categoryId: string }) {
  const create = useCreateProduct();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [open, setOpen] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const priceNum = parseFloat(price.replace(',', '.'));
    if (!name.trim() || Number.isNaN(priceNum)) {
      toast.error('Indica nome e preço válidos');
      return;
    }
    try {
      await create.mutateAsync({ categoryId, name: name.trim(), price: priceNum });
      setName('');
      setPrice('');
      setOpen(false);
      toast.success('Produto adicionado');
    } catch {
      toast.error('Erro ao adicionar produto');
    }
  }

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
    </form>
  );
}
