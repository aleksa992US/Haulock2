// Block-list of domains that aren't a carrier's own website — gov sites, directories, social, aggregators.
const BLOCKED_DOMAINS = new Set<string>([
  // Government
  'fmcsa.dot.gov', 'safer.fmcsa.dot.gov', 'ai.fmcsa.dot.gov', 'mobile.fmcsa.dot.gov', 'sec.gov',
  'usdot.gov', 'transportation.gov', 'irs.gov',
  // Carrier directories / aggregators
  'carrier411.com', 'dat.com', 'truckstop.com', 'yellowpages.com', 'bbb.org',
  'manta.com', 'bizapedia.com', 'opencorporates.com', 'dnb.com',
  'glassdoor.com', 'indeed.com', 'crunchbase.com',
  'carriersource.io', 'truckersedge.net', 'mytruckhauler.com', 'trucker.com',
  'inboundlogistics.com', 'logisticsmgmt.com', 'fleetowner.com',
  // Social / video
  'facebook.com', 'fb.com', 'm.facebook.com',
  'linkedin.com', 'twitter.com', 'x.com', 'instagram.com',
  'youtube.com', 'youtu.be', 'tiktok.com', 'pinterest.com',
  // Maps / search
  'google.com', 'maps.google.com', 'goo.gl',
  // Misc
  'wikipedia.org', 'reddit.com',
]);

function hostnameOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isBlocked(host: string): boolean {
  if (BLOCKED_DOMAINS.has(host)) return true;
  for (const b of BLOCKED_DOMAINS) {
    if (host.endsWith('.' + b)) return true;
  }
  return false;
}

const ENTITY_SUFFIXES = new Set(['inc', 'llc', 'ltd', 'lp', 'llp', 'co', 'corp', 'corporation', 'company', 'pllc']);

export function nameMatchesDomain(name: string, domain: string): boolean {
  if (!name || !domain) return false;
  const significant = name.toLowerCase().split(/\W+/).filter((w) => w && !ENTITY_SUFFIXES.has(w));
  if (significant.length === 0) return false;
  const sld = domain.toLowerCase().replace(/^www\./, '').split('.')[0];
  return significant.every((w) => sld.includes(w));
}

export function isCustomSearchConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CUSTOM_SEARCH_API_KEY && process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID);
}

export function isBraveConfigured(): boolean {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY);
}

export type WebsiteFinderResult = {
  configured: boolean;
  found: boolean;
  domain?: string;
  url?: string;
  title?: string;
  snippet?: string;
  source?: 'cse' | 'brave';
  error?: string;
};

type RawHit = { link: string; title?: string; snippet?: string };

function pickHit(name: string, items: RawHit[]): { domain: string; hit: RawHit } | null {
  let nameMatchHit: { domain: string; hit: RawHit } | null = null;
  let firstHit: { domain: string; hit: RawHit } | null = null;
  for (const it of items) {
    const host = hostnameOf(it.link);
    if (!host || isBlocked(host)) continue;
    if (!firstHit) firstHit = { domain: host, hit: it };
    if (nameMatchesDomain(name, host)) { nameMatchHit = { domain: host, hit: it }; break; }
  }
  return nameMatchHit || firstHit;
}

async function searchBrave(q: string): Promise<RawHit[] | { error: string }> {
  const key = process.env.BRAVE_SEARCH_API_KEY!;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`;
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': key, 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return { error: `Brave ${res.status}` };
  const data = await res.json();
  const results = data?.web?.results || [];
  return results.map((r: any) => ({ link: r.url, title: r.title, snippet: r.description }));
}

async function searchCse(q: string): Promise<RawHit[] | { error: string }> {
  const key = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY!;
  const cx = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID!;
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&num=10`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return { error: `Custom Search ${res.status}` };
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items.map((it: any) => ({ link: it.link, title: it.title, snippet: it.snippet })) : [];
}

export async function findCarrierWebsite(opts: { name: string; mc?: string; dot?: string }): Promise<WebsiteFinderResult> {
  const useBrave = isBraveConfigured();
  const useCse = !useBrave && isCustomSearchConfigured();
  if (!useBrave && !useCse) return { configured: false, found: false };
  const source: 'brave' | 'cse' = useBrave ? 'brave' : 'cse';

  const name = (opts.name || '').trim();
  if (!name) return { configured: true, found: false };

  const queries: string[] = [];
  if (opts.mc) queries.push(`"${name}" MC-${opts.mc}`);
  if (opts.dot) queries.push(`"${name}" DOT-${opts.dot}`);
  queries.push(`"${name}" trucking carrier`);

  let firstError: string | undefined;
  for (const q of queries) {
    try {
      const result = source === 'brave' ? await searchBrave(q) : await searchCse(q);
      if ('error' in result) {
        if (!firstError) firstError = result.error;
        continue;
      }
      const picked = pickHit(name, result);
      if (picked) {
        return {
          configured: true,
          found: true,
          domain: picked.domain,
          url: picked.hit.link,
          title: picked.hit.title,
          snippet: picked.hit.snippet,
          source,
        };
      }
    } catch {
      // try next query
    }
  }
  return { configured: true, found: false, error: firstError };
}
