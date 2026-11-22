import type { MetadataRoute } from 'next';
import { getIndex } from '@/lib/server/data';
import { SITE_URL } from '@/lib/site';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await getIndex();
  const now = new Date(data.asOf);
  const page = (path: string, priority: number, changeFrequency: 'hourly' | 'daily' | 'weekly' = 'daily') => ({ url: `${SITE_URL}${path}`, lastModified: now, changeFrequency, priority });
  return [
    page('/', 1, 'hourly'),
    page('/attendance', 0.9, 'hourly'),
    page('/clubs', 0.9),
    page('/league', 0.7),
    page('/season', 0.8),
    page('/stats', 0.6),
    page('/about', 0.5, 'weekly'),
    ...data.tokens.map((t) => page(`/ground/${encodeURIComponent(t.symbol)}`, 0.6, 'hourly')),
  ];
}
