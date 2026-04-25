// Web-reputation check for carrier/broker fraud signals.
// Searches Brave Search for the company name + fraud-related keywords. Hits
// from forums (TruckersReport, Reddit /r/Truckers, FreightWaves), industry
// news (Land Line, FreightWaves, Overdrive), or government sites (FMCSA,
// FTC, BBB) on a "fraud / scam / non-payment" query are a strong signal.
//
// Defensive design:
//  - 6s budget: brokers don't have all day, and Brave is fast when it works.
//  - Strict allow-list of known-relevant domains so we don't drown in
//    SEO spam, brokersnapshot.com aggregator pages, or LinkedIn noise.
//  - Returns a confidence score so the verify route can decide if it's
//    worth raising a flag.

export type WebReputationHit = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  query: string;          // which fraud query produced this hit
};

export type WebReputationResult = {
  configured: boolean;
  ok: boolean;
  hits: WebReputationHit[];           // trusted-source hits — drive the fraud-mention flag
  extractionHits: WebReputationHit[]; // wider hit set used ONLY by the linked-entity extractor
  queriesRun: number;
  error?: string;
};

// Domains where a hit on "{name} fraud / scam" is meaningful. Random blogs
// and SEO spam get filtered out. Government, journalism, and specific
// trucking forums are the trustworthy signals.
const TRUSTED_REPUTATION_DOMAINS: Array<RegExp> = [
  // Government / regulatory
  /(?:^|\.)fmcsa\.dot\.gov$/i,
  /(?:^|\.)nccdb\.fmcsa\.dot\.gov$/i,
  /(?:^|\.)safer\.fmcsa\.dot\.gov$/i,
  /(?:^|\.)ftc\.gov$/i,
  /(?:^|\.)fbi\.gov$/i,
  /(?:^|\.)justice\.gov$/i,
  /(?:^|\.)dot\.gov$/i,
  /\.attorney(?:general)?\.gov$/i,
  /(?:^|\.)usa\.gov$/i,
  /\.[a-z]{2}\.us$/i,             // state-government domains (state.tx.us, etc.)
  /\.gov$/i,                      // any other .gov (civil suits, court records)
  // National news (60 Minutes / CBS / NYT / WSJ all covered Super Ego etc.)
  /(?:^|\.)cbsnews\.com$/i,
  /(?:^|\.)60minutes\.com$/i,
  /(?:^|\.)nytimes\.com$/i,
  /(?:^|\.)wsj\.com$/i,
  /(?:^|\.)washingtonpost\.com$/i,
  /(?:^|\.)reuters\.com$/i,
  /(?:^|\.)apnews\.com$/i,
  /(?:^|\.)bloomberg\.com$/i,
  /(?:^|\.)nbcnews\.com$/i,
  /(?:^|\.)abcnews\.go\.com$/i,
  // Trucking / freight journalism
  /(?:^|\.)landlinemedia\.com$/i,
  /(?:^|\.)freightwaves\.com$/i,
  /(?:^|\.)overdriveonline\.com$/i,
  /(?:^|\.)truckinginfo\.com$/i,
  /(?:^|\.)ccjdigital\.com$/i,
  /(?:^|\.)cdllife\.com$/i,
  /(?:^|\.)transporttopics\.com$/i,
  /(?:^|\.)ttnews\.com$/i,
  /(?:^|\.)joc\.com$/i,
  /(?:^|\.)journalofcommerce\.com$/i,
  /(?:^|\.)fleetowner\.com$/i,
  /(?:^|\.)truckersnews\.com$/i,
  // Industry-data / fraud-alert sites
  /(?:^|\.)dat\.com$/i,           // DAT publishes fraud alerts
  /(?:^|\.)truckstop\.com$/i,     // Truckstop fraud bulletins
  // Industry forums where carriers report scams in detail
  /(?:^|\.)truckersreport\.com$/i,
  /(?:^|\.)reddit\.com$/i,        // /r/Truckers etc.
  /(?:^|\.)bbb\.org$/i,           // Better Business Bureau complaints
  // Cargo theft tracking
  /(?:^|\.)cargonet\.com$/i,
  /(?:^|\.)tapaonline\.org$/i,
  /(?:^|\.)verisk\.com$/i,
  // Court / legal databases (lawsuits)
  /(?:^|\.)courtlistener\.com$/i,
  /(?:^|\.)pacer\.gov$/i,
  /(?:^|\.)justia\.com$/i,
  /(?:^|\.)law\.com$/i,
  /(?:^|\.)lawyersjustice\.com$/i,
];

