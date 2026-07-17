'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Tablet, Copy, Unlink } from 'lucide-react';
import { api } from '@/lib/api';

// `||` e não `??`: o compose passa as NEXT_PUBLIC_* como string VAZIA quando não
// estão no .env, e o `??` só apanha null/undefined — com '' o fallback nunca
// dispararia e o link ficava relativo.
const STORE_URL = process.env.NEXT_PUBLIC_STORE_URL || 'https://menooo.com';

interface KitchenStatus {
  paired: boolean;
  pairedAt: string | null;
  activeSessions: number;
  pendingCode: boolean;
}

/**
 * Emparelhamento do tablet de cozinha, lado do dono.
 *
 * Os endpoints existem desde a Fase 1 e não tinham UI nenhuma: o código só se
 * conseguia gerar com curl, o que tornava o APK inútil na prática.
 */
export function KitchenPairing() {
  const [status, setStatus] = useState<KitchenStatus | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get<KitchenStatus>('/tenants/me/kitchen');
      setStatus(data);
    } catch {
      // secção informativa: uma falha aqui não deve estragar as Definições
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function generate() {
    setBusy(true);
    try {
      const { data } = await api.post<{ code: string; expiresAt: string }>(
        '/tenants/me/kitchen/pair-code',
      );
      setCode(data.code);
      toast.success('Código gerado. Válido 10 minutos.');
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Não foi possível gerar o código.');
    } finally {
      setBusy(false);
    }
  }

  async function unpair() {
    if (!confirm('Desemparelhar o tablet? Deixa de receber pedidos até voltares a emparelhar.')) {
      return;
    }
    setBusy(true);
    try {
      await api.delete('/tenants/me/kitchen');
      setCode(null);
      toast.success('Tablet desemparelhado.');
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Não foi possível desemparelhar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-[13.5px] leading-relaxed text-ink-soft">
        Instala a app a partir de{' '}
        <a
          href={`${STORE_URL}/cozinha`}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-brand hover:underline"
        >
          {STORE_URL.replace(/^https?:\/\//, '')}/cozinha
        </a>{' '}
        — abre esse endereço no browser do próprio tablet, não neste computador. Depois
        gera aqui um código e escreve-o na app.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="rounded-xl bg-espresso px-4 py-2.5 text-[13.5px] font-semibold text-cream transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'A gerar…' : 'Gerar código de emparelhamento'}
        </button>
        {status?.paired && (
          <button
            type="button"
            onClick={unpair}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
          >
            <Unlink size={14} /> Desemparelhar
          </button>
        )}
      </div>

      {code && (
        <div className="mt-4 rounded-xl border border-line bg-paper p-4">
          <p className="text-[11px] uppercase tracking-[0.16em] text-ink-mute">
            Escreve este código na app
          </p>
          <div className="mt-2 flex items-center gap-3">
            <code className="select-all font-mono text-[19px] font-semibold tracking-wider">
              {code}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(code);
                toast.success('Copiado.');
              }}
              className="text-ink-mute transition-colors hover:text-brand"
              title="Copiar"
            >
              <Copy size={15} />
            </button>
          </div>
          <p className="mt-2 text-[12px] text-ink-mute">Válido 10 minutos e só serve uma vez.</p>
        </div>
      )}

      {status && (
        <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-ink-mute">
          <Tablet size={13} />
          {status.paired
            ? `${status.activeSessions} tablet(s) ligado(s)${
                status.pairedAt
                  ? ` desde ${new Date(status.pairedAt).toLocaleDateString('pt-PT')}`
                  : ''
              }`
            : 'Nenhum tablet emparelhado'}
        </p>
      )}
    </div>
  );
}
