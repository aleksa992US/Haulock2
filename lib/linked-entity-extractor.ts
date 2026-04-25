// Extract "linked entities" from web-search hits.
//
// When Brave Search returns articles about a carrier (e.g., a Land Line
// piece on "Gray Falcon United LLC"), the title + snippet typically also
// mentions every alias and sister-entity tied to the same fraud network:
//   "Gray Falcon United, formerly Super Ego Logistics and JHI Transport,
//    is operating under new MC 1234567 as Sky Blue Leasing..."
//
// This module parses those hits for:
//   - Company-name candidates (capitalized phrases ending in LLC / INC /
//     CORP / HOLDINGS / LEASING / TRANSPORT / LOGISTICS / FREIGHT / etc.)
//   - MC numbers + DOT numbers
// and returns the most-cited ones, deduped against the queried carrier
// itself. The result feeds a "Linked entities" panel on the report.

export type LinkedEntity = {
  kind: 'company' | 'mc' | 'dot';
  value: string;          // e.g., "SUPER EGO LOGISTICS LLC", "1040945"
  citations: number;      // how many distinct hits mention it
  sources: string[];      // distinct domains where it was found
  evidence: string;       // a short representative snippet
};

const COMPANY_SUFFIXES = [
  'LLC', 'L\\.L\\.C\\.?', 'INC', 'INCORPORATED', 'CORP', 'CORPORATION',
  'CO', 'COMPANY', 'LTD', 'LIMITED', 'LP', 'LLP', 'PLLC',
  'HOLDINGS?', 'GROUP', 'ENTERPRISES?',
  'LOGISTICS', 'TRANSPORT(?:ATION)?', 'TRUCKING', 'FREIGHT(?:WAYS)?',
  'LEASING', 'BROKERAGE', 'CARRIERS?', 'EXPRESS', 'LINES?', 'DISPATCH',
];
const COMPANY_RE = new RegExp(
  // 1-4 capitalized words, followed by an optional second cap-word, then a suffix.
  `\\b((?:[A-Z][A-Za-z0-9&'-]+\\s+){0,4}[A-Z][A-Za-z0-9&'-]+\\s+(?:${COMPANY_SUFFIXES.join('|')}))\\b`,
  'g',
);