// Negative-sentiment keywords paired with the company name. We probe a
// small set in parallel so users wait once for the worst-case latency.
const FRAUD_KEYWORDS = [
  'fraud',
  'scam',
  'double brokering',
  'non-payment',
  'lawsuit',
];

export function isWebReputationConfigured(): boolean {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY);
}

export type WebReputationOpts = {
  // Additional names to search alongside the FMCSA legal name. Critical for
  // catching alias coverage — e.g., the user typed "Super Ego Logistics"
  // (which we resolved to Gray Falcon United LLC); coverage mentions both.
  aliases?: string[];
  // The MC number — articles about fraud networks often cite the MC
  // directly, even when they don't use the company's legal name.
  mc?: string;
  dot?: string;
};

export async function checkWebReputation(name: string, opts: WebReputationOpts = {}): Promise<WebReputationResult> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { configured: false, ok: false, hits: [], extractionHits: [], queriesRun: 0 };
  if (!name || name.trim().length < 4) {
    return { configured: true, ok: true, hits: [], extractionHits: [], queriesRun: 0 };
  }

  const cleanName = name.replace(/[^A-Za-z0-9 ]/g, '').trim();
  if (!cleanName) return { configured: true, ok: true, hits: [], extractionHits: [], queriesRun: 0 };

  // Build search seeds: the FMCSA legal name (always), plus any aliases the
  // caller passed (the user's original query string, sister-entity names),
  // plus identifier-based seeds (MC / DOT). For each name-shaped seed we
  // run the full FRAUD_KEYWORDS list. For id-shaped seeds we run a single
  // bare search — the MC / DOT itself is usually enough to surface the
  // article since fraud coverage cites them directly.
  type Seed = {
    value: string;
    // For name-shaped seeds we use TOKENS (each significant word) and require
    // every token to appear in the hit. That's far more permissive than an
    // exact-phrase substring match — an article can call them "Super Ego"
    // OR "Super-Ego Logistics" OR "Super Ego Holding" and all match.
    matchTokens: string[];
    expand: boolean;
  };
  const seeds: Seed[] = [];
  const seenSeeds = new Set<string>();
  const pushSeed = (s: Seed) => {
    const k = s.value.toLowerCase();
    if (seenSeeds.has(k) || !k) return;
    seenSeeds.add(k);
    seeds.push(s);
  };
  pushSeed({ value: cleanName, matchTokens: tokenizeNameForMatch(cleanName), expand: true });
  for (const alias of opts.aliases || []) {
    const cleanAlias = String(alias).replace(/[^A-Za-z0-9 ]/g, '').trim();
    if (cleanAlias.length >= 4) pushSeed({ value: cleanAlias, matchTokens: tokenizeNameForMatch(cleanAlias), expand: true });
  }
  if (opts.mc) pushSeed({ value: `MC-${opts.mc}`, matchTokens: [opts.mc], expand: false });
  if (opts.dot) pushSeed({ value: `USDOT ${opts.dot}`, matchTokens: [opts.dot], expand: false });

  // Cap total queries to keep us under Brave's free-tier rate limit (~1
  // QPS): name seeds × 5 fraud keywords + 1 bare query per identifier seed.
  type Query = { q: string; matchTokens: string[] };
  const queries: Query[] = [];
  for (const seed of seeds) {
    if (seed.expand) {
      for (const kw of FRAUD_KEYWORDS) queries.push({ q: `"${seed.value}" ${kw}`, matchTokens: seed.matchTokens });
    } else {
      queries.push({ q: `"${seed.value}"`, matchTokens: seed.matchTokens });
    }
  }
  // Hard cap so we never explode beyond a reasonable budget.
  const MAX_QUERIES = 14;
  const trimmed = queries.slice(0, MAX_QUERIES);

  const settled = await Promise.allSettled(trimmed.map((q) => searchBrave(q.q, key)));

  const trustedHits: WebReputationHit[] = [];   // count toward fraud-mention flag
  const allHits: WebReputationHit[] = [];        // wider set used by linked-entity extractor
  let firstError: string | undefined;
  settled.forEach((res, i) => {
    if (res.status === 'rejected') {
      firstError ||= res.reason?.message || 'Brave search failed';
      return;
    }
    for (const hit of res.value) {
      // Token-AND match: every significant token in the seed must appear
      // somewhere in title+snippet. For "Super Ego Logistics" the seed
      // tokens are ['super','ego','logistics'] — an article that says
      // "Super Ego Holding" only matches if all three words appear.
      const blob = `${hit.title} ${hit.snippet}`.toLowerCase();
      const tokens = trimmed[i].matchTokens;
      if (tokens.length === 0) continue;
      const allTokensMatch = tokens.every((t) => blob.includes(t.toLowerCase()));
      if (!allTokensMatch) continue;
      const enriched = { ...hit, query: trimmed[i].q };
      allHits.push(enriched);
      if (TRUSTED_REPUTATION_DOMAINS.some((re) => re.test(hit.domain))) {
        trustedHits.push(enriched);
      }
    }
  });

  const dedupe = (arr: WebReputationHit[], cap: number) => {
    const byUrl = new Map<string, WebReputationHit>();
    for (const h of arr) if (!byUrl.has(h.url)) byUrl.set(h.url, h);
    return Array.from(byUrl.values()).slice(0, cap);
  };

  const uniqueTrusted = dedupe(trustedHits, 12);
  const uniqueAll = dedupe(allHits, 30);

  return {
    configured: true,
    ok: settled.some((r) => r.status === 'fulfilled'),
    hits: uniqueTrusted,
    extractionHits: uniqueAll,
    queriesRun: trimmed.length,
    error: firstError && uniqueAll.length === 0 ? firstError : undefined,
  };
}

