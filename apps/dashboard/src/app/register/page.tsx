'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Flame, Store, ArrowRight, Percent, BellRing, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

const STORE_URL = process.env.NEXT_PUBLIC_STORE_URL ?? 'http://187.124.4.163:8080';

function toSlug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [restaurantName, setRestaurantName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  function onNameChange(v: string) {
    setRestaurantName(v);
    if (!slugTouched) setSlug(toSlug(v));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) return toast.error('Escolhe o endereço da loja.');
    if (password.length < 8) return toast.error('A password precisa de 8+ caracteres.');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        restaurantName,
        slug,
        ownerName,
        email,
        password,
      });
      setAuth(data.accessToken, data.user);
      toast.success('Loja criada! Bem-vindo ao Menoo 🎉');
      router.replace('/overview');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Não foi possível criar a conta.');
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] shadow-card outline-none transition-colors focus:border-brand';

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
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand text-white shadow-lift">
            <Flame size={22} strokeWidth={2.4} />
          </span>
          <span className="font-display text-2xl font-semibold text-cream">Menoo</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-display text-4xl font-semibold leading-tight text-cream">
            Abre a tua loja online <em className="text-brand">hoje.</em>
          </h1>
          <ul className="mt-8 space-y-3.5">
            {[
              { icon: <Percent size={16} />, t: '0% de comissões — o dinheiro é todo teu' },
              { icon: <BellRing size={16} />, t: 'Pedidos no balcão em tempo real' },
              { icon: <Printer size={16} />, t: 'Talão automático na impressora' },
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
          A loja fica pendente de uma aprovação rápida da equipa antes de aparecer ao público.
        </p>
      </aside>

      {/* formulário */}
      <section className="flex flex-1 items-center justify-center px-5 py-10">
        <form onSubmit={onSubmit} className="animate-fade-up w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
              <Flame size={18} />
            </span>
            <span className="font-display text-xl font-semibold">Menoo</span>
          </div>

          <h2 className="font-display text-[26px] font-semibold tracking-tight">
            Criar a minha loja
          </h2>
          <p className="mb-7 mt-1 text-[13.5px] text-ink-soft">
            Grátis, sem cartão. Em 2 minutos estás dentro do painel.
          </p>

          <label className="mb-1.5 block text-[13px] font-medium">Nome do restaurante</label>
          <input
            required
            value={restaurantName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Pizzaria do Zé"
            className={`${inputCls} mb-4`}
          />

          <label className="mb-1.5 block text-[13px] font-medium">Endereço da loja</label>
          <div className="mb-1 flex items-center gap-0 overflow-hidden rounded-xl border border-line bg-white shadow-card focus-within:border-brand">
            <span className="flex items-center gap-1.5 border-r border-line bg-cream/60 px-3 py-2.5 text-[12px] text-ink-mute">
              <Store size={13} /> /
            </span>
            <input
              required
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(toSlug(e.target.value));
              }}
              placeholder="pizzaria-do-ze"
              className="w-full bg-transparent px-3 py-2.5 text-[14px] outline-none"
            />
          </div>
          <p className="mb-4 text-[11.5px] text-ink-mute">
            A tua loja: {STORE_URL.replace(/^https?:\/\//, '')}/{slug || 'o-teu-nome'}
          </p>

          <label className="mb-1.5 block text-[13px] font-medium">O teu nome</label>
          <input
            required
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="José Silva"
            className={`${inputCls} mb-4`}
          />

          <label className="mb-1.5 block text-[13px] font-medium">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ze@pizzaria.pt"
            className={`${inputCls} mb-4`}
          />

          <label className="mb-1.5 block text-[13px] font-medium">Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="mínimo 8 caracteres"
            className={`${inputCls} mb-6`}
          />

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[14.5px] font-semibold text-white shadow-lift transition-all hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
          >
            {loading ? 'A criar a loja…' : 'Criar loja'} {!loading && <ArrowRight size={16} />}
          </button>

          <p className="mt-5 text-center text-[13px] text-ink-soft">
            Já tens conta?{' '}
            <Link href="/login" className="font-semibold text-brand hover:underline">
              Entrar
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
