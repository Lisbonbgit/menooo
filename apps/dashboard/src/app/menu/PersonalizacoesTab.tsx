'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Layers, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  useCreateModifier,
  useCreateModifierGroup,
  useDeleteModifier,
  useDeleteModifierGroup,
  useModifierGroups,
  useUpdateModifierGroup,
} from '@/lib/catalog-hooks';
import type { MenuType, ModifierGroupWithUsage } from '@/lib/types';

const MAX_CHOICES = [1, 2, 3, 4, 5, 10];

/** Biblioteca de grupos de complementos do restaurante: cria-se aqui uma vez
 *  e anexa-se aos produtos na Vista geral. Editar aqui muda em todos os
 *  produtos onde o grupo está anexado. */
export function PersonalizacoesTab({ menu = 'delivery' }: { menu?: MenuType }) {
  const groups = useModifierGroups(menu);
  const createGroup = useCreateModifierGroup(menu);

  const [name, setName] = useState('');
  const [required, setRequired] = useState(false);
  const [maxSelect, setMaxSelect] = useState(1);

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error('Dá um nome ao grupo (ex.: Tamanho, Extras).');
    try {
      await createGroup.mutateAsync({ name: name.trim(), required, maxSelect });
      setName('');
      setRequired(false);
      setMaxSelect(1);
      toast.success('Grupo criado — anexa-o aos produtos na Vista geral');
    } catch {
      toast.error('Erro ao criar grupo');
    }
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={addGroup}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white px-5 py-4 shadow-card"
      >
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-ink-soft">Novo grupo</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Tamanho, Extras, Molhos…"
            className="w-52 rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] outline-none focus:border-brand"
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
            {MAX_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <button className="flex items-center gap-1 rounded-xl bg-brand px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-brand-dark">
          <Plus size={14} /> Criar grupo
        </button>
      </form>

      {groups.isLoading && <p className="text-ink-mute">A carregar…</p>}

      {groups.isError && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-[13px] text-red-700">
          Não foi possível carregar os grupos de complementos.
          <button
            onClick={() => groups.refetch()}
            className="font-semibold underline hover:no-underline"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {groups.data?.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line py-16 text-center">
          <Layers size={30} className="text-ink-mute" strokeWidth={1.5} />
          <div>
            <p className="font-medium">Ainda não tens grupos de complementos</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-ink-mute">
              Cria o primeiro acima — por exemplo <strong>Tamanho</strong> ou{' '}
              <strong>Extras</strong> — e depois anexa-o aos produtos na Vista geral. Mudar um
              preço aqui muda em todos os produtos que usam o grupo.
            </p>
          </div>
        </div>
      )}

      <div className="stagger space-y-3">
        {groups.data?.map((g) => (
          <GroupCard key={g.id} menu={menu} group={g} />
        ))}
      </div>
    </div>
  );
}

function GroupCard({ menu, group }: { menu: MenuType; group: ModifierGroupWithUsage }) {
  const del = useDeleteModifierGroup(menu);
  const update = useUpdateModifierGroup(menu);
  const createModifier = useCreateModifier(menu);
  const deleteModifier = useDeleteModifier(menu);

  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(group.name);

  async function saveName() {
    if (!name.trim()) return;
    try {
      await update.mutateAsync({ id: group.id, name: name.trim() });
      setEditName(false);
      toast.success('Nome guardado');
    } catch {
      toast.error('Erro ao guardar o nome');
    }
  }

  async function removeGroup() {
    const aviso =
      group.usedIn > 0
        ? `Apagar "${group.name}"? Está anexado a ${group.usedIn} produto(s) — as opções desaparecem desses produtos.`
        : `Apagar "${group.name}"?`;
    if (!confirm(aviso)) return;
    try {
      await del.mutateAsync({ id: group.id });
      toast.success('Grupo apagado');
    } catch {
      toast.error('Erro ao apagar o grupo');
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-card">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {editName ? (
            <span className="flex items-center gap-1.5">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-40 rounded-lg border border-line bg-white px-2.5 py-1 text-[13.5px] font-semibold outline-none focus:border-brand"
              />
              <button
                onClick={saveName}
                title="Guardar"
                className="rounded-lg bg-brand p-1.5 text-white hover:bg-brand-dark"
              >
                <Check size={13} />
              </button>
              <button
                onClick={() => {
                  setName(group.name);
                  setEditName(false);
                }}
                title="Cancelar"
                className="rounded-lg border border-line p-1.5 text-ink-mute hover:bg-cream"
              >
                <X size={13} />
              </button>
            </span>
          ) : (
            <button
              onClick={() => {
                setName(group.name);
                setEditName(true);
              }}
              className="group/nome flex items-center gap-1.5 text-[14px] font-semibold hover:text-brand-dark"
              title="Mudar o nome"
            >
              {group.name}
              <Pencil
                size={12}
                className="opacity-0 transition-opacity group-hover/nome:opacity-100"
              />
            </button>
          )}

          <button
            onClick={() =>
              update
                .mutateAsync({
                  id: group.id,
                  required: !group.required,
                  minSelect: group.required ? 0 : 1,
                })
                .catch(() => toast.error('Erro ao atualizar o grupo'))
            }
            title="Alternar entre obrigatório e opcional"
            className={
              'rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase transition-colors ' +
              (group.required
                ? 'bg-brand-soft text-brand-dark'
                : 'bg-stone-100 font-medium normal-case text-stone-500')
            }
          >
            {group.required ? 'obrigatório' : 'opcional'}
          </button>

          <select
            value={group.maxSelect}
            onChange={(e) =>
              update
                .mutateAsync({ id: group.id, maxSelect: Number(e.target.value) })
                .catch(() => toast.error('Erro ao atualizar o máximo de escolhas'))
            }
            title="Máximo de escolhas neste grupo"
            className="rounded-lg border border-line bg-white px-1.5 py-0.5 text-[11px] text-ink-soft outline-none focus:border-brand"
          >
            {MAX_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n === 1 ? 'escolhe 1' : `até ${n}`}
              </option>
            ))}
          </select>

          <span
            className={
              'rounded-full px-2 py-0.5 text-[10.5px] font-medium ' +
              (group.usedIn > 0 ? 'bg-cream text-ink-soft' : 'bg-stone-100 text-stone-400')
            }
          >
            {group.usedIn > 0
              ? `usado em ${group.usedIn} produto${group.usedIn === 1 ? '' : 's'}`
              : 'sem produtos'}
          </span>
        </div>

        <button
          onClick={removeGroup}
          className="rounded-lg p-1.5 text-ink-mute hover:bg-red-50 hover:text-red-600"
          title="Apagar grupo"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {group.modifiers.map((m) => (
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
              onClick={() =>
                deleteModifier
                  .mutateAsync({ id: m.id })
                  .catch(() => toast.error('Erro ao remover a opção'))
              }
              className="rounded-full p-0.5 text-ink-mute hover:bg-red-100 hover:text-red-600"
              title="Remover opção"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <AddModifierChip
          onAdd={async (nome, delta) => {
            try {
              await createModifier.mutateAsync({ groupId: group.id, name: nome, priceDelta: delta });
            } catch {
              toast.error('Erro ao adicionar opção');
            }
          }}
        />
      </div>
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
