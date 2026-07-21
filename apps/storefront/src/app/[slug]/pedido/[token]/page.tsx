import type { Metadata } from 'next';
import { TrackClient } from './TrackClient';

// Página privada (o token no URL identifica o pedido de um cliente): nunca indexar,
// tal como as outras páginas transacionais/privadas do storefront (checkout, reserva).
export const metadata: Metadata = {
  title: 'O meu pedido',
  robots: { index: false, follow: false },
};

/**
 * Casca de servidor: só resolve os params (Next 15 entrega-os como Promise, tal como
 * as restantes páginas de `[slug]`) e entrega ao cliente, que faz a sondagem.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  return <TrackClient slug={slug} token={token} />;
}
