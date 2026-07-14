import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_STORE_URL ?? 'https://menooo.com';
const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/api';

interface PublicStore {
  slug: string;
  updatedAt: string;
}

async function fetchStores(): Promise<PublicStore[]> {
  try {
    const res = await fetch(`${API}/public/stores`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    return (await res.json()) as PublicStore[];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stores = await fetchStores();

  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/termos`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/privacidade`, changeFrequency: 'yearly', priority: 0.2 },
  ];

  const storePages: MetadataRoute.Sitemap = stores.map((s) => ({
    url: `${SITE_URL}/${s.slug}`,
    lastModified: new Date(s.updatedAt),
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  return [...staticPages, ...storePages];
}
