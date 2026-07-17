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
  // página de download do APK da app de cozinha (/cozinha na storefront)
  'cozinha',
  // o Caddy serve o .apk em /downloads/* ANTES do proxy da storefront
  // (deploy/Caddyfile.cozinha.snippet), logo tapa as subpáginas desta loja
  'downloads',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug.toLowerCase());
}
