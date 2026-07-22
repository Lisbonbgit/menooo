'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Utensils, X } from 'lucide-react';
import {
  useCloseSession,
  useOpenSessions,
  type OpenTableSession,
} from '@/lib/dine-tables-hooks';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Novo',
  ACCEPTED: 'Aceite',
  PREPARING: 'Em preparação',
  READY: 'Pronto',
  OUT_FOR_DELIVERY: 'Em entrega',
  COMPLETED: 'Concluído',
  REJECTED: 'Recusado',
  CANCELLED: 'Cancelado',
};

function elapsed(iso: string) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

function errorMessage(e: any, fallback: string): string {
  return e?.response?.data?.message ?? fallback;
}

/**
 * Secção "Mesas abertas" da Receção: contas em curso das mesas de sala (Fase 2b, Task 4).
 * Fica escondida quando não há nenhuma conta aberta — não polui a Receção de quem não usa
 * pedidos na mesa.
 */
export function OpenTables() {
  const sessions = useOpenSessions();
  const close = useCloseSession();
  const [closingId, setClosingId] = useState<string | null>(null);

  const list = sessions.data ?? [];
  if (list.length === 0) return null;

  async function closeTable(s: OpenTableSession) {
    if (!confirm(`Fechar a conta da "${s.table}"? Esta ação não pode ser desfeita.`)) return;
    setClosingId(s.id);
    try {
      await close.mutateAsync(s.id);
      toast.success(`${s.table} fechada`);
    } catch (e: any) {
      toast.error(errorMessage(e, 'Erro ao fechar a mesa'));
    } finally {
      setClosingId(null);
    }
  }

  return (
    <section className="animate-fade-up mb-5 rounded-xl border border-line bg-white p-5 shadow-card">
      <header className="mb-3.5 flex items-center gap-2.5">
        <span className="text-ink-mute">
          <Utensils size={17} />
        </span>
        <h2 className="font-display text-[16px] font-semibold leading-tight">Mesas abertas</h2>
        <span className="ml-auto rounded-full bg-cream px-2 py-0.5 text-[11.5px] font-semibold text-ink-soft">
          {list.length}
        </span>
      </header>

      <ul className="stagger divide-y divide-line">
        {list.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-48 flex-1">
              <p className="text-[14px] font-medium">{s.table}</p>
              <p className="mt-0.5 text-[11.5px] text-ink-mute">
                Aberta há {elapsed(s.openedAt)} · {s.orders.length}{' '}
                {s.orders.length === 1 ? 'pedido' : 'pedidos'}
              </p>
              {s.orders.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.orders.map((o) => (
                    <span
                      key={o.id}
                      className="rounded-full bg-cream px-2 py-0.5 text-[10.5px] font-medium text-ink-soft"
                    >
                      #{o.number} · {STATUS_LABELS[o.status] ?? o.status}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="font-display text-[15px] font-semibold">{s.total.toFixed(2)} €</span>
              <button
                onClick={() => closeTable(s)}
                disabled={closingId === s.id}
                className="flex items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 py-2 text-[12.5px] font-semibold text-ink-soft transition-colors hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X size={13} /> Fechar mesa
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