export function extractLinkedEntities(
  hits: Array<{ title: string; snippet: string; domain: string; url: string }>,
  selfName: string | undefined,
  selfMc: string | undefined,
  selfDot: string | undefined,
): LinkedEntity[] {
  if (!hits || hits.length === 0) return [];

  const selfTokens = new Set(tokenizeName(selfName || ''));
  const companies = new Map<string, { citations: number; sources: Set<string>; evidence: string }>();
  const mcs = new Map<string, { citations: number; sources: Set<string>; evidence: string }>();
  const dots = new Map<string, { citations: number; sources: Set<string>; evidence: string }>();

  for (const hit of hits) {
    const text = `${hit.title}\n${hit.snippet}`;

    // Company-name candidates.
    const seenInThisHit = new Set<string>();
    let m: RegExpExecArray | null;
    COMPANY_RE.lastIndex = 0;
    while ((m = COMPANY_RE.exec(text)) !== null) {
      const raw = m[1].replace(/\s+/g, ' ').trim();
      const normalized = raw.toUpperCase();
      // Skip the carrier we're verifying itself.
      if (selfName && shareSignificantTokens(normalized, selfName, selfTokens)) continue;
      // Skip generic boilerplate phrases that match the regex but aren't entities.
      if (looksLikeBoilerplate(normalized)) continue;
      if (seenInThisHit.has(normalized)) continue;
      seenInThisHit.add(normalized);
      const cur = companies.get(normalized) || { citations: 0, sources: new Set<string>(), evidence: hit.title };
      cur.citations += 1;
      cur.sources.add(hit.domain);
      companies.set(normalized, cur);
    }

    // If this article is clearly *about the same carrier we are verifying*
    // (its text contains a significant name token from selfName), then any
    // MC / DOT it cites is almost certainly the carrier's own identifier
    // — not a sister entity. Skip ID extraction on those hits. This is a
    // safety net for the case where the upstream lookup didn't populate
    // selfMc / selfDot (e.g. user searched by DOT and FMCSA returned the
    // carrier without its MC).
    const hitMentionsSelf = selfTokens.size > 0 && (() => {
      const blob = text.toLowerCase();
      // Treat the article as "about self" only when it mentions MULTIPLE
      // significant tokens — a single short token like "freight" appearing
      // in a generic logistics article is not enough.
      let matchCount = 0;
      for (const t of selfTokens) {
        if (t.length >= 3 && blob.includes(t)) matchCount += 1;
        if (matchCount >= 2) return true;
      }
      // Single-token names (rare) still match on one hit.
      return selfTokens.size === 1 && matchCount === 1;
    })();

    // MC numbers.
    const mcRe = /\bMC\s*[#:\-]?\s*(\d{4,7})\b/gi;
    while ((m = mcRe.exec(text)) !== null) {
      const id = m[1].replace(/^0+/, '');
      if (selfMc && id === selfMc) continue;
      if (hitMentionsSelf) continue; // article is about the carrier itself
      const cur = mcs.get(id) || { citations: 0, sources: new Set<string>(), evidence: hit.title };
      cur.citations += 1;
      cur.sources.add(hit.domain);
      mcs.set(id, cur);
    }

    // DOT numbers.
    const dotRe = /\b(?:US)?DOT\s*[#:\-]?\s*(\d{5,8})\b/gi;
    while ((m = dotRe.exec(text)) !== null) {
      const id = m[1].replace(/^0+/, '');
      if (selfDot && id === selfDot) continue;
      if (hitMentionsSelf) continue;
      const cur = dots.get(id) || { citations: 0, sources: new Set<string>(), evidence: hit.title };
      cur.citations += 1;
      cur.sources.add(hit.domain);
      dots.set(id, cur);
    }
  }

  const out: LinkedEntity[] = [];
  for (const [value, c] of companies) {
    out.push({ kind: 'company', value: titleCase(value), citations: c.citations, sources: Array.from(c.sources), evidence: c.evidence });
  }
  for (const [value, c] of mcs) {
    out.push({ kind: 'mc', value, citations: c.citations, sources: Array.from(c.sources), evidence: c.evidence });
  }
  for (const [value, c] of dots) {
    out.push({ kind: 'dot', value, citations: c.citations, sources: Array.from(c.sources), evidence: c.evidence });
  }

  // Sort: most-cited first, then companies before identifiers (companies
  // are more useful to read at a glance than bare numbers).
  out.sort((a, b) => {
    if (b.citations !== a.citations) return b.citations - a.citations;
    const order = { company: 0, mc: 1, dot: 2 };
    return order[a.kind] - order[b.kind];
  });

  // Cap to keep the report panel readable.
  return out.slice(0, 12);
}

// ----- helpers -----------------------------------------------------------

function tokenizeName(name: string): string[] {
  const NOISE = new Set(['llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'lp', 'llp', 'pllc', 'the', 'and', '&', 'group', 'holdings']);
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NOISE.has(w));
}

// Two names are the SAME entity if they share at least one significant
// token (post strip-noise). "Gray Falcon United LLC" matches "Gray Falcon
// United Inc" via "gray"/"falcon"/"united". Used to dedupe self.
function shareSignificantTokens(candidate: string, self: string, selfTokenSet?: Set<string>): boolean {
  const setA = selfTokenSet || new Set(tokenizeName(self));
  const setB = tokenizeName(candidate);
  if (setA.size === 0 || setB.length === 0) return false;
  return setB.some((t) => setA.has(t));
}

const BOILERPLATE_PATTERNS: RegExp[] = [
  /\b(THE|A|AN)\s+(COMPANY|CORPORATION|GROUP|HOLDINGS?)\b/i,
  /\b(MOTOR\s+CARRIER|FREIGHT|INSURANCE)\s+(COMPANY|GROUP|HOLDINGS?)\b/i,
  /\b(UNITED\s+STATES|US|U\.S\.)\s+(COMPANY|CORPORATION)\b/i,
];

// "Hard" corporate suffixes that indicate a real registered entity. A
// 2-word match like "Acme LLC" is meaningful because LLC is registered
// somewhere. A 2-word match like "Truck Line" is not — "Line" is just a
// generic noun. We require 3+ words for any match that ends in a marketing
// suffix (LOGISTICS, TRANSPORT, FREIGHT, EXPRESS, LINES, etc.) to filter
// out noise like "Truck Line", "Long Express", "Heavy Logistics".
const HARD_SUFFIX_RE = /\b(?:LLC|L\.L\.C\.?|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|LLP|PLLC)\.?$/i;

// Common single-word generic prefixes that produce false-positive entity
// names when paired with a marketing suffix. "Truck Line", "Power Lines",
// "Heavy Express" — none of these are real entities.
const GENERIC_TWO_WORD_PREFIXES = new Set([
  'truck', 'trucks', 'trucking', 'power', 'heavy', 'long', 'fast',
  'global', 'national', 'international', 'american', 'us', 'united',
  'big', 'small', 'new', 'old', 'best', 'top', 'first', 'main',
  'general', 'common', 'standard', 'basic',
]);

function looksLikeBoilerplate(name: string): boolean {
  if (name.length < 6) return true;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return true;
  // Two-word matches require a hard corporate suffix. Marketing suffixes
  // (LOGISTICS, LINES, EXPRESS, etc.) on a 2-word match are too noisy.
  if (words.length === 2 && !HARD_SUFFIX_RE.test(name)) return true;
  // Two-word matches with a generic first word are almost always noise
  // even with a hard suffix ("Truck LLC" is hypothetically a registered
  // entity but still not the kind of signal that means anything to a
  // broker vetting their counterparty).
  if (words.length === 2 && GENERIC_TWO_WORD_PREFIXES.has(words[0].toLowerCase())) return true;
  return BOILERPLATE_PATTERNS.some((re) => re.test(name));
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bLlc\b/g, 'LLC').replace(/\bInc\b/g, 'Inc').replace(/\bL\.l\.c\.?\b/gi, 'LLC');
}
