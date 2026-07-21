'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { Check, Eye, EyeOff, Pencil, Plus, Printer, QrCode as QrCodeIcon, Trash2, X } from 'lucide-react';
import {
  useBulkDineTables,
  useCreateDineTable,
  useDeleteDineTable,
  useDineTables,
  useUpdateDineTable,
  type DineTable,
} from '@/lib/dine-tables-hooks';
import { useTenant } from '@/lib/settings-hooks';

const STORE = process.env.NEXT_PUBLIC_STORE_URL ?? 'https://menooo.com';

function tableUrl(slug: string, table: DineTable): string {
  return `${STORE}/${slug}/mesa/${table.qrToken}`;
}

function errorMessage(e: any, fallback: string): string {
  return e?.response?.data?.message ?? fallback;
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

/** Abre uma janela só com o QR grande + "Mesa X" + o nome da loja, e imprime-a. */
function printQr(dataUrl: string, tableName: string, storeName: string) {
  const w = window.open('', '_blank', 'width=480,height=640');
  if (!w) {
    toast.error('Pop-up bloqueado. Permite pop-ups para imprimir o QR.');
    return;
  }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR — ${esc(tableName)}</title>
  <style>
    @page { margin: 10mm; }
    body { font-family: system-ui, -apple-system, sans-serif; text-align: center; margin: 0; padding: 32px 24px; color: #1a1310; }
    h1 { font-size: 24px; margin: 0 0 6px; }
    p { margin: 0 0 24px; color: #6b5f58; font-size: 14px; }
    img { width: 100%; max-width: 380px; height: auto; }
  </style></head><body onload="window.print()">
    <h1>${esc(tableName)}</h1>
    <p>${esc(storeName)}</p>
    <img src="${dataUrl}" alt="QR ${esc(tableName)}" />
  </body></html>`);
  w.document.close();
}

/**
 * Sub-aba "QR Code" do menu de Sala: gere as mesas de sala (nome, ativo/inativo) e o QR
 * público de cada uma (gerado no browser com `qrcode`, a partir do `qrToken` do Task 1).
 */
export function DineTablesTab({ slug }: { slug?: string }) {
  const tenant = useTenant();
  const tables = useDineTables();
  const create = useCreateDineTable();
  const bulk = useBulkDineTables();

  const [name, setName] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState('4');
  const [bulkPrefix, setBulkPrefix] = useState('');

  const storeName = tenant.data?.name ?? 'A tua loja';

  async function addTable(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Indica o nome da mesa (ex.: Mesa 1).');
      return;
    }
    try {
      await create.mutateAsync(name.trim());
      setName('');
      toast.success('Mesa criada');
    } catch (err: any) {
      toast.error(errorMessage(err, 'Erro ao criar a mesa'));
    }
  }

  async function addBulk(e: React.FormEvent) {
    e.preventDefault();
    const count = parseInt(bulkCount, 10);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      toast.error('Indica um número de mesas entre 1 e 100.');
      return;
    }
    try {
      await bulk.mutateAsync({ count, prefix: bulkPrefix.trim() || undefined });
      toast.success(count === 1 ? '1 mesa criada' : `${count} mesas criadas`);
      setBulkOpen(false);
      setBulkCount('4');
      setBulkPrefix('');
    } catch (err: any) {
      toast.error(errorMessage(err, 'Erro ao criar as mesas'));
    }
  }

  if (!slug || tables.isLoading) {
    return <p className="text-ink-mute">A carregar…</p>;
  }

  const list = tables.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-4 shadow-card">
        <form onSubmit={addTable} className="flex min-w-56 flex-1 items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <label className="block text-[12px] font-medium text-ink-soft">Nova mesa</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Mesa 1"
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-brand"
            />
          </div>
          <button
            type="submit"
            disabled={create.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus size={16} /> Adicionar
          </button>
        </form>
        <button
          onClick={() => setBulkOpen((v) => !v)}
          className={
            'flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13.5px] font-semibold transition-colors ' +
            (bulkOpen
              ? 'border-brand bg-brand-soft text-brand-dark'
              : 'border-line bg-white hover:border-brand/40')
          }
        >
          <Plus size={15} /> Adicionar várias
        </button>
      </div>

      {bulkOpen && (
        <form
          onSubmit={addBulk}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-cream/30 p-4"
        >
          <div className="w-28 space-y-1.5">
            <label className="block text-[12px] font-medium text-ink-soft">Quantas</label>
            <input
              value={bulkCount}
              onChange={(e) => setBulkCount(e.target.value)}
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] tabular-nums outline-none focus:border-brand"
            />
          </div>
          <div className="min-w-40 flex-1 space-y-1.5">
            <label className="block text-[12px] font-medium text-ink-soft">Prefixo (opcional)</label>
            <input
              value={bulkPrefix}
              onChange={(e) => setBulkPrefix(e.target.value)}
              placeholder="Mesa"
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-brand"
            />
          </div>
          <button
            type="submit"
            disabled={bulk.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check size={14} /> Criar mesas
          </button>
          <button
            type="button"
            onClick={() => setBulkOpen(false)}
            className="flex items-center gap-1.5 rounded-xl border border-line bg-white px-4 py-2 text-[13.5px] hover:bg-cream"
          >
            <X size={14} /> Cancelar
          </button>
        </form>
      )}

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line py-16 text-center">
          <QrCodeIcon size={30} className="text-ink-mute" strokeWidth={1.5} />
          <div>
            <p className="font-medium">Ainda não tens mesas de sala.</p>
            <p className="mt-1 text-[13px] text-ink-mute">
              Cria a primeira acima — cada mesa fica com o seu próprio QR.
            </p>
          </div>
        </div>
      ) : (
        <ul className="stagger divide-y divide-line overflow-hidden rounded-xl border border-line bg-white shadow-card">
          {list.map((t) => (
            <DineTableRow key={t.id} table={t} slug={slug} storeName={storeName} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DineTableRow({
  table,
  slug,
  storeName,
}: {
  table: DineTable;
  slug: string;
  storeName: string;
}) {
  const update = useUpdateDineTable();
  const del = useDeleteDineTable();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(table.name);
  const [img, setImg] = useState('');

  const url = tableUrl(slug, table);

  // gerar o QR (data-url) no browser sempre que o url da mesa mudar (ex.: slug ainda a carregar)
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: 512, margin: 2 }).then((dataUrl) => {
      if (!cancelled) setImg(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('O nome da mesa não pode ficar vazio.');
      return;
    }
    try {
      await update.mutateAsync({ id: table.id, name: trimmed });
      setEditing(false);
      toast.success('Mesa atualizada');
    } catch (err: any) {
      toast.error(errorMessage(err, 'Erro ao guardar o nome'));
    }
  }

  function cancelName() {
    setName(table.name);
    setEditing(false);
  }

  async function toggleActive() {
    try {
      await update.mutateAsync({ id: table.id, active: !table.active });
    } catch (err: any) {
      toast.error(errorMessage(err, 'Erro ao atualizar a mesa'));
    }
  }

  async function remove() {
    if (!confirm(`Apagar a mesa "${table.name}"? O QR impresso deixa de funcionar.`)) return;
    try {
      await del.mutateAsync(table.id);
      toast.success('Mesa apagada');
    } catch (err: any) {
      toast.error(errorMessage(err, 'Erro ao apagar a mesa'));
    }
  }

  return (
    <li
      className={
        'flex flex-wrap items-center gap-3 px-4 py-3 ' + (table.active ? '' : 'opacity-50')
      }
    >
      {img ? (
        <img
          src={img}
          alt={`QR ${table.name}`}
          className="h-14 w-14 shrink-0 rounded-lg border border-line bg-white p-1"
        />
      ) : (
        <div className="h-14 w-14 shrink-0 rounded-lg border border-dashed border-line bg-cream/40" />
      )}

      <div className="min-w-40 flex-1">
        {editing ? (
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
              className="rounded-lg border border-line bg-white px-2.5 py-1 text-[13.5px] outline-none focus:border-brand"
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
              setName(table.name);
              setEditing(true);
            }}
            className="group/table flex items-center gap-1.5 text-left"
            title="Editar nome da mesa"
          >
            <span className="text-[14px] font-medium">{table.name}</span>
            {!table.active && (
              <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10.5px] font-semibold text-stone-500">
                inativa
              </span>
            )}
            <Pencil
              size={13}
              className="shrink-0 text-ink-mute opacity-0 transition-opacity group-hover/table:opacity-100"
            />
          </button>
        )}
        <p className="mt-0.5 truncate text-[11.5px] text-ink-mute">{url}</p>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => img && printQr(img, table.name, storeName)}
          disabled={!img}
          title="Imprimir QR"
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:border-brand/40 hover:text-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Printer size={14} /> Imprimir QR
        </button>
        <button
          onClick={toggleActive}
          title={table.active ? 'Desativar' : 'Ativar'}
          className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-cream hover:text-ink"
        >
          {table.active ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <button
          onClick={remove}
          title="Apagar"
          className="rounded-lg p-1.5 text-ink-mute transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  );
}
