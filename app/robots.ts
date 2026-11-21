import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/sales',
          '/dashboard',
          '/settings',
          '/watchlist',
          '/alerts',
          '/history',
          '/reports',
          '/report',
          '/verify',
          '/planner',
          '/auth/',
        ],
      },
    ],
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/company/sitemap.xml`],
    host: SITE_URL,
  };
}
