import { GENERIC_INDUSTRY_WORDS, tokenizeName, distinctiveNameTokens, companyNamesStrictMatch } from './risk';
import { addressesMatch } from './places';

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
  // Carrier-data / vetting / monitoring competitors. These republish FMCSA
  // data but are NOT the carrier's own website. They keep showing up first
  // in Brave/Google because they're SEO-heavy.
  'brokersnapshot.com', 'mycarrierpackets.com', 'mycarrierportal.com',
  'highway.com', 'rmismetacarrier.com', 'rmiscarrierservices.com',
  'macropoint.com', 'descartes.com', 'transportation.descartes.com',
  'safer-watch.com', 'smartwaymovers.com', 'isaaccarrier.com',
  'truckerpath.com', 'overdriveonline.com', 'ccjdigital.com',
  // Other haulock-adjacent / lookup tools
  'haulock.com', 'haulock.app',
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

// Can `rest` be split entirely into generic industry words?
// ("freightlines" → yes, "plumbing" → no).
function isGenericSuffix(rest: string): boolean {
  if (!rest) return true;
  const ok: boolean[] = new Array(rest.length + 1).fill(false);
  ok[0] = true;
  for (let i = 1; i <= rest.length; i++) {
    for (let j = Math.max(0, i - 16); j < i; j++) {
      if (ok[j] && GENERIC_INDUSTRY_WORDS.has(rest.slice(j, i))) { ok[i] = true; break; }
    }
  }
  return ok[rest.length];
}

// Does the domain's name part spell the company name? Either the whole
// name in order ("acmefreight" for Acme Freight LLC) or its distinctive
// part followed only by industry words ("acme", "acmetrucking"). Generic
// words alone never match, and "acmeplumbing" is not Acme Freight.
export function nameMatchesDomain(name: string, domain: string): boolean {
  if (!name || !domain) return false;
  const sld = domain.toLowerCase().replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9]/g, '');
  if (!sld) return false;
  const tokens = tokenizeName(name);
  if (tokens.length === 0) return false;
  const full = tokens.join('');
  if (full.length >= 5 && sld.includes(full)) return true;
  const core = distinctiveNameTokens(name).join('');
  if (core.length >= 3 && sld.startsWith(core) && isGenericSuffix(sld.slice(core.length))) return true;
  return false;
}

// Does a listing / page title name the company? Distinctive words must be
// the same ("Acme Freight Services" = ACME FREIGHT LLC; "Acme Plumbing" ≠).
export function siteNameMatches(name: string, siteName: string | undefined): boolean {
  if (!name || !siteName) return false;
  return companyNamesStrictMatch(name, siteName);
}

function normalizePhone(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const digits = String(input).replace(/[^0-9]/g, '');
  if (digits.length < 10) return undefined;
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(-10);
}

export type WebsiteVerifiedBy = 'address' | 'phone' | 'name-only' | 'none';

export type WebsiteOwnership = {
  // The domain or the site / listing name matches the company name.
  nameMatch: boolean;
  // The site's Google Places listing is at the FMCSA address / has the FMCSA phone.
  addressMatch: boolean;
  phoneMatch: boolean;
  // Accepted as the company's own website: name match + address or phone match.
  verified: boolean;
  verifiedBy: WebsiteVerifiedBy;
};

// Decide whether a found website really belongs to the company. FMCSA does
// not list websites, so a site that merely ranks for the name proves
// nothing — impersonators build exactly those. We accept it only when the
// name matches AND its Google listing ties it to the FMCSA address or phone.
// Web-search hits carry no listing data, so they are never verified.
export function assessWebsiteOwnership(
  site: { domain?: string; siteName?: string; title?: string; placesAddress?: string; placesPhone?: string },
  company: { name: string; address?: string; phone?: string },
): WebsiteOwnership {
  const siteName = site.siteName ?? site.title;
  const nameMatch = Boolean(
    (site.domain && nameMatchesDomain(company.name, site.domain)) || siteNameMatches(company.name, siteName),
  );
  const addressMatch = Boolean(site.placesAddress && company.address && addressesMatch(company.address, site.placesAddress));
  const fmcsaPhone = normalizePhone(company.phone);
  const phoneMatch = Boolean(fmcsaPhone && normalizePhone(site.placesPhone) === fmcsaPhone);
  const verified = nameMatch && (addressMatch || phoneMatch);
  const verifiedBy: WebsiteVerifiedBy = verified
    ? (addressMatch ? 'address' : 'phone')
    : nameMatch ? 'name-only' : 'none';
  return { nameMatch, addressMatch, phoneMatch, verified, verifiedBy };
}

function ownershipRank(o: WebsiteOwnership): number {
  if (o.verified) return 3;
  if (o.nameMatch) return 2;
  if (o.addressMatch || o.phoneMatch) return 1;
  return 0;
}

export function isCustomSearchConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CUSTOM_SEARCH_API_KEY && process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID);
}

export function isBraveConfigured(): boolean {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY);
}

