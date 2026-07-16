'use client';

import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { Armchair, Check, Eye, EyeOff, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCreateTable, useDeleteTable, useTables, useUpdateTable } from '@/lib/reservations-hooks';
import type { Table } from '@/lib/reservation-types';

const SEM_AREA = 'Sem área';

function errorMessage(e: any, fallback: string): string {
  return e?.response?.data?.message ?? fallback;
}

/** Gestão de mesas: lista agrupada por área, criar, editar, ativar/desativar, apagar. */
export function TablesManager(): JSX.Element {
  const tables = useTables();
  const create = useCreateTable();
  const update = useUpdateTable();
  const del = useDeleteTable();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const areas = useMemo(
    () => Array.from(new Set((tables.data ?? []).map((t) => t.area).filter((a): a is string => !!a))).sort(),
    [tables.data],
  );

  const groups = useMemo(() => {
    const sorted = [...(tables.data ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-PT'),
    );
    const byArea = new Map<string, Table[]>();
    for (const t of sorted) {
      const key = t.area ?? SEM_AREA;
      if (!byArea.has(key)) byArea.set(key, []);
      byArea.get(key)!.push(t);
    }
    // "Sem área" fica sempre no fim
    return Array.from(byArea.entries()).sort(([a], [b]) => {
      if (a === SEM_AREA) return 1;
      if (b === SEM_AREA) return -1;
      return a.localeCompare(b, 'pt-PT');
    });
  }, [tables.data]);

  async function toggleActive(t: Table) {
    try {
      await update.mutateAsync({ id: t.id, active: !t.active });
      toast.success(t.active ? 'Mesa desativada' : 'Mesa ativada');
    } catch (e: any) {
      toast.error(errorMessage(e, 'Erro ao atualizar a mesa'));
    }
  }

  async function removeTable(t: Table) {
    if (!confirm(`Apagar a mesa "${t.name}"?`)) return;
    try {
      await del.mutateAsync(t.id);
      toast.success('Mesa apagada');
    } catch (e: any) {
      if (e?.response?.status === 409) {
        toast.error(errorMessage(e, 'Esta mesa tem reservas no histórico — desativa-a em vez de apagar.'));
      } else {
        toast.error(errorMessage(e, 'Erro ao apagar a mesa'));
      }
    }
  }

  if (tables.isLoading) {
    return <p className="text-[13px] text-ink-mute">A carregar…</p>;
  }

  const noTables = (tables.data ?? []).length === 0;

  return (
    <div className="space-y-5">
      {noTables && !addOpen ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line py-16 text-center">
          <Armchair size={30} className="text-ink-mute" strokeWidth={1.5} />
          <div>
            <p className="font-medium">Ainda não tens mesas.</p>
            <p className="mt-1 text-[13px] text-ink-mute">
              Cria a primeira para começares a aceitar reservas.
            </p>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="mt-1 flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-[13px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark"
          >
            <Plus size={15} /> Mesa
          </button>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setAddOpen((v) => !v)}
              className={clsx(
                'flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-semibold shadow-card transition-colors',
                addOpen
                  ? 'border-brand bg-brand-soft text-brand-dark'
                  : 'border-line bg-white hover:border-brand/40',
              )}
            >
              <Plus size={15} /> Mesa
            </button>
          </div>

          {addOpen && (
            <TableForm
              areas={areas}
              submitLabel="Criar mesa"
              onCancel={() => setAddOpen(false)}
              onSubmit={async (body) => {
                await create.mutateAsync(body);
                toast.success('Mesa criada');
                setAddOpen(false);
              }}
            />
          )}

          <div className="stagger space-y-5">
            {groups.map(([area, list]) => (
              <section
                key={area}
                className="overflow-hidden rounded-xl border border-line bg-white shadow-card"
              >
                <div className="border-b border-line bg-cream/40 px-5 py-3">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-soft">
                    {area}
                  </h2>
                </div>
                <ul className="divide-y divide-line">
                  {list.map((t) =>
                    editingId === t.id ? (
                      <li key={t.id} className="px-5 py-4">
                        <TableForm
                          areas={areas}
                          initial={t}
                          submitLabel="Guardar"
                          onCancel={() => setEditingId(null)}
                          onSubmit={async (body) => {
                            await update.mutateAsync({ id: t.id, ...body });
                            toast.success('Mesa atualizada');
                            setEditingId(null);
                          }}
                        />
                      </li>
                    ) : (
                      <li
                        key={t.id}
                        className={clsx(
                          'flex flex-wrap items-center justify-between gap-3 px-5 py-3',
                          !t.active && 'opacity-60',
                        )}
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="text-[14px] font-medium">{t.name}</span>
                          <span className="text-[12.5px] tabular-nums text-ink-mute">
                            {t.seats} {t.seats === 1 ? 'lugar' : 'lugares'}
                          </span>
                          {t.joinable && <Chip label="Juntável" dot="bg-brand" text="text-brand-dark" />}
                          {!t.bookableOnline && (
                            <Chip label="Só balcão" dot="bg-amber-500" text="text-amber-700" />
                          )}
                          {!t.active && <Chip label="Inativa" dot="bg-stone-400" text="text-ink-soft" />}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setEditingId(t.id)}
                            title="Editar"
                            className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-brand/40 hover:text-brand-dark"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => toggleActive(t)}
                            title={t.active ? 'Desativar' : 'Ativar'}
                            className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-brand/40 hover:text-ink"
                          >
                            {t.active ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          <button
                            onClick={() => removeTable(t)}
                            title="Apagar"
                            className="rounded-lg border border-line p-1.5 text-ink-mute transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ label, dot, text }: { label: string; dot: string; text: string }) {
  return (
    <span className={clsx('flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide', text)}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', dot)} />
      {label}
    </span>
  );
}

interface TableFormBody {
  name: string;
  seats: number;
  area?: string;
  joinable: boolean;
  bookableOnline: boolean;
  sortOrder: number;
}

function TableForm({
  areas,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  areas: string[];
  initial?: Table;
  submitLabel: string;
  onSubmit: (body: TableFormBody) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [seats, setSeats] = useState(String(initial?.seats ?? 4));
  const [area, setArea] = useState(initial?.area ?? '');
  const [joinable, setJoinable] = useState(initial?.joinable ?? false);
  const [bookableOnline, setBookableOnline] = useState(initial?.bookableOnline ?? true);
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const seatsNum = parseInt(seats, 10);
    if (!name.trim()) {
      toast.error('Indica o nome da mesa.');
      return;
    }
    if (!Number.isInteger(seatsNum) || seatsNum < 1 || seatsNum > 50) {
      toast.error('Indica um número de lugares entre 1 e 50.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        seats: seatsNum,
        area: area.trim() || undefined,
        joinable,
        bookableOnline,
        sortOrder: parseInt(sortOrder, 10) || 0,
      });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Erro ao guardar a mesa');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={clsx(
        'space-y-4 rounded-xl border border-line bg-cream/30 p-4',
        !initial && 'shadow-card',
      )}
    >
      <div className="flex flex-wrap gap-3">
        <div className="min-w-40 flex-1 space-y-1.5">
          <label className="block text-[12px] font-medium text-ink-soft">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: M2"
            autoFocus
            className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-brand"
          />
        </div>
        <div className="w-24 space-y-1.5">
          <label className="block text-[12px] font-medium text-ink-soft">Lugares</label>
          <input
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            type="number"
            min={1}
            max={50}
            inputMode="numeric"
            className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] tabular-nums outline-none focus:border-brand"
          />
        </div>
        <div className="min-w-40 flex-1 space-y-1.5">
          <label className="block text-[12px] font-medium text-ink-soft">Área (opcional)</label>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Ex.: Esplanada"
            list="tables-manager-areas"
            className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-brand"
          />
          <datalist id="tables-manager-areas">
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div className="w-24 space-y-1.5">
          <label className="block text-[12px] font-medium text-ink-soft">Ordem</label>
          <input
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            type="number"
            inputMode="numeric"
            className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] tabular-nums outline-none focus:border-brand"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <ToggleField
          label="Juntável"
          help="Pode ser juntada a outra mesa juntável da mesma área."
          checked={joinable}
          onChange={setJoinable}
        />
        <ToggleField
          label="Reservável online"
          help="Desliga para guardar a mesa para walk-ins."
          checked={bookableOnline}
          onChange={setBookableOnline}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check size={14} /> {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-xl border border-line bg-white px-4 py-2 text-[13px] hover:bg-cream"
        >
          <X size={14} /> Cancelar
        </button>
      </div>
    </form>
  );
}

function ToggleField({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex min-w-52 flex-1 items-center justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5">
      <div>
        <p className="text-[12.5px] font-medium">{label}</p>
        <p className="text-[11px] text-ink-mute">{help}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-label={`Alternar ${label.toLowerCase()}`}
        className={clsx(
          'relative h-6 w-10 shrink-0 rounded-full transition-colors',
          checked ? 'bg-green-500' : 'bg-stone-300',
        )}
      >
        <span
          className={clsx(
            'absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all',
            checked ? 'left-5' : 'left-1',
          )}
        />
      </button>
    </div>
  );
}
