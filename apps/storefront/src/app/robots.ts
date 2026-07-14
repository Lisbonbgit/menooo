import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_STORE_URL ?? 'https://menooo.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // páginas transacionais/privadas não interessam aos motores
      disallow: ['/*/checkout'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
