// Name-to-MC resolver via Brave Search.
//
// Used as a last-resort fallback when both FMCSA's /name/ endpoint and the
// Socrata `legal_name`/`dba_name` LIKE search return nothing for a name
// query. This happens whenever the user searches by a TRADE NAME the
// company is publicly known by — but the legal entity registered with
// FMCSA uses a different name (e.g. "Super Ego Logistics" → registered as
// "GRAY FALCON UNITED LLC", MC-1040945).
//
// Strategy: query Brave for the name + "MC number FMCSA", scan the result
// titles + snippets for MC-XXXXX / DOT-XXXXX patterns. Return the most
// frequently cited identifier across the top hits. Once we have an id we
// can do a clean MC/DOT lookup via the regular pipeline.

const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';

export type NameResolveResult = {
  configured: boolean;
  found: boolean;
  mc?: string;
  dot?: string;
  evidence: { url: string; title: string; snippet: string }[];
  error?: string;
};

export function isNameResolverConfigured(): boolean {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY);
}

export async function resolveNameToMc(name: string): Promise<NameResolveResult> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { configured: false, found: false, evidence: [] };
  const cleanName = name.replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleanName.length < 4) return { configured: true, found: false, evidence: [] };

  // Probe with two queries — one biased toward FMCSA registry mentions, one
  // toward news/forum coverage. Run in parallel with a tight 4s budget each.
  const queries = [
    `"${cleanName}" MC number USDOT`,
    `"${cleanName}" FMCSA carrier broker`,
  ];

  const settled = await Promise.allSettled(queries.map((q) => braveSearch(q, key)));

  // Aggregate identifiers across all hits — the most-cited MC/DOT pair wins.
  const mcCounts = new Map<string, number>();
  const dotCounts = new Map<string, number>();
  const evidence: NameResolveResult['evidence'] = [];

  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const hit of s.value) {
      const blob = `${hit.title}\n${hit.snippet}`;
      const mcs = extractMcs(blob);
      const dots = extractDots(blob);
      if (mcs.length === 0 && dots.length === 0) continue;
      // Keep only the first 8 evidence items so the returned object stays small.
      if (evidence.length < 8) evidence.push(hit);
      for (const mc of mcs) mcCounts.set(mc, (mcCounts.get(mc) || 0) + 1);
      for (const dot of dots) dotCounts.set(dot, (dotCounts.get(dot) || 0) + 1);
    }
  }

  if (mcCounts.size === 0 && dotCounts.size === 0) {
    return { configured: true, found: false, evidence };
  }

  // Pick the most-cited MC; if no MC, fall back to most-cited DOT.
  const topMc = topByCount(mcCounts);
  const topDot = topByCount(dotCounts);

  return {
    configured: true,
    found: Boolean(topMc || topDot),
    mc: topMc,
    dot: topDot,
    evidence,
  };
}

// ----- internal -----------------------------------------------------------

type RawHit = { url: string; title: string; snippet: string };

async function braveSearch(q: string, key: string): Promise<RawHit[]> {
  const url = `${BRAVE_URL}?q=${encodeURIComponent(q)}&count=10`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = data?.web?.results || [];
    return results
      .map((r: any): RawHit | null => {
        if (!r?.url) return null;
        return {
          url: String(r.url),
          title: String(r.title || '').trim(),
          snippet: String(r.description || '').replace(/<[^>]+>/g, '').trim(),
        };
      })
      .filter((x: any): x is RawHit => Boolean(x));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// Pull MC numbers out of free text. Common formats: "MC-123456", "MC 123456",
// "MC#123456", "MC: 123456". Also accept "MC1234567".
function extractMcs(text: string): string[] {
  const ids = new Set<string>();
  const re = /\bMC\s*[#:\-]?\s*(\d{4,7})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

// Pull DOT numbers out of free text. Common formats: "USDOT 1234567",
// "DOT-1234567", "DOT# 1234567", "USDOT # 1234567".
function extractDots(text: string): string[] {
  const ids = new Set<string>();
  const re = /\b(?:US)?DOT\s*[#:\-]?\s*(\d{5,8})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

function topByCount(counts: Map<string, number>): string | undefined {
  if (counts.size === 0) return undefined;
  let best: string | undefined;
  let bestCount = 0;
  for (const [k, v] of counts) {
    if (v > bestCount) { best = k; bestCount = v; }
  }
  return best;
}
