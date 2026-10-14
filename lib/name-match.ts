// Company-name matching for name searches.
//
// One name can belong to many registered companies: "Summit Logistics" is
// 50+ FMCSA records. These helpers score how closely a registered legal name
// or DBA resembles what the user typed, then decide whether there is exactly
// one strong match (proceed), several (the user picks), or none.
//
// Pure functions, no I/O, so they can be unit-tested with fixtures.

export type MatchStrength = 'exact' | 'strong' | 'partial' | 'weak' | 'none';

export type NameScore = { strength: MatchStrength; score: number };

// Corporate suffixes carry no identity: "APOLLO FREIGHT INC" = "Apollo Freight".
const SUFFIXES = new Set([
  'LLC', 'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED',
  'LP', 'LLP', 'PLLC', 'PC', 'PLC', 'LC',
]);
const STOPWORDS = new Set(['THE', 'AND', 'OF', 'A', 'DBA']);
// Words so common in trucking names that sharing one says nothing about
// whether two names are the same company.
const GENERIC = new Set([
  'LOGISTICS', 'LOGISTIC', 'FREIGHT', 'TRANSPORT', 'TRANSPORTS', 'TRANSPORTATION', 'TRANS', 'TRANSIT',
  'TRUCKING', 'TRUCK', 'TRUCKS', 'EXPRESS', 'XPRESS', 'LINES', 'LINE', 'CARRIER', 'CARRIERS',
  'SERVICES', 'SERVICE', 'GROUP', 'SOLUTIONS', 'ENTERPRISES', 'ENTERPRISE', 'BROKERAGE', 'BROKERS',
  'BROKER', 'SYSTEMS', 'INTERNATIONAL', 'INTL', 'USA', 'US', 'AMERICA', 'AMERICAN', 'NATIONAL',
  'GLOBAL', 'HAULING', 'MOVING', 'DELIVERY', 'SHIPPING', 'SUPPLY', 'CHAIN', 'DISTRIBUTION',
  'WAREHOUSING', 'HOLDINGS', 'MANAGEMENT', 'PARTNERS', 'CARGO', 'FLEET', 'MOTOR', 'MOTORS',
]);

const NONE: NameScore = { strength: 'none', score: 0 };
const RANK: Record<MatchStrength, number> = { exact: 4, strong: 3, partial: 2, weak: 1, none: 0 };

