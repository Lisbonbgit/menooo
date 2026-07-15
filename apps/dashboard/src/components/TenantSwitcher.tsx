'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ChevronsUpDown, Plus, Store, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

interface Unit {
  id: string;
  slug: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  logoUrl: string | null;
  city: string | null;
}

const STATUS_LABEL: Record<Unit['status'], string> = {
  PENDING: 'em análise',
  ACTIVE: 'ativa',
  SUSPENDED: 'suspensa',
  CLOSED: 'fechada',
};

/** Seletor de unidade (loja) + adicionar nova unidade à conta do dono. */
export function TenantSwitcher({ activeId, dropUp = true }: { activeId?: string; dropUp?: boolean }) {
  const qc = useQueryClient();
  const { token, setSession } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const units = useQuery({
    queryKey: ['tenants-mine'],
    queryFn: async () => (await api.get<Unit[]>('/tenants/mine')).data,
    enabled: !!token,
  });

  const list = units.data ?? [];
  const active = list.find((u) => u.id === activeId);

  async function switchTo(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post<{ accessToken: string; refreshToken: string }>('/auth/switch', {
        tenantId: id,
      });
      setSession(data.accessToken, data.refreshToken);
      await qc.invalidateQueries();
      setOpen(false);
      toast.success('Unidade trocada');
    } catch {
      toast.error('Não foi possível trocar de unidade.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-espresso-light"
        title="Trocar de unidade"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-cream">{active?.name ?? '…'}</p>
          <p className="text-[11px] text-cream/50">
            {list.length > 1 ? `${list.length} unidades` : 'trocar / adicionar'}
          </p>
        </div>
        <ChevronsUpDown size={14} className="shrink-0 text-cream/40" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={
              'absolute left-0 z-50 w-64 overflow-hidden rounded-xl border border-line bg-white shadow-lift ' +
              (dropUp ? 'bottom-full mb-2' : 'top-full mt-2')
            }
          >
            <p className="border-b border-line px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-mute">
              As tuas unidades
            </p>
            <ul className="max-h-64 overflow-y-auto py-1">
              {list.map((u) => (
                <li key={u.id}>
                  <button
                    disabled={busy}
                    onClick={() => switchTo(u.id)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-cream/60 disabled:opacity-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-soft text-brand-dark">
                      {u.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.logoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Store size={14} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{u.name}</span>
                      <span className="block text-[11px] text-ink-mute">{STATUS_LABEL[u.status]}</span>
                    </span>
                    {u.id === activeId && <Check size={15} className="shrink-0 text-brand" />}
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => {
                setAdding(true);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-[13px] font-medium text-brand transition-colors hover:bg-brand-soft/50"
            >
              <Plus size={15} /> Adicionar unidade
            </button>
          </div>
        </>
      )}

      {adding && <AddUnitModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddUnitModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);

  // sugere um slug a partir do nome
  function onName(v: string) {
    setName(v);
    setSlug(
      v
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      toast.error('Indica o nome e o endereço da nova unidade.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/tenants', { name: name.trim(), slug: slug.trim() });
      await qc.invalidateQueries({ queryKey: ['tenants-mine'] });
      toast.success('Unidade criada — fica em análise até a equipa ativar.');
      onClose();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Não foi possível criar a unidade.';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-espresso/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lift"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-display text-[18px] font-semibold">Nova unidade</h3>
            <p className="mt-0.5 text-[12.5px] text-ink-mute">
              Fica na tua conta e usa a mesma subscrição. Precisa de ativação da equipa.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-mute hover:bg-cream">
            <X size={17} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className="block text-[12.5px] font-medium text-ink-soft">Nome da unidade</label>
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder="Ex.: Pizzaria do Zé — Porto"
              autoFocus
              className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-brand"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[12.5px] font-medium text-ink-soft">
              Endereço da loja (link)
            </label>
            <div className="flex items-center rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] focus-within:border-brand">
              <span className="text-ink-mute">menooo.com/</span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="pizzaria-do-ze-porto"
                className="min-w-0 flex-1 outline-none"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-brand px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {busy ? 'A criar…' : 'Criar unidade'}
          </button>
        </form>
      </div>
    </div>
  );
}
