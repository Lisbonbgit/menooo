import { MesaMenuClient } from './MesaMenuClient';

// O `qrToken` identifica uma mesa física — nunca deve aparecer em resultados de pesquisa
// (o robots.ts do storefront faz allow: '/' sem Disallow nenhum, logo o noindex TEM de vir daqui).
export const metadata = { robots: { index: false } };

/**
 * Casca de servidor: só resolve os params e entrega ao cliente. A validação do token (mesa
 * existe? pertence a esta loja?) é feita no cliente via `useTable` — «mesa não encontrada»
 * é estado renderizado, não um 404 HTTP.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; qrToken: string }>;
}) {
  const { slug, qrToken } = await params;
  return <MesaMenuClient slug={slug} qrToken={qrToken} />;
}
