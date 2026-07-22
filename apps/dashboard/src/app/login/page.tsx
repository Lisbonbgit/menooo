'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Flame, BellRing, Printer, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PasswordInput } from '@/components/PasswordInput';

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
      if (data.needsVerification) {
        toast.info('Confirma o teu email para entrar.');
        router.replace(`/verify?email=${encodeURIComponent(email)}`);
        return;
      }
      setAuth(data.accessToken, data.refreshToken, data.user);
      toast.success('Sessão iniciada');
      router.replace('/overview');
    } catch {
      toast.error('Credenciais inválidas');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen">
      {/* painel de marca */}
      <aside className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-espresso p-12 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'radial-gradient(#F3EBDF 1.2px, transparent 1.2px)',
            backgroundSize: '26px 26px',
          }}
        />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white shadow-lift">
            <Flame size={22} strokeWidth={2.4} />
          </span>
          <span className="font-display text-2xl font-semibold text-cream">Menooo</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-display text-4xl font-semibold leading-tight text-cream">
            A tua cozinha,
            <br />
            <em className="text-brand">no comando.</em>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-cream/60">
            Encomendas online sem comissões. Os pedidos chegam ao balcão em tempo real, com alarme
            e talão impresso.
          </p>
          <ul className="mt-8 space-y-3.5">
            {[
              { icon: <BellRing size={16} />, t: 'Receção ao vivo com alarme sonoro' },
              { icon: <Printer size={16} />, t: 'Impressão automática do talão' },
              { icon: <TrendingUp size={16} />, t: 'Vendas e indicadores do dia' },
            ].map((f) => (
              <li key={f.t} className="flex items-center gap-3 text-[13.5px] text-cream/75">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-espresso-light text-brand">
                  {f.icon}
                </span>
                {f.t}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[12px] text-cream/35">
          © {new Date().getFullYear()} Menooo — sistema de encomendas para restaurantes
        </p>
      </aside>

      {/* formulário */}
      <section className="flex flex-1 items-center justify-center px-5 py-10">
        <form onSubmit={onSubmit} className="animate-fade-up w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
              <Flame size={18} />
            </span>
            <span className="font-display text-xl font-semibold">Menooo</span>
          </div>

          <h2 className="font-display text-[26px] font-semibold tracking-tight">Entrar no painel</h2>
          <p className="mb-8 mt-1 text-[13.5px] text-ink-soft">
            Gere o teu menu e recebe encomendas em tempo real.
          </p>

          <label className="mb-1.5 block text-[13px] font-medium">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dono@restaurante.pt"
            className="mb-4 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] shadow-card outline-none transition-colors focus:border-brand"
          />

          <div className="mb-1.5 flex items-baseline justify-between">
            <label className="block text-[13px] font-medium">Password</label>
            <a href="/forgot" className="text-[12px] font-medium text-brand hover:underline">
              Esqueci-me da password
            </a>
          </div>
          <PasswordInput
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            containerClassName="mb-6"
            className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] shadow-card outline-none transition-colors focus:border-brand"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand py-3 text-[14.5px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
          >
            {loading ? 'A entrar…' : 'Entrar'}
          </button>

          <p className="mt-5 text-center text-[13px] text-ink-soft">
            Ainda não tens conta?{' '}
            <a href="/register" className="font-semibold text-brand hover:underline">
              Regista o teu restaurante
            </a>
          </p>

          {/* Sem isto o tablet de cozinha fica num beco: uma instalação nova não
              tem kitchenDevice no localStorage, o guard manda-o para aqui, e este
              ecrã pede credenciais do dono que a cozinha não tem. */}
          <p className="mt-3 text-center text-[13px]">
            <a href="/pair" className="font-medium text-ink-mute hover:text-brand hover:underline">
              Este é um tablet de cozinha
            </a>
          </p>
        </form>
      </section>
    </main>
  );
}
