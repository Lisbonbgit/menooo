'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, EyeOff, Eye, UtensilsCrossed } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import {
  useCategories,
  useProducts,
  useCreateCategory,
  useDeleteCategory,
  useCreateProduct,
  useDeleteProduct,
  useToggleProduct,
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
    if (!newCategory.trim()) return;
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
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line py-16 text-center">
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
            className="overflow-hidden rounded-2xl border border-line bg-white shadow-card"
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
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
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
    </li>
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
