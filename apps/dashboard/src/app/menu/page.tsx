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
  Check,
  Pencil,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ImageUploader } from '@/components/ImageUploader';
import {
  useCategories,
  useProducts,
  useCreateCategory,
  useDeleteCategory,
  useCreateProduct,
  useDeleteProduct,
  useToggleProduct,
  useUpdateProduct,
  useProductDetail,
  useModifierGroups,
  useAttachGroup,
  useDetachGroup,
} from '@/lib/catalog-hooks';
import type { Product } from '@/lib/types';
import { PersonalizacoesTab } from './PersonalizacoesTab';

type MenuTab = 'geral' | 'personalizacoes';

// taxas de IVA em Portugal (23 normal, 13 intermédia, 6 reduzida, 0 isento)
const VAT_RATES = [23, 13, 6, 0];

export default function MenuPage() {
  const categories = useCategories();
  const products = useProducts();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();

  const [tab, setTab] = useState<MenuTab>('geral');
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

      {tab === 'personalizacoes' && <PersonalizacoesTab />}

      {tab === 'geral' && categories.isLoading && <p className="text-ink-mute">A carregar…</p>}

      {tab === 'geral' && categories.data?.length === 0 && (
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
        {tab === 'geral' && categories.data?.map((cat) => (
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
                <ProductRow key={p.id} product={p} onGoToLibrary={() => setTab('personalizacoes')} />
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

function ProductRow({ product, onGoToLibrary }: { product: Product; onGoToLibrary: () => void }) {
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
    <li>
      <div className="flex items-center justify-between gap-3 px-5 py-3">
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
                <Pencil size={11} className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover/desc:opacity-100" />
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
                  await detach.mutateAsync({ productId, groupId: g.id });
                  toast.success('Grupo desanexado');
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

function AddProductForm({ categoryId }: { categoryId: string }) {
  const create = useCreateProduct();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [vatRate, setVatRate] = useState(23);
  const [description, setDescription] = useState('');
  const [open, setOpen] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const priceNum = parseFloat(price.replace(',', '.'));
    if (!name.trim() || Number.isNaN(priceNum)) {
      toast.error('Indica nome e preço válidos');
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
