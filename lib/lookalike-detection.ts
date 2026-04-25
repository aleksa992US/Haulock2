// Lookalike-domain detection for fraud signals.
// Detects three classes of impersonation:
//   1. Levenshtein-near domains (acmefreight.com vs acme-freights.com)
//   2. Homograph swaps  (o↔0, l↔1↔i, m↔rn, etc.)
//   3. TLD swaps        (.com → .net / .co / .us / .biz / ...)
//
// Used by the verify and rate-con-scan flows to flag a sender domain when
// it's suspiciously close to — but not identical to — a known legitimate
// domain (typically the carrier's actual FMCSA-listed website).

export type LookalikeKind = 'levenshtein' | 'homograph' | 'tld_swap' | 'subdomain_swap';

export type LookalikeMatch = {
  suspect: string;       // the domain we're checking
  legit: string;         // the legitimate domain it's mimicking
  kind: LookalikeKind;
  distance: number;      // edit distance for levenshtein, 0 for exact-after-normalization matches
};

export function detectLookalike(suspectInput: string | undefined | null, legitInput: string | undefined | null): LookalikeMatch | null {
  const suspect = normalizeDomain(suspectInput);
  const legit = normalizeDomain(legitInput);
  if (!suspect || !legit) return null;
  if (suspect === legit) return null; // identical = legit, no flag

  // 1. TLD swap — same registrable name, different TLD.
  //    "acmefreight.com" vs "acmefreight.net" → strong impersonation signal.
  const sBase = registrableBase(suspect);
  const lBase = registrableBase(legit);
  if (sBase && lBase && sBase === lBase) {
    return { suspect, legit, kind: 'tld_swap', distance: 0 };
  }

  // 2. Homograph swap — apply common confusable substitutions then compare.
  if (homographEquivalent(stripTld(suspect), stripTld(legit))) {
    return { suspect, legit, kind: 'homograph', distance: 0 };
  }

  // 3. Subdomain attack — legit name appears as a subdomain of attacker domain.
  //    "acmefreight.com.payments-update.net" → flag.
  if (suspect.includes('.' + legit) || suspect.includes(legit + '.')) {
    return { suspect, legit, kind: 'subdomain_swap', distance: 0 };
  }

  // 4. Levenshtein distance on stripped names. Threshold tuned to avoid
  //    false positives — a 6-letter brand can collide with random words at
  //    distance 3, so we keep ≤ 2 only.
  const sStripped = stripTld(suspect);
  const lStripped = stripTld(legit);
  // Skip if either side is too short — false positive rate explodes.
  if (sStripped.length < 5 || lStripped.length < 5) return null;
  const dist = levenshtein(sStripped, lStripped);
  if (dist > 0 && dist <= 2) {
    return { suspect, legit, kind: 'levenshtein', distance: dist };
  }

  return null;
}

// Normalize: lowercase, strip protocol, strip path, strip leading "www.",
// strip trailing dot. Returns undefined for empty / invalid input.
export function normalizeDomain(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  let s = String(input).trim().toLowerCase();
  if (!s) return undefined;
  // Pull domain out of an email address if needed.
  const atIdx = s.indexOf('@');
  if (atIdx >= 0) s = s.slice(atIdx + 1);
  // Strip protocol + trailing path.
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  // Strip www and trailing dot.
  s = s.replace(/^www\./, '').replace(/\.$/, '');
  if (!s.includes('.')) return undefined;
  return s;
}

// Best-effort registrable base: drop the last TLD label. Good enough for
// detecting `.com` vs `.net` swaps; doesn't try to handle multi-label
// public suffixes (.co.uk etc.) — acceptable false-negative rate for our
// use case.
export function registrableBase(domain: string): string | undefined {
  const parts = domain.split('.');
  if (parts.length < 2) return undefined;
  return parts.slice(0, -1).join('.');
}

function stripTld(domain: string): string {
  const idx = domain.lastIndexOf('.');
  return idx > 0 ? domain.slice(0, idx) : domain;
}

// Common visually-confusable character substitutions. We normalize both
// sides through this map and check for equality. Catches `0` for `o`,
// `1`/`l`/`I` swaps, `rn` for `m`, etc.
const HOMOGRAPH_MAP: Record<string, string> = {
  '0': 'o', 'o': 'o',
  '1': 'l', 'l': 'l', 'i': 'l',
  '5': 's', 's': 's',
  '8': 'b', 'b': 'b',
  '6': 'g', 'g': 'g',
  '@': 'a', 'a': 'a',
  // Cyrillic look-alikes (homoglyph attacks).
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
};

function homographFold(s: string): string {
  // Apply char-level fold first.
  const folded = Array.from(s).map((c) => HOMOGRAPH_MAP[c] ?? c).join('');
  // Then apply two-char folds (rn → m, vv → w).
  return folded.replace(/rn/g, 'm').replace(/vv/g, 'w');
}

function homographEquivalent(a: string, b: string): boolean {
  if (a === b) return false; // already-equal isn't a swap
  return homographFold(a) === homographFold(b);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Two-row DP — O(min(m,n)) memory.
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,         // insert
        prev[j] + 1,             // delete
        prev[j - 1] + cost,      // substitute
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function describeLookalike(m: LookalikeMatch): { title: string; desc: string } {
  const titles: Record<LookalikeKind, string> = {
    tld_swap: 'Sender domain is a TLD swap of the carrier\'s real website',
    homograph: 'Sender domain uses look-alike characters to impersonate the carrier',
    subdomain_swap: 'Carrier\'s real domain appears as a subdomain (impersonation pattern)',
    levenshtein: 'Sender domain is suspiciously close to the carrier\'s real website',
  };
  const descs: Record<LookalikeKind, string> = {
    tld_swap: `The rate-con sender uses ${m.suspect} but the FMCSA-listed website is ${m.legit}. Same name, different TLD — classic typosquat.`,
    homograph: `${m.suspect} uses character substitutions (e.g., 0/o, 1/l, rn/m) to look like the legitimate ${m.legit}. Always re-type the domain to verify.`,
    subdomain_swap: `${m.suspect} contains ${m.legit} as a subdomain. The actual registered domain is different — payment redirected here goes to the impersonator.`,
    levenshtein: `${m.suspect} is ${m.distance} character${m.distance === 1 ? '' : 's'} off from ${m.legit}. Likely typosquat — verify by phoning the carrier on a known-good number.`,
  };
  return { title: titles[m.kind], desc: descs[m.kind] };
}