// Upper-case word tokens with punctuation, corporate suffixes and filler
// words removed. "Fifth Wheel Freight, L.L.C." → ["FIFTH", "WHEEL", "FREIGHT"].
export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let s = raw.toUpperCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/&/g, ' AND ');
  s = s.replace(/[.'’`]/g, ''); // L.L.C. → LLC, O'NEIL → ONEIL
  s = s.replace(/[^A-Z0-9]+/g, ' ');
  s = s.replace(/\bL L C\b/g, 'LLC').replace(/\bL L P\b/g, 'LLP');
  return s.split(' ').filter((t) => t && !SUFFIXES.has(t) && !STOPWORDS.has(t));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Same word, allowing a plural ("LOGISTIC"/"LOGISTICS") or a one-letter typo
// in longer words ("LOGISTCS").
function tokenEq(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min >= 4 && Math.abs(a.length - b.length) === 1 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (min >= 5 && levenshtein(a, b) <= 1) return true;
  return false;
}

// How closely one registered name resembles the search.
//   exact   — same words (any order, suffixes ignored)
//   strong  — every searched word is in the name with at most a couple of
//             extra words ("Apollo Freight" vs "APOLLO FREIGHT SYSTEMS INC"),
//             or the name is the search minus one word
//   partial — shares at least half of the distinctive words
//   weak    — shares only generic words ("LOGISTICS")
export function scoreName(query: string, name: string | null | undefined): NameScore {
  const q = nameTokens(query);
  const n = nameTokens(name);
  if (!q.length || !n.length) return NONE;
  // Same letters, different spacing: "FEDEX" vs "FED EX".
  if (q.join('') === n.join('')) return { strength: 'exact', score: 1 };

  const qMatched = q.map((t) => n.some((u) => tokenEq(t, u)));
  const nMatched = n.map((u) => q.some((t) => tokenEq(t, u)));
  const qHits = qMatched.filter(Boolean).length;
  const nHits = nMatched.filter(Boolean).length;
  if (qHits === 0) return NONE;

  // Distinctive words decide identity. A search made only of generic words
  // ("American Freight") treats all of them as distinctive.
  const qDistinct = q.filter((t) => !GENERIC.has(t));
  const pool = qDistinct.length ? qDistinct : q;
  const distinctHits = pool.filter((t) => n.some((u) => tokenEq(t, u))).length;
  const overlap = (qHits / q.length) * (nHits / n.length);
  if (distinctHits === 0) return { strength: 'weak', score: 0.1 + 0.1 * overlap };

  const qMissing = q.length - qHits;
  const nExtra = n.filter((_, i) => !nMatched[i]);
  const extraWeight = nExtra.reduce((s, u) => s + (GENERIC.has(u) ? 0.5 : 1), 0);

  if (qMissing === 0 && nExtra.length === 0) return { strength: 'exact', score: 1 };
  if (qMissing === 0 && extraWeight <= 2) return { strength: 'strong', score: 0.7 + 0.25 * overlap };
  if (qMissing <= 1 && nExtra.length === 0 && n.length >= 2) return { strength: 'strong', score: 0.7 + 0.2 * overlap };
  if (distinctHits / pool.length >= 0.5) return { strength: 'partial', score: 0.4 + 0.25 * overlap };
  return { strength: 'weak', score: 0.1 + 0.2 * overlap };
}

// Best of the legal-name and DBA scores.
export function scoreCompany(query: string, legalName?: string | null, dba?: string | null): NameScore {
  const a = scoreName(query, legalName);
  const b = scoreName(query, dba);
  if (RANK[b.strength] > RANK[a.strength]) return b;
  if (RANK[b.strength] === RANK[a.strength] && b.score > a.score) return b;
  return a;
}

export function isStrongMatch(s: NameScore | MatchStrength): boolean {
  const strength = typeof s === 'string' ? s : s.strength;
  return strength === 'exact' || strength === 'strong';
}

export type NameCandidateInput = {
  name: string;
  dba?: string;
  mc?: string;
  dot?: string;
  city?: string;
  state?: string;
  zip?: string;
  status?: string;
  // Any active authority / allowed to operate.
  active?: boolean;
  brokerActive?: boolean;
  via?: 'fmcsa' | 'socrata' | 'web-search';
};

export type ScoredCandidate = NameCandidateInput & NameScore;

export type NameSelection =
  // Exactly one company matches strongly (or context narrowed it to one).
  | { kind: 'unique'; match: ScoredCandidate; plausible: number }
  // Several plausible companies; `candidates` is the closest few, `total` all of them.
  | { kind: 'ambiguous'; candidates: ScoredCandidate[]; total: number }
  // No strong match; `near` holds partial matches worth showing as "did you mean".
  | { kind: 'none'; near: ScoredCandidate[] };

export type SelectContext = {
  // Rate-con scans know they're looking for a broker: one active broker among
  // several same-name companies is a safe pick there.
  preferActiveBroker?: boolean;
  // City / state / ZIP from the document, used the same way.
  addressHint?: string;
};

export const MAX_CANDIDATES = 8;

function idKey(c: NameCandidateInput): string | null {
  const dot = (c.dot || '').replace(/^0+/, '');
  if (dot) return `dot:${dot}`;
  const mc = (c.mc || '').replace(/^0+/, '');
  if (mc) return `mc:${mc}`;
  return null;
}

// One entry per company. Earlier rows win field by field (callers pass the
// live FMCSA rows first); later rows fill gaps such as a missing MC.
export function dedupeCandidates(rows: NameCandidateInput[]): NameCandidateInput[] {
  const byKey = new Map<string, NameCandidateInput>();
  for (const r of rows) {
    if (!r || !r.name) continue;
    const key = idKey(r);
    if (!key) continue; // nothing to look it up by, so it can't be picked
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { ...r }); continue; }
    for (const [k, v] of Object.entries(r)) {
      if (v == null || v === '') continue;
      const cur = (prev as any)[k];
      if (cur == null || cur === '') (prev as any)[k] = v;
    }
    if (r.active) prev.active = true;
    if (r.brokerActive) prev.brokerActive = true;
  }
  return Array.from(byKey.values());
}

function matchesHint(c: NameCandidateInput, hint: string): boolean {
  const h = hint.toUpperCase();
  const zip3 = (h.match(/\b(\d{3})\d{2}\b/) || [])[1];
  if (zip3 && c.zip && String(c.zip).startsWith(zip3)) return true;
  const words = h.split(/[^A-Z]+/).filter((w) => w.length > 3);
  const city = (c.city || '').toUpperCase();
  return words.some((w) => city.split(/[^A-Z]+/).includes(w));
}

function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  return (RANK[b.strength] - RANK[a.strength])
    || (Number(Boolean(b.active)) - Number(Boolean(a.active)))
    || (b.score - a.score)
    || a.name.localeCompare(b.name);
}

export function selectNameMatch(query: string, rows: NameCandidateInput[], ctx: SelectContext = {}): NameSelection {
  const scored: ScoredCandidate[] = dedupeCandidates(rows)
    .map((c) => ({ ...c, ...scoreCompany(query, c.name, c.dba) }))
    .sort(compareCandidates);
  const plausible = scored.filter((c) => isStrongMatch(c));

  if (plausible.length === 1) return { kind: 'unique', match: plausible[0], plausible: 1 };

  if (plausible.length > 1) {
    let pool = plausible;
    if (ctx.preferActiveBroker) {
      const brokers = pool.filter((c) => c.brokerActive);
      if (brokers.length) pool = brokers;
    }
    if (ctx.addressHint && ctx.addressHint.trim()) {
      const near = pool.filter((c) => matchesHint(c, ctx.addressHint!));
      if (near.length) pool = near;
    }
    if (pool.length === 1) return { kind: 'unique', match: pool[0], plausible: plausible.length };
    return { kind: 'ambiguous', candidates: plausible.slice(0, MAX_CANDIDATES), total: plausible.length };
  }

  return { kind: 'none', near: scored.filter((c) => c.strength === 'partial').slice(0, 5) };
}
