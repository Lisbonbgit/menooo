import type { Metadata } from 'next';
import { CheckoutClient } from './CheckoutClient';

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/api';

/** Lê o nome da loja no servidor, para o title do separador. */
async function storeName(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`${API}/public/stores/${slug}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string };
    return data.name ?? null;
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
  const name = await storeName(slug);
  // checkout é transacional: title com a loja, sem indexar
  return {
    title: name ? `Finalizar encomenda — ${name}` : 'Finalizar encomenda — Menooo',
    robots: { index: false, follow: false },
  };
}

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CheckoutClient slug={slug} />;
}
