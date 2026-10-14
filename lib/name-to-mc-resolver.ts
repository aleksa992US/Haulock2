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
// titles + snippets for MC-XXXXX / DOT-XXXXX patterns, and rank every cited
// identifier (hits whose text names the company count double).
//
// A citation count is NOT proof of identity: directory pages list unrelated
// carriers side by side, and the most-cited number can belong to someone
// else. Callers must look each id up and accept it only when the registered
// legal name / DBA resembles the search (lib/name-match), or when the user
// confirms it.

import { nameTokens } from './name-match';

const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';

export type ResolvedId = { kind: 'mc' | 'dot'; value: string; citations: number };

export type NameResolveResult = {
  configured: boolean;
  found: boolean;
  // Most-cited MC and DOT. Unverified — see `ids`.
  mc?: string;
  dot?: string;
  // Every cited id, most-cited first (MCs before DOTs on ties). Unverified.
  ids: ResolvedId[];
  evidence: { url: string; title: string; snippet: string }[];
  error?: string;
};

export function isNameResolverConfigured(): boolean {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY);
}

export async function resolveNameToMc(name: string): Promise<NameResolveResult> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { configured: false, found: false, ids: [], evidence: [] };
  const cleanName = name.replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleanName.length < 4) return { configured: true, found: false, ids: [], evidence: [] };
  const nameWords = nameTokens(name);

  // Probe with two queries — one biased toward FMCSA registry mentions, one
  // toward news/forum coverage. Run in parallel with a tight 4s budget each.
  const queries = [
    `"${cleanName}" MC number USDOT`,
    `"${cleanName}" FMCSA carrier broker`,
  ];

  const settled = await Promise.allSettled(queries.map((q) => braveSearch(q, key)));

  // Aggregate identifiers across all hits. A hit whose title/snippet names
  // the company counts 2, one that doesn't counts 1 (its numbers are more
  // likely to belong to some other carrier on the same page).
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
      const blobWords = new Set(nameTokens(blob));
      const weight = nameWords.length > 0 && nameWords.every((w) => blobWords.has(w)) ? 2 : 1;
      for (const mc of mcs) mcCounts.set(mc, (mcCounts.get(mc) || 0) + weight);
      for (const dot of dots) dotCounts.set(dot, (dotCounts.get(dot) || 0) + weight);
    }
  }

  const ids: ResolvedId[] = [
    ...Array.from(mcCounts, ([value, citations]) => ({ kind: 'mc' as const, value, citations })),
    ...Array.from(dotCounts, ([value, citations]) => ({ kind: 'dot' as const, value, citations })),
  ].sort((a, b) => b.citations - a.citations || (a.kind === b.kind ? 0 : a.kind === 'mc' ? -1 : 1));

  if (ids.length === 0) {
    return { configured: true, found: false, ids, evidence };
  }

  return {
    configured: true,
    found: true,
    mc: topByCount(mcCounts),
    dot: topByCount(dotCounts),
    ids,
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
