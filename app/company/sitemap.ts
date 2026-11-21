import type { MetadataRoute } from 'next';
import { activeBrokerMcs } from '@/lib/directory';
import { REPORTS_ON } from '@/lib/features';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://haulock.com';

// Served at /company/sitemap.xml and rebuilt once a day.
//
// Brokers first: about 27,000 pages, the ones people search for by name
// ("is this broker legit"). Carrier pages (about 380,000) are reachable from
// the state lists and are left out of the sitemap for now, so a new site
// doesn't hand search engines 400,000 near-identical pages on day one. Add
// them here once the broker pages are being indexed.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!REPORTS_ON) return [];
  let mcs: string[] = [];
  try { mcs = await activeBrokerMcs(); } catch { return []; }
  return mcs.slice(0, 50000).map((mc) => ({
    url: `${SITE_URL}/company/mc-${mc}`,
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }));
}
