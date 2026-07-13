/**
 * Slugs que colidem com rotas estáticas do storefront (ou órgãos da
 * plataforma): uma loja com um destes endereços ficaria inacessível,
 * tapada pela página estática com o mesmo caminho.
 */
const RESERVED = new Set([
  'termos',
  'privacidade',
  'admin',
  'api',
  'login',
  'register',
  'checkout',
  'painel',
  'menooo',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug.toLowerCase());
}
