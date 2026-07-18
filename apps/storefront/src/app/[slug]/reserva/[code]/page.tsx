import type { Metadata } from 'next';
import { ReservaClient } from './ReservaClient';

// Página privada (traz um token no fragmento do URL): nunca indexar. O `robots.ts` do
// storefront faz allow: '/' sem Disallow nenhum, logo o noindex TEM de vir daqui.
// Título GENÉRICO de propósito — o nome do cliente nunca entra no separador do browser
// (fica no histórico, na partilha de ecrã e nas sugestões de pesquisa).
export const metadata: Metadata = {
  title: 'A minha reserva',
  robots: { index: false, follow: false },
};

/**
 * Casca de servidor: só resolve os params e entrega ao cliente.
 *
 * O token vem no fragmento `#t=`, que NUNCA chega ao servidor — logo este componente não
 * tem como validar nada, e o «sem token válido → 404 neutro» NÃO pode ser um 404 HTTP:
 * o documento sai sempre 200 e o «Reserva não encontrada» é estado renderizado no cliente.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; code: string }>;
}) {
  const { slug, code } = await params;
  return <ReservaClient slug={slug} code={code} />;
}
