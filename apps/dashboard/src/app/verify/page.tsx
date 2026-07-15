'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { MailCheck, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const setAuth = useAuthStore((s) => s.setAuth);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return toast.error('Escreve o código de 6 dígitos.');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/verify-email', { email, code });
      setAuth(data.accessToken, data.refreshToken, data.user);
      toast.success('Email confirmado — bem-vindo ao Menooo');
      router.replace('/overview');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Código incorreto.');
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (cooldown > 0) return;
    try {
      await api.post('/auth/resend-code', { email });
      toast.success('Novo código enviado.');
      setCooldown(60);
      const t = setInterval(
        () =>
          setCooldown((c) => {
            if (c <= 1) {
              clearInterval(t);
              return 0;
            }
            return c - 1;
          }),
        1000,
      );
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Não foi possível reenviar.');
    }
  }

  if (!email) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5 text-center">
        <div>
          <p className="font-display text-xl font-semibold">Falta o email</p>
          <p className="mt-1 text-[13.5px] text-ink-soft">Volta ao registo ou ao login.</p>
          <Link href="/login" className="mt-4 inline-block font-semibold text-brand hover:underline">
            Ir para o login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <form onSubmit={onSubmit} className="animate-fade-up w-full max-w-sm text-center">
        <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-dark">
          <MailCheck size={24} />
        </span>
        <h2 className="font-display text-[26px] font-semibold tracking-tight">Confirma o teu email</h2>
        <p className="mb-7 mt-1 text-[13.5px] text-ink-soft">
          Enviámos um código de 6 dígitos para <strong className="text-ink">{email}</strong>.
        </p>

        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className="mb-5 w-full rounded-xl border border-line bg-white py-3 text-center text-[28px] font-semibold tracking-[0.5em] shadow-card outline-none focus:border-brand"
        />

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[14.5px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99] disabled:opacity-50"
        >
          {loading ? 'A confirmar…' : 'Confirmar'} {!loading && <ArrowRight size={16} />}
        </button>

        <p className="mt-5 text-[13px] text-ink-soft">
          Não recebeste?{' '}
          <button
            type="button"
            onClick={resend}
            disabled={cooldown > 0}
            className="font-semibold text-brand hover:underline disabled:text-ink-mute disabled:no-underline"
          >
            {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar código'}
          </button>
        </p>
        <p className="mt-2 text-[13px]">
          <Link href="/login" className="text-ink-mute hover:underline">
            Voltar ao login
          </Link>
        </p>
      </form>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