// Tokenize a name into significant words for token-AND matching. Drops
// entity suffixes (LLC, Inc, etc.) and short noise words. We keep words
// of 3+ chars so common terms like "Ego" still count.
function tokenizeNameForMatch(name: string): string[] {
  const NOISE = new Set(['the', 'and', 'for', 'with', 'llc', 'inc', 'corp', 'co', 'ltd', 'lp']);
  return name.toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !NOISE.has(w));
}

// ----- internal -----------------------------------------------------------

type RawBraveHit = { title: string; url: string; domain: string; snippet: string };

async function searchBrave(q: string, key: string, timeoutMs = 4000): Promise<RawBraveHit[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': key,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new Error(`Brave ${res.status}: ${body.slice(0, 120)}`);
    }
    const data = await res.json();
    const results = data?.web?.results || [];
    return results
      .map((r: any): RawBraveHit | null => {
        if (!r?.url) return null;
        const host = String(r?.meta_url?.hostname || hostnameOf(r.url) || '').toLowerCase().replace(/^www\./, '');
        return {
          title: String(r.title || '').trim(),
          url: String(r.url),
          domain: host,
          snippet: String(r.description || '').replace(/<[^>]+>/g, '').trim(),
        };
      })
      .filter((x: any): x is RawBraveHit => Boolean(x));
  } finally {
    clearTimeout(timeout);
  }
}

function hostnameOf(u: string): string | null {
  try { return new URL(u).hostname; } catch { return null; }
}
