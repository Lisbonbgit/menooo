'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Flame, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';

const input =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] shadow-card outline-none transition-colors focus:border-brand';

/** Reposição de password: pede o código por email e define a password nova. */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      toast.success('Se o email existir, enviámos um código.');
      setStep('reset');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Erro ao pedir o código');
    } finally {
      setLoading(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { email, code, newPassword: password });
      toast.success('Password alterada — entra com a nova.');
      router.replace('/login');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Código inválido ou expirado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="animate-fade-up w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
            <Flame size={18} />
          </span>
          <span className="font-display text-xl font-semibold">Menooo</span>
        </div>

        <h2 className="font-display text-[26px] font-semibold tracking-tight">
          Repor a password
        </h2>

        {step === 'email' ? (
          <form onSubmit={requestCode}>
            <p className="mb-8 mt-1 text-[13.5px] text-ink-soft">
              Diz-nos o email da conta e enviamos-te um código de 6 dígitos.
            </p>
            <label className="mb-1.5 block text-[13px] font-medium">Email</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="dono@restaurante.pt"
              className={`${input} mb-6`}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand py-3 text-[14.5px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
            >
              {loading ? 'A enviar…' : 'Enviar código'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitReset}>
            <p className="mb-8 mt-1 text-[13.5px] text-ink-soft">
              Enviámos um código para <strong>{email}</strong> (vale 20 minutos). Escreve-o e
              escolhe a password nova.
            </p>
            <label className="mb-1.5 block text-[13px] font-medium">Código de 6 dígitos</label>
            <input
              required
              autoFocus
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className={`${input} mb-4 text-center font-display text-[22px] tracking-[0.4em]`}
            />
            <label className="mb-1.5 block text-[13px] font-medium">Password nova</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo 8 caracteres"
              className={`${input} mb-6`}
            />
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[14.5px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
            >
              <KeyRound size={15} />
              {loading ? 'A alterar…' : 'Alterar password'}
            </button>
            <button
              type="button"
              onClick={() => setStep('email')}
              className="mt-3 w-full text-center text-[12.5px] font-medium text-ink-soft hover:text-ink"
            >
              Não recebeste? Pedir outro código
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-[13px] text-ink-soft">
          Lembraste-te?{' '}
          <a href="/login" className="font-semibold text-brand hover:underline">
            Voltar ao login
          </a>
        </p>
      </div>
    </main>
  );
}
