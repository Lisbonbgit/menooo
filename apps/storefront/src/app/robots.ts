import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_STORE_URL ?? 'https://menooo.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // NÃO fazer Disallow do /checkout: bloquear o crawl impediria o motor de
      // ler o `noindex` (robots.ts de [slug]/checkout) e des-indexar de facto.
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
