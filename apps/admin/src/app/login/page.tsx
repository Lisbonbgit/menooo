'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Flame, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      if (data.user?.role !== 'SUPER_ADMIN') {
        toast.error('Esta área é só para administradores da plataforma.');
        return;
      }
      setAuth(data.accessToken, data.user.name);
      router.replace('/tenants');
    } catch {
      toast.error('Credenciais inválidas');
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
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-espresso text-cream">
            <Flame size={20} className="text-brand" />
          </span>
          <div>
            <p className="font-display text-xl font-semibold leading-none">Comanda</p>
            <p className="mt-1 flex items-center gap-1 text-[11px] uppercase tracking-[0.16em] text-ink-mute">
              <ShieldCheck size={12} /> administração
            </p>
          </div>
        </div>

        <label className="mb-1.5 block text-[13px] font-medium">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none transition-colors focus:border-brand"
        />

        <label className="mb-1.5 block text-[13px] font-medium">Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-6 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none transition-colors focus:border-brand"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-brand py-3 text-[14.5px] font-semibold text-white shadow-card transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          {loading ? 'A entrar…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
