import type { MetadataRoute } from 'next';
import { BLOG_POSTS } from '@/lib/blog-posts';
import { statePath, US_STATES } from '@/lib/directory-links';
import { REPORTS_ON } from '@/lib/features';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`,         lastModified: now, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${SITE_URL}/signup`,   lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/login`,    lastModified: now, changeFrequency: 'yearly',  priority: 0.4 },
    { url: `${SITE_URL}/pricing`,  lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/blog`,     lastModified: now, changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${SITE_URL}/about`,    lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/terms`,    lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/privacy`,  lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/docs/api`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
  ];

  const blogEntries: MetadataRoute.Sitemap = BLOG_POSTS.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: new Date(p.publishedAt),
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  // The public directory: its home, the two state indexes and every state
  // list. Company pages have their own sitemap at /company/sitemap.xml.
  const directoryEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/directory`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/directory/brokers`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/directory/carriers`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    ...(['brokers', 'carriers'] as const).flatMap((kind) => US_STATES.map((s) => ({
      url: `${SITE_URL}${statePath(kind, s.code)}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }))),
  ];

  return [...staticEntries, ...blogEntries, ...(REPORTS_ON ? directoryEntries : [])];
}
