'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Flame, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { usePrintStore } from '@/lib/print-store';

/** Emparelhamento do tablet de cozinha por código (gerado pelo dono no painel). */
export default function PairPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setKitchenDevice = useAuthStore((s) => s.setKitchenDevice);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/kitchen/pair', { code });
      setAuth(data.accessToken, data.refreshToken, data.user);
      setKitchenDevice(true);
      // tablet de cozinha acabado de emparelhar: auto-imprimir ligado por omissão
      usePrintStore.getState().setAutoPrint(true);
      toast.success(`Tablet emparelhado com ${data.tenant.name}`);
      router.replace('/orders');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Código inválido ou expirado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-espresso px-4">
      <form
        onSubmit={onSubmit}
        className="animate-fade-up w-full max-w-sm rounded-3xl border border-line bg-paper p-8 shadow-lift"
      >
        <div className="mb-7 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-espresso text-cream">
            <Flame size={20} className="text-brand" />
          </span>
          <div>
            <p className="font-display text-xl font-semibold leading-none">Menooo</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] uppercase tracking-[0.16em] text-ink-mute">
              <KeyRound size={12} /> tablet de cozinha
            </p>
          </div>
        </div>

        <h1 className="font-display text-[22px] font-semibold tracking-tight">
          Emparelhar este tablet
        </h1>
        <p className="mb-6 mt-1 text-[13px] leading-relaxed text-ink-soft">
          No painel do dono, abre as definições de impressão e gera um código de
          emparelhamento. Escreve-o aqui.
        </p>

        <label className="mb-1.5 block text-[13px] font-medium">Código</label>
        <input
          autoFocus
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          className="mb-6 w-full rounded-xl border border-line bg-white px-3.5 py-3 text-center font-mono text-[17px] tracking-[0.2em] outline-none transition-colors focus:border-brand"
        />

        <button
          type="submit"
          disabled={loading || code.length < 12}
          className="w-full rounded-xl bg-brand py-3 text-[14.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          {loading ? 'A emparelhar…' : 'Emparelhar'}
        </button>

        <p className="mt-5 text-center text-[12px] text-ink-mute">
          O código é de uso único e expira em 10 minutos.
        </p>
      </form>
    </main>
  );
}
