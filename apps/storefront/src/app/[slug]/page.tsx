import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StoreClient } from './StoreClient';

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/api';

interface StoreMeta {
  name: string;
  city: string | null;
  coverUrl: string | null;
  logoUrl: string | null;
}

// 'missing' = a API respondeu 404 (loja não existe); null = erro de rede/transitório
type StoreResult = StoreMeta | 'missing' | null;

/** Lê a loja no servidor (para title/OG e para decidir o 404). */
async function fetchStore(slug: string): Promise<StoreResult> {
  try {
    const res = await fetch(`${API}/public/stores/${slug}`, { next: { revalidate: 300 } });
    if (res.status === 404) return 'missing';
    if (!res.ok) return null;
    return (await res.json()) as StoreMeta;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const store = await fetchStore(slug);
  if (!store || store === 'missing') {
    return { title: 'Loja — Menooo', description: 'Encomenda online, direta ao restaurante.' };
  }

  const title = `${store.name} — Encomendar online`;
  const description = store.city
    ? `Encomenda online na ${store.name} (${store.city}). Entrega ou take-away, direto ao restaurante.`
    : `Encomenda online na ${store.name}. Entrega ou take-away, direto ao restaurante.`;
  // preview: capa da loja; se não houver, o logótipo
  const image = store.coverUrl ?? store.logoUrl ?? undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // slug inexistente → 404 com CTA; erro de rede deixa o cliente tentar/mostrar aviso
  if ((await fetchStore(slug)) === 'missing') notFound();
  return <StoreClient slug={slug} />;
}