export function isPlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export type WebsiteFinderResult = {
  configured: boolean;
  found: boolean;
  domain?: string;
  url?: string;
  title?: string;
  snippet?: string;
  // 'places' = the website on a Google Places listing; 'cse' / 'brave' = a
  // web-search hit. Neither source proves the site is the company's — see
  // `verified`.
  source?: 'places' | 'cse' | 'brave';
  // The Places listing the website came from (name, address, phone), used
  // as ownership evidence. Absent for web-search hits.
  siteName?: string;
  placesAddress?: string;
  placesPhone?: string;
  // Ownership evidence, computed against the FMCSA name/address/phone passed
  // in. The verify route re-runs assessWebsiteOwnership after it backfills
  // the phone, so treat these as provisional.
  nameMatch?: boolean;
  addressMatch?: boolean;
  phoneMatch?: boolean;
  verified?: boolean;
  verifiedBy?: WebsiteVerifiedBy;
  error?: string;
};

type RawHit = { link: string; title?: string; snippet?: string };

// Web-search hits are only kept when the domain or the page title names the
// company. The old "first unblocked hit" fallback returned whatever ranked
// first — often an unrelated company or an impersonator.
function pickHit(name: string, items: RawHit[]): { domain: string; hit: RawHit } | null {
  for (const it of items) {
    const host = hostnameOf(it.link);
    if (!host || isBlocked(host)) continue;
    if (nameMatchesDomain(name, host)) return { domain: host, hit: it };
  }
  for (const it of items) {
    const host = hostnameOf(it.link);
    if (!host || isBlocked(host)) continue;
    if (siteNameMatches(name, it.title)) return { domain: host, hit: it };
  }
  return null;
}

async function searchBrave(q: string): Promise<RawHit[] | { error: string }> {
  const key = process.env.BRAVE_SEARCH_API_KEY!;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
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
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return { error: `Custom Search ${res.status}` };
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items.map((it: any) => ({ link: it.link, title: it.title, snippet: it.snippet })) : [];
}

// Google Places listings carry a website plus the listing's own address and
// phone, which lets us check the site against the FMCSA record. A listing
// can still be someone else's (a same-name company elsewhere, a neighbour,
// an impersonator), so every candidate is scored with
// assessWebsiteOwnership and only a verified one is accepted outright.
async function findPlacesWebsite(opts: { name: string; address?: string; phone?: string }): Promise<WebsiteFinderResult | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const name = (opts.name || '').trim();
  if (!name) return null;

  // Most-specific query first (name + address), then broader ones. We keep
  // looking until a candidate is verified, remembering the best unverified
  // one in case none is.
  const queries: string[] = [];
  if (opts.address) queries.push(`${name} ${opts.address}`);
  queries.push(`${name} trucking`);
  queries.push(name);

  let best: { result: WebsiteFinderResult; rank: number } | null = null;
  for (const textQuery of queries) {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        signal: AbortSignal.timeout(8_000),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'places.displayName,places.websiteUri,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber',
        },
        body: JSON.stringify({ textQuery, pageSize: 5 }),
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const data = await res.json();
      const places = (data?.places || []) as any[];
      for (const p of places) {
        const websiteUri: string | undefined = p?.websiteUri;
        if (!websiteUri) continue;
        const host = hostnameOf(websiteUri);
        if (!host || isBlocked(host)) continue;
        const siteName: string | undefined = p?.displayName?.text;
        const placesAddress: string | undefined = p?.formattedAddress;
        const placesPhone: string | undefined = p?.nationalPhoneNumber || p?.internationalPhoneNumber;
        const own = assessWebsiteOwnership(
          { domain: host, siteName, placesAddress, placesPhone },
          { name, address: opts.address, phone: opts.phone },
        );
        const rank = ownershipRank(own);
        // A listing with no tie to the company at all (different name,
        // address and phone) is just another business — not a candidate.
        if (rank === 0) continue;
        const result: WebsiteFinderResult = {
          configured: true,
          found: true,
          domain: host,
          url: websiteUri,
          title: siteName,
          snippet: placesAddress,
          source: 'places',
          siteName,
          placesAddress,
          placesPhone,
          ...own,
        };
        if (own.verified) return result;
        if (!best || rank > best.rank) best = { result, rank };
      }
    } catch {
      // try next query
    }
  }
  return best ? best.result : null;
}

export async function findCarrierWebsite(opts: { name: string; mc?: string; dot?: string; address?: string; phone?: string }): Promise<WebsiteFinderResult> {
  const usePlaces = isPlacesConfigured();
  const useBrave = isBraveConfigured();
  const useCse = !useBrave && isCustomSearchConfigured();
  if (!usePlaces && !useBrave && !useCse) return { configured: false, found: false };

  const name = (opts.name || '').trim();
  if (!name) return { configured: true, found: false };

  // Step 1: Google Places — the only source that can verify a site, via the
  // listing's address / phone.
  if (usePlaces) {
    const places = await findPlacesWebsite({ name, address: opts.address, phone: opts.phone });
    if (places) return places;
  }

  // Step 2: fall back to Brave/CSE web search if Places had nothing.
  if (!useBrave && !useCse) return { configured: true, found: false };
  const source: 'brave' | 'cse' = useBrave ? 'brave' : 'cse';

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
        // No listing data → name-only at best, never verified.
        const own = assessWebsiteOwnership(
          { domain: picked.domain, title: picked.hit.title },
          { name, address: opts.address, phone: opts.phone },
        );
        return {
          configured: true,
          found: true,
          domain: picked.domain,
          url: picked.hit.link,
          title: picked.hit.title,
          snippet: picked.hit.snippet,
          source,
          ...own,
        };
      }
    } catch {
      // try next query
    }
  }
  return { configured: true, found: false, error: firstError };
}
