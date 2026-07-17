import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ReservarClient } from './ReservarClient';

// O gate NÃO pode ser cacheado (spec §7): com `revalidate` o `notFound()` de uma loja com as
// reservas desligadas ficava em cache e o dono, ao ligar o interruptor e abrir o link do
// painel, levava 404 durante 5 minutos — o primeiro gesto que ele faz.
export const dynamic = 'force-dynamic';

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/api';

interface PublicStore {
  name: string;
  city: string | null;
  coverUrl: string | null;
}

/** null = loja inexistente (404). undefined = erro de rede — não deitar a página abaixo. */
async function getStore(slug: string): Promise<PublicStore | null | undefined> {
  try {
    const res = await fetch(`${API}/public/stores/${slug}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) return undefined;
    return (await res.json()) as PublicStore;
  } catch {
    return undefined;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const s = await getStore(slug);
  if (!s) return { title: 'Reservar mesa' };
  const local = s.city ? ` em ${s.city}` : '';
  return {
    title: `Reservar mesa — ${s.name}`,
    description: `Reserva a tua mesa n${'’'}${s.name}${local}. Confirmação imediata, grátis e sem compromisso.`,
    // Indexável de propósito — ao contrário do checkout, que é um passo privado de funil.
    // Isto é uma landing pública e sem estado: é o que se procura por «reservar mesa <loja>».
    robots: { index: true, follow: true },
    openGraph: { images: s.coverUrl ? [s.coverUrl] : [] },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await getStore(slug);
  if (store === null) notFound(); // loja inexistente — reservas desligadas é OUTRO estado (§9)
  return <ReservarClient slug={slug} />;
}
