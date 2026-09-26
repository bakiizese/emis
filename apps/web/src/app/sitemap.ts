import type { MetadataRoute } from 'next';

import { getCatalog, getProfile } from '../lib/api';
import { siteUrl } from '../lib/site';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const profile = await getProfile().catch(() => null);
  if (!profile?.modules.website) return [];

  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/courses`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/contact`, changeFrequency: 'yearly', priority: 0.4 },
    ...(profile.modules.pre_registration
      ? [{ url: `${base}/pre-register`, changeFrequency: 'yearly' as const, priority: 0.6 }]
      : []),
  ];
  const catalog = await getCatalog().catch(() => ({ departments: [] }));
  const courses = catalog.departments.flatMap((d) => d.programs.flatMap((p) => p.courses));
  return [
    ...pages,
    ...courses.map((c) => ({
      url: `${base}/courses/${c.id}`,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
