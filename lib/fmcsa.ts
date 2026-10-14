import {
  selectNameMatch,
  scoreCompany,
  isStrongMatch,
  MAX_CANDIDATES,
  type NameCandidateInput,
  type MatchStrength,
} from './name-match';

export type RiskFlag = {
  sev: 'critical' | 'warning' | 'info';
  title: string;
  desc: string;
  pts: number;
  details?: string;
  metrics?: { label: string; value: string }[];
  // Web pages behind the flag (web reputation), shown as links in the report.
  links?: { title: string; url: string; domain: string; snippet?: string; category?: string }[];
  recommendation?: string;
};

export type CarrierReport = {
  name: string;
  dba?: string;
  mc?: string;
  dot?: string;
  address?: string;
  phone?: string;
  emailDomain?: string;
  authorityStatus?: string;
  commonAuthority?: string;
  brokerAuthority?: string;
  contractAuthority?: string;
  authorityAge?: string;
  authorityGrantDate?: string;
  // Operating-authority history from FMCSA's public AuthHist datasets on
  // data.transportation.gov (QCMobile itself has no grant date). Filled by
  // lib/fmcsa-authority-history after the registry lookup. `checked` false
  // means the history couldn't be fetched, so age is unknown, not "new".
  authorityHistory?: {
    checked: boolean;
    firstGrantDate?: string;     // YYYY-MM-DD, earliest GRANTED action
    ageMonths?: number;          // months since firstGrantDate
    activeSince?: string;        // start of the current unbroken authority period
    reactivatedDate?: string;    // set when that period began after a long gap
    dormantMonths?: number;      // length of the gap before reactivatedDate
    error?: string;
  };
  safetyRating?: string;
  safetyRatingDate?: string;
  // True only when FMCSA lists an out-of-service order AND does not allow
  // the carrier to operate. QCMobile keeps `oosDate` after an order is
  // lifted, so the date alone isn't enough. Undefined = the source didn't say.
  outOfService?: boolean;
  oosDate?: string;
  allowedToOperate?: boolean;
  usdotStatusCode?: string;      // QCMobile `statusCode`, raw
  insuranceSummary?: string;
  bipdOnFile?: number;
  bipdRequired?: number;
  cargoOnFile?: number;
  cargoRequired?: boolean;
  bondOnFile?: number;
  mcs150Date?: string;
  mcs150Outdated?: boolean;
  drivers?: number;
  powerUnits?: number;
  crashTotal?: number;
  fatalCrash?: number;
  injCrash?: number;
  driverOosRate?: number;
  driverOosRateNat?: number;
  vehicleOosRate?: number;
  vehicleOosRateNat?: number;
  // 24-month roadside inspection counts behind the OOS rates (QCMobile
  // driverInsp / driverOosInsp / vehicleInsp / vehicleOosInsp).
  driverInspections?: number;
  driverOosInspections?: number;
  vehicleInspections?: number;
  vehicleOosInspections?: number;
  operation?: string;
  addressCheck?: {
    configured: boolean;
    found: boolean;
    matchedName?: string;
    matchedAddress?: string;
    types?: string[];
    businessStatus?: string;
    isMailbox?: boolean;
    mailboxProvider?: string;
    isResidence?: boolean;
    addressMatched?: boolean;
    nameMatches?: boolean;
    error?: string;
  };
  webPresence?: {
    configured: boolean;
    found: boolean;
    domain?: string;
    url?: string;
    title?: string;
    snippet?: string;
    nameMatch?: boolean;
    // Accepted as the company's own site only with name + address/phone
    // evidence (see assessWebsiteOwnership). Missing on older saved reports.
    verified?: boolean;
    verifiedBy?: 'address' | 'phone' | 'name-only' | 'none';
    addressMatch?: boolean;
    phoneMatch?: boolean;
    source?: string;
    domainAgeDays?: number | null;
    hasMx?: boolean;
    hasSpf?: boolean;
    matchesEmailDomain?: boolean | null;
    socials?: { platform: string; url: string }[];
    error?: string;
  };
  // Per-source scan summary — populated by the verify route after enrichment.
  // Lets the UI show "we checked these sources" with a green/red dot for each.
  sources?: { name: string; ok: boolean; note: string }[];
  // Chameleon-carrier links: other carriers sharing this carrier's phone or
  // physical address that have an active enforcement flag or fraud history.
  // Populated by the verify route via lib/chameleon-detection.
  chameleonLinks?: {
    source: 'fmcsa-flag' | 'our-lookup';
    matchedOn: 'phone' | 'address' | 'phone+address';
    name: string;
    mc?: string;
    dot?: string;
    reason: string;
    badStatus: boolean;
  }[];
  // Sender-domain lookalike check populated by lib/lookalike-detection when
  // the verify request supplied an `email=` query param.
  queriedEmail?: string;
  lookalikeMatch?: {
    suspect: string;
    legit: string;
    kind: 'levenshtein' | 'homograph' | 'tld_swap' | 'subdomain_swap';
    distance: number;
  };
  // Web-reputation result from lib/web-reputation: Brave Search hits on
  // "{name} fraud / scam / lawsuit / etc.". `hits` is the trusted-source
  // subset (drives the fraud-mention flag). `extractionHits` is the wider
  // set (used by lib/linked-entity-extractor to mine aliases/MCs from any
  // article that matches the seed, regardless of domain trust level).
  webReputation?: {
    configured: boolean;
    ok: boolean;
    hits: { title: string; url: string; domain: string; snippet: string; query: string; category?: 'fraud' | 'legal' | 'mention' }[];
    reviewHits?: { title: string; url: string; domain: string; snippet: string; query: string; category?: 'fraud' | 'legal' | 'mention' }[];
    extractionHits?: { title: string; url: string; domain: string; snippet: string; query: string }[];
    queriesRun: number;
    error?: string;
  };
  // Linked entities extracted from web coverage: aliases, sister-entities,
  // and co-cited MC/DOT numbers mentioned alongside this carrier in
  // trusted-source articles. Catches multi-MC fraud networks.
  linkedEntities?: {
    kind: 'company' | 'mc' | 'dot';
    value: string;
    citations: number;
    sources: string[];
    evidence: string;
  }[];
  // Cross-references from a third-party 2021 reference dataset (loaded
  // from Supabase). Two pieces: this carrier's own 2021 rating, and other
  // FMCSA records that shared the carrier's email in 2021. Surfaced as
  // neutral reference data — never as Haulock's verdict.
  legacyReference?: {
    rating: {
      riskOverall: string | null;
      trucksTotal: number | null;
      capturedAt: string;
      source: string;
    } | null;
    emailMatches: {
      email: string;
      otherCarrier: { name: string | null; mc: string | null; dot: string | null };
      capturedAt: string;
    }[];
  };
  // FMCSA Safety Measurement System data — BASIC scores, inspection
  // breakdown, crash detail. Populated from lib/fmcsa-sms.
  sms?: {
    configured: boolean;
    fetched: boolean;
    dot: string;
    carrier: {
      legalName?: string;
      totalTrucks?: number;
      totalDrivers?: number;
      hazmatCarrier?: boolean;
      carrierOperation?: string;
      cargoHauled?: string;
      mcs150Date?: string;
      mcs150MileageYear?: string;
      mcs150Mileage?: number;
    };
    basics: Partial<Record<
      'unsafeDriving' | 'hoursOfService' | 'driverFitness' | 'controlledSubstances' | 'vehicleMaintenance' | 'hazmat' | 'crashIndicator',
      { measure: number; inspections: number; alert: boolean }
    >>;
    inspections: {
      vehicleInspections: number;
      driverInspections: number;
      vehicleOosCount: number;
      driverOosCount: number;
      vehicleOosPct: number | null;
      driverOosPct: number | null;
      vehicleNationalAvgPct: number | null;
      driverNationalAvgPct: number | null;
    } | null;
    crashes: { total: number; fatal: number; injury: number; towaway: number } | null;
    lastUpdate?: string;
    lastSafetyMeasurementDate?: string;
    fetchedAt: string;
    error?: string;
  };
  source: 'fmcsa' | 'mock';
  // When this record was pulled from its source. For a cached or archived
  // copy that is the original pull, not the time of this scan.
  fetchedAt: string;
  // Where the FMCSA fields came from. 'fmcsa-live' = FMCSA's QCMobile API
  // answered this scan. Anything else means it didn't and the report uses an
  // older copy: 'socrata' = FMCSA's daily public data file, 'cache' = our
  // last saved FMCSA response, 'archive' = an earlier carrier_snapshots
  // record. Unset on mock/demo data.
  dataSource?: DataSource;
  // Date the FMCSA data is from (ISO). Same as fetchedAt for live data.
  dataAsOf?: string;
  // Fields this fetch lacked that were filled from an earlier saved record,
  // with that record's date. The report marks them as such.
  backfilled?: { field: string; asOf: string }[];
  // How the company was found: by MC or DOT number, by the single strong
  // match for a typed name, or picked by the user from a list of name matches.
  matchedBy?: 'mc' | 'dot' | 'name' | 'name-choice';
  // What the user typed. For 'name-choice', the name searched before picking.
  searchedFor?: string;
  score: number;
  verdict: 'low' | 'medium' | 'high';
  flags: RiskFlag[];
};

// `ambiguous` marks bare digits ("1274941"): MC and USDOT numbers both run to
// 7 digits now and the same digits are usually two different companies, so the
// kind is only a guess. Callers taking user input run resolveQuery() first.
export type ParsedQuery =
  | { kind: 'dot'; value: string; ambiguous?: boolean }
  | { kind: 'mc'; value: string; ambiguous?: boolean }
  | { kind: 'name'; value: string };

const FMCSA_BASE = 'https://mobile.fmcsa.dot.gov/qc/services/carriers';

export function parseQuery(raw: string): ParsedQuery | null {
  const q = raw.trim();
  if (!q) return null;
  const upper = q.toUpperCase().replace(/\s+/g, '');
  const mcMatch = upper.match(/^MC[-#]?(\d{3,8})$/);
  if (mcMatch) return { kind: 'mc', value: mcMatch[1] };
  const dotMatch = upper.match(/^(?:DOT|USDOT)[-#]?(\d{3,9})$/);
  if (dotMatch) return { kind: 'dot', value: dotMatch[1] };
  if (/^\d{3,9}$/.test(q)) {
    return q.length >= 7 ? { kind: 'dot', value: q, ambiguous: true } : { kind: 'mc', value: q, ambiguous: true };
  }
  return { kind: 'name', value: q };
}

export type QueryCandidate = { kind: 'mc' | 'dot'; value: string; query: string; name: string; mc?: string; dot?: string };

// Turns bare digits into an MC or DOT by asking FMCSA about both. One match →
// that one; the same company either way → its MC; two different companies →
// `candidates` so the user picks (e.g. MC-1274941 is RMJ Cargobull LLC while
// USDOT 1274941 is an unrelated carrier). No match → the original guess, so the
// caller's usual not-found handling applies.
export async function resolveQuery(parsed: ParsedQuery): Promise<{ query: ParsedQuery } | { candidates: QueryCandidate[] }> {
  if (parsed.kind === 'name' || !parsed.ambiguous) return { query: parsed };
  // Without a WebKey every lookup is the same mock carrier; nothing to compare.
  if (!process.env.FMCSA_WEB_KEY) return { query: parsed };
  const value = parsed.value;
  const [asMc, asDot] = await Promise.all([
    lookupCarrier({ kind: 'mc', value }).catch(() => null),
    lookupCarrier({ kind: 'dot', value }).catch(() => null),
  ]);
  if (asMc && asDot && asMc.dot !== asDot.dot) {
    return {
      candidates: [
        { kind: 'mc', value, query: `MC-${value}`, name: asMc.name, mc: value, dot: asMc.dot },
        { kind: 'dot', value, query: `DOT-${value}`, name: asDot.name, mc: asDot.mc, dot: value },
      ],
    };
  }
  if (asMc) return { query: { kind: 'mc', value } };
  if (asDot) return { query: { kind: 'dot', value } };
  return { query: parsed };
}

// Message shown when a bare number matches two companies.
export function ambiguousNumberMessage(candidates: QueryCandidate[]): string {
  const [mc, dot] = candidates;
  return `${mc.value} matches two different companies: MC-${mc.value} is ${mc.name} and USDOT ${dot.value} is ${dot.name}. Search "MC-${mc.value}" or "DOT-${dot.value}".`;
}

async function logFmcsaEvent(ev: { path: string; status: 'ok' | 'error'; httpStatus: number | null; durationMs: number; error?: string }): Promise<void> {
  try {
    const { getServiceSupabase } = await import('./supabase/service');
    const svc = getServiceSupabase();
    if (!svc) return;
    await svc.from('fmcsa_events').insert({
      path: ev.path,
      status: ev.status,
      http_status: ev.httpStatus,
      duration_ms: ev.durationMs,
      error: ev.error ?? null,
    });
  } catch { /* logging must never block a lookup */ }
}

async function fmcsaFetch(path: string, webKey: string): Promise<any> {
  const url = `${FMCSA_BASE}${path}${path.includes('?') ? '&' : '?'}webKey=${encodeURIComponent(webKey)}`;

  // FMCSA's public API is flaky. Cap retries at 2 attempts and 5s per call —
  // worst case ~10s, then we fall through to Socrata fallback. Aggressive
  // retries here (we used to do 5) made interactive lookups feel broken
  // when FMCSA was having a bad minute.
  const maxAttempts = 2;
  let lastError: Error | null = null;
  let lastHttpStatus: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    let httpStatus: number | null = null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5_000); // 5s per attempt
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      httpStatus = res.status;
      lastHttpStatus = httpStatus;

      if (res.ok) {
        const json = await res.json();
        logFmcsaEvent({ path, status: 'ok', httpStatus, durationMs: Date.now() - started });
        return json;
      }

      const body = await res.text().catch(() => res.statusText);
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      const err = new Error(`FMCSA ${res.status}: ${body.slice(0, 200)}`);
      logFmcsaEvent({
        path,
        status: 'error',
        httpStatus,
        durationMs: Date.now() - started,
        error: err.message,
      });
      if (!retryable || attempt === maxAttempts) throw err;
      lastError = err;
    } catch (err) {
      logFmcsaEvent({
        path,
        status: 'error',
        httpStatus,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxAttempts) throw lastError;
    }

    // Jittered exponential backoff: ~500ms, 1s, 2s, 4s with +/-25% jitter.
    const base = 500 * Math.pow(2, attempt - 1);
    const jitter = base * 0.25 * (Math.random() * 2 - 1);
    await new Promise((r) => setTimeout(r, Math.round(base + jitter)));
  }

  throw lastError || new Error(`FMCSA call failed after ${maxAttempts} attempts (last status ${lastHttpStatus})`);
}

function pickCarrier(json: any): any | null {
  const content = json?.content;
  if (!content) return null;
  if (Array.isArray(content)) return content[0]?.carrier ?? content[0] ?? null;
  return content.carrier ?? content;
}

function fmtAddress(c: any): string | undefined {
  const parts = [c.phyStreet, c.phyCity, c.phyState, c.phyZipcode].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function fmtMoneyK(k: number | null | undefined): string | undefined {
  if (k == null || isNaN(k)) return undefined;
  if (k === 0) return '$0';
  return `$${(k * 1000).toLocaleString()}`;
}

function authorityLabel(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const c = code.toUpperCase();
  if (c === 'A') return 'Active';
  if (c === 'I') return 'Inactive';
  if (c === 'N') return 'Not authorized';
  if (c === 'P') return 'Pending';
  return code;
}

function monthsBetween(from?: string | null, to: Date = new Date()): number | null {
  if (!from) return null;
  const d = new Date(from);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((to.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
}

function humanAge(months: number | null): string | undefined {
  if (months == null) return undefined;
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}y ${rem}m` : `${years} year${years === 1 ? '' : 's'}`;
}

function toNum(v: any): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? undefined : n;
}

function buildInsuranceSummary(bipd?: number, cargo?: number, cargoReq?: boolean): string | undefined {
  if (bipd == null && cargo == null) return undefined;
  const parts: string[] = [];
  if (bipd != null) parts.push(`${fmtMoneyK(bipd)} liability`);
  if (cargo != null) {
    if (cargo === 0 && cargoReq) parts.push('no cargo insurance');
    else if (cargo > 0) parts.push(`${fmtMoneyK(cargo)} cargo`);
    else if (cargo === 0 && !cargoReq) parts.push('no cargo required');
  }
  return parts.join(' · ') || undefined;
}

export function normalize(raw: any, query: ParsedQuery): CarrierReport | null {
  const c = pickCarrier(raw);
  if (!c) return null;

  const bipd = toNum(c.bipdInsuranceOnFile);
  const cargo = toNum(c.cargoInsuranceOnFile);
  const cargoReq = String(c.cargoInsuranceRequired ?? '').toUpperCase() === 'Y';
  const bond = toNum(c.bondInsuranceOnFile);

  const common = authorityLabel(c.commonAuthorityStatus);
  const broker = authorityLabel(c.brokerAuthorityStatus);
  const contract = authorityLabel(c.contractAuthorityStatus);

  // Out-of-service. QCMobile returns `allowedToOperate` (Y/N) and `oosDate`;
  // FMCSA's element docs say oosDate is empty when allowedToOperate = Y, but
  // in practice the date can stay on the record after an order is lifted.
  // So: allowed to operate → not OOS, whatever the date says. Not allowed +
  // an OOS date (or the documented `outOfService` = Y) → OOS. Not allowed
  // with no OOS date usually means an inactive USDOT number, not an OOS
  // order. Neither field present (fallback sources) → unknown.
  const allowedRaw = String(c.allowedToOperate ?? c.allowToOperate ?? '').toUpperCase();
  const allowedY = allowedRaw === 'Y';
  const oosDate: string | undefined = c.oosDate || c.outOfServiceDate || undefined;
  const oosFlagRaw = String(c.outOfService ?? '').toUpperCase();
  const oos: boolean | undefined = allowedY
    ? false
    : oosFlagRaw === 'Y' || (allowedRaw === 'N' && Boolean(oosDate))
      ? true
      : allowedRaw === 'N' || oosFlagRaw === 'N'
        ? false
        : undefined;

  // QCMobile has no authority grant date; lib/fmcsa-authority-history fills
  // it in after the lookup. These keys only exist on reshaped fallback rows.
  const granted = c.authorityGrantedDate ?? c.firstAuthorityDate ?? c.originalAuthorityDate ?? null;
  const months = monthsBetween(granted);
  const mcs150Raw = String(c.mcs150Outdated ?? '').toUpperCase();

  return {
    name: c.legalName || c.dbaName || 'Unknown carrier',
    dba: c.dbaName || undefined,
    mc: query.kind === 'mc' ? query.value : c.docketNumber ? String(c.docketNumber) : undefined,
    dot: c.dotNumber ? String(c.dotNumber) : query.kind === 'dot' ? query.value : undefined,
    address: fmtAddress(c),
    // FMCSA QCMobile returns the phone in different fields depending on the
    // carrier record shape: `telephone` is the canonical one, but some
    // records only populate `phyPhone` (physical-address phone) or
    // `mailingPhone`. Read all of them and pick the first non-empty.
    phone: c.telephone || c.phyPhone || c.mailingPhone || c.phone || undefined,
    authorityStatus: common ?? (allowedY ? 'Active' : 'Inactive'),
    commonAuthority: common,
    brokerAuthority: broker,
    contractAuthority: contract,
    authorityGrantDate: granted ?? undefined,
    authorityAge: humanAge(months),
    safetyRating: c.safetyRating || 'Not rated',
    safetyRatingDate: c.safetyRatingDate || undefined,
    outOfService: oos,
    oosDate: oosDate ? String(oosDate) : undefined,
    allowedToOperate: allowedRaw === 'Y' ? true : allowedRaw === 'N' ? false : undefined,
    usdotStatusCode: c.statusCode ? String(c.statusCode) : undefined,
    bipdOnFile: bipd,
    bipdRequired: toNum(c.bipdRequiredAmount),
    cargoOnFile: cargo,
    cargoRequired: cargoReq || undefined,
    bondOnFile: bond,
    insuranceSummary: buildInsuranceSummary(bipd, cargo, cargoReq),
    // QCMobile only has the Y/N `mcs150Outdated`; no filing date. Missing
    // field → undefined (unknown), not "up to date".
    mcs150Date: c.mcs150Date || undefined,
    mcs150Outdated: mcs150Raw === 'Y' ? true : mcs150Raw === 'N' ? false : undefined,
    drivers: toNum(c.totalDrivers),
    powerUnits: toNum(c.totalPowerUnits),
    crashTotal: toNum(c.crashTotal),
    fatalCrash: toNum(c.fatalCrash),
    injCrash: toNum(c.injCrash),
    driverOosRate: toNum(c.driverOosRate),
    driverOosRateNat: toNum(c.driverOosRateNationalAverage),
    vehicleOosRate: toNum(c.vehicleOosRate),
    vehicleOosRateNat: toNum(c.vehicleOosRateNationalAverage),
    driverInspections: toNum(c.driverInsp),
    driverOosInspections: toNum(c.driverOosInsp),
    vehicleInspections: toNum(c.vehicleInsp),
    vehicleOosInspections: toNum(c.vehicleOosInsp),
    operation: c.carrierOperation?.carrierOperationDesc || undefined,
    source: 'fmcsa',
    fetchedAt: new Date().toISOString(),
    score: 0,
    verdict: 'low',
    flags: [],
  };
}

// ------------------------------------------------------------------
// Shared FMCSA response cache (Supabase-backed, TTL) + in-process
// request dedup. Prevents N users from causing N FMCSA calls for the
// same MC/DOT and keeps us under QCMobile rate limits.
// ------------------------------------------------------------------

// Cache rows are written on every successful API response and serve as a
// last-resort fallback when both FMCSA primary and Socrata are unavailable.
// We never read cache *first* — paid users always get a live API call so
// they see the latest crash counts, OOS rates, and authority changes.
const inflight = new Map<string, Promise<any>>();

function cacheKeyFor(query: ParsedQuery): string {
  return `${query.kind}:${query.value.toLowerCase()}`;
}

// Cache key for name queries that incorporates the lookup options. The "best
// match" for a name depends on context (preferActiveBroker, addressHint), so
// we key by name + opts so each context has its own cached resolution.
function nameCacheKey(value: string, opts: LookupOpts): string {
  const b = opts.preferActiveBroker ? '1' : '0';
  const h = (opts.addressHint || '').toLowerCase().trim();
  return `name:${value.toLowerCase().trim()}|b:${b}|h:${h}`;
}

// Detects whether a cached FMCSA response came from the FMCSA primary API
// (full payload) versus Socrata (partial — no fatalCrash, no OOS rates, no
// safety rating, no mcs150Date, no carrierOperation).
//
// We need this because an earlier code path wrote Socrata responses under the
// canonical `mc:` / `dot:` cache keys. Those rows still exist and must be
// treated as cache-misses so a fresh FMCSA primary call can overwrite them.
function isFullFmcsaResponse(raw: any): boolean {
  const c = pickCarrier(raw);
  if (!c) return false;
  // Any one of these fields being present = this is a full FMCSA payload.
  return (
    c.safetyRating != null
    || c.mcs150Date != null
    || c.carrierOperation != null
    || c.fatalCrash != null
    || c.vehicleOosRate != null
    || c.driverOosRate != null
  );
}

export type DataSource = 'fmcsa-live' | 'socrata' | 'cache' | 'archive';

// Records where a report's FMCSA fields came from and the date they're from.
function withSource(report: CarrierReport, dataSource: DataSource, asOf?: string | null): CarrierReport {
  report.dataSource = dataSource;
  if (asOf) report.dataAsOf = asOf;
  // normalize() stamps fetchedAt = now. A cached or archived copy was
  // fetched when it was saved.
  if (asOf && (dataSource === 'cache' || dataSource === 'archive')) report.fetchedAt = asOf;
  return report;
}

async function readCachedFmcsa(key: string): Promise<{ response: any; ageMs: number; cachedAt: string } | null> {
  try {
    // Dynamic import to keep the Edge-free boundary sane.
    const { getServiceSupabase } = await import('./supabase/service');
    const svc = getServiceSupabase();
    if (!svc) return null;
    const { data } = await svc
      .from('fmcsa_cache')
      .select('response,cached_at')
      .eq('cache_key', key)
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return { response: data.response, ageMs: Date.now() - new Date(data.cached_at).getTime(), cachedAt: String(data.cached_at) };
  } catch {
    return null;
  }
}

async function writeCachedFmcsa(key: string, response: any): Promise<void> {
  try {
    const { getServiceSupabase } = await import('./supabase/service');
    const svc = getServiceSupabase();
    if (!svc) return;
    await svc.from('fmcsa_cache').upsert(
      { cache_key: key, response, cached_at: new Date().toISOString() },
      { onConflict: 'cache_key' },
    );
  } catch {
    /* cache write errors are non-fatal */
  }
}

// Build a partial CarrierReport from the most recent row in
// carrier_snapshots. Used as the *very* last fallback when FMCSA primary,
// Socrata, and every cache layer have failed but we have ANY historical
// or imported snapshot for this MC/DOT.
async function snapshotFallback(query: ParsedQuery): Promise<CarrierReport | null> {
  if (query.kind === 'name') return null;
  try {
    const { findCarrierFromSnapshot } = await import('./carrier-snapshots');
    const args: { dot?: string; mc?: string } = {};
    if (query.kind === 'dot') args.dot = query.value;
    if (query.kind === 'mc') args.mc = query.value;
    const snap = await findCarrierFromSnapshot(args);
    if (!snap) return null;
    const d: any = snap.data || {};
    // dataSource/dataAsOf/fetchedAt carry the snapshot's own date, so the
    // report says how old this is instead of passing as a live fetch.
    return {
      dataSource: 'archive',
      dataAsOf: snap.capturedAt,
      name: snap.name || d.name || 'Unknown carrier',
      dba: d.dba ?? undefined,
      mc: snap.mc ?? undefined,
      dot: snap.dot ?? undefined,
      address: d.address ?? undefined,
      phone: d.phone ?? undefined,
      emailDomain: d.emailDomain ?? undefined,
      authorityStatus: d.authorityStatus ?? undefined,
      commonAuthority: d.commonAuthority ?? undefined,
      brokerAuthority: d.brokerAuthority ?? undefined,
      contractAuthority: d.contractAuthority ?? undefined,
      authorityGrantDate: d.authorityGrantDate ?? undefined,
      safetyRating: d.safetyRating ?? undefined,
      outOfService: d.outOfService ?? undefined,
      bipdOnFile: d.bipdOnFile ?? undefined,
      bondOnFile: d.bondOnFile ?? undefined,
      cargoOnFile: d.cargoOnFile ?? undefined,
      cargoRequired: d.cargoRequired ?? undefined,
      mcs150Date: d.mcs150Date ?? undefined,
      mcs150Outdated: d.mcs150Outdated ?? undefined,
      drivers: d.drivers ?? undefined,
      powerUnits: d.powerUnits ?? undefined,
      crashTotal: d.crashTotal ?? undefined,
      fatalCrash: d.fatalCrash ?? undefined,
      source: 'fmcsa',
      fetchedAt: snap.capturedAt || new Date().toISOString(),
      score: 0,
      verdict: 'low',
      flags: [],
    };
  } catch (err) {
    console.warn('[fmcsa] snapshot fallback failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

function pathFor(query: ParsedQuery): string {
  if (query.kind === 'dot') return `/${encodeURIComponent(query.value)}`;
  if (query.kind === 'mc') return `/docket-number/${encodeURIComponent(query.value)}`;
  return `/name/${encodeURIComponent(query.value)}`;
}

export type LookupOpts = {
  preferActiveBroker?: boolean;
  addressHint?: string;
  // Skip the AuthHist (authority age) fetch — for batch jobs that only
  // compare registry fields, e.g. the watchlist cron.
  skipAuthorityHistory?: boolean;
};

// Public entry point: runs the lookup chain, then fires a snapshot record
// in the background so we accumulate identity history with zero added
// latency on the user's request. The snapshot helper diffs against the
// last known state and only writes a row when something actually changed.
export async function lookupCarrier(query: ParsedQuery, opts: LookupOpts = {}): Promise<CarrierReport> {
  const carrier = await lookupCarrierImpl(query, opts);
  // Fire-and-forget — never block the user lookup on a snapshot write.
  // Only live FMCSA data is a new observation. Re-recording a cached or
  // archived copy would stamp old data with today's date, and Socrata's
  // partial rows would register missing crash fields as changes.
  if (carrier.dataSource === 'fmcsa-live') void (async () => {
    try {
      const { recordSnapshot } = await import('./carrier-snapshots');
      await recordSnapshot(carrier);
    } catch (err) {
      console.warn('[fmcsa] snapshot recording failed:', err instanceof Error ? err.message : err);
    }
  })();
  // QCMobile has no authority grant date; authority age and reactivation
  // come from FMCSA's AuthHist datasets. Added to a copy after the snapshot
  // is queued, so a failed history fetch never registers as a field change.
  if (opts.skipAuthorityHistory) return carrier;
  try {
    const { withAuthorityHistory } = await import('./fmcsa-authority-history');
    return await withAuthorityHistory(carrier);
  } catch {
    return carrier;
  }
}

async function lookupCarrierImpl(query: ParsedQuery, opts: LookupOpts = {}): Promise<CarrierReport> {
  const webKey = process.env.FMCSA_WEB_KEY;
  if (!webKey) return mockCarrier(query);

  const key = cacheKeyFor(query);

  // -------- MC / DOT lookups --------
  // Strict order: FMCSA primary API → Socrata fallback → DB cache (last
  // successful response for this id). Cache is ONLY a safety net for
  // upstream outages — every successful search hits the live API so the
  // user always sees the latest crash counts, OOS rates, authority status,
  // and insurance changes.
  if (query.kind !== 'name') {
    // 1. FMCSA primary (always try first — paid users want fresh data).
    //    In-flight dedup: concurrent requests for the same key share one call.
    let promise = inflight.get(key);
    if (!promise) {
      promise = fmcsaFetch(pathFor(query), webKey)
        .then(async (raw) => {
          await writeCachedFmcsa(key, raw);
          return raw;
        })
        .finally(() => { inflight.delete(key); });
      inflight.set(key, promise);
    }

    try {
      const raw = await promise;
      const normalized = normalize(raw, query);
      if (!normalized) throw new Error('Carrier not found in FMCSA response');
      console.log('[fmcsa] source=FMCSA-primary id-lookup', { kind: query.kind, value: query.value, full: isFullFmcsaResponse(raw) });
      return withSource(normalized, 'fmcsa-live', normalized.fetchedAt);
    } catch (err) {
      console.warn('[fmcsa] FMCSA primary id-lookup failed:', err instanceof Error ? err.message : err);
      // 2. FMCSA primary failed — try Socrata. Socrata's payload is partial
      //    (no fatalCrash, no OOS rates), so we cache it under a SEPARATE
      //    `socrata:` keyspace and never let it masquerade as full FMCSA
      //    data under the canonical `mc:` / `dot:` keys.
      try {
        const { isSocrataConfigured, lookupOnSocrata, socrataDataAsOf } = await import('./fmcsa-socrata');
        if (isSocrataConfigured()) {
          const raw2 = await lookupOnSocrata(query, {
            preferActiveBroker: opts.preferActiveBroker,
            addressHint: opts.addressHint,
          });
          if (raw2) {
            const normalized2 = normalize(raw2, query);
            if (normalized2) {
              await writeCachedFmcsa(`socrata:${key}`, raw2);
              console.log('[fmcsa] source=Socrata id-lookup', { kind: query.kind, value: query.value });
              // Dated by FMCSA's last refresh of the public file, not now.
              return withSource(normalized2, 'socrata', await socrataDataAsOf());
            }
          }
        }
      } catch (fallbackErr) {
        console.warn('[fmcsa] Socrata fallback failed:', fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
      }

      // 3. Last resort: prior FMCSA cache (may be days/weeks old) for this id.
      //    Only trust it if it's a full FMCSA payload — partial cached rows
      //    don't help anyone.
      const cached = await readCachedFmcsa(key);
      if (cached && isFullFmcsaResponse(cached.response)) {
        const normalizedCached = normalize(cached.response, query);
        if (normalizedCached) {
          console.warn('[fmcsa] FMCSA + Socrata both down — serving stale cache for', key);
          return withSource(normalizedCached, 'cache', cached.cachedAt);
        }
      }

      // 4. Final fallback: prior Socrata-namespaced cache.
      const socrataCached = await readCachedFmcsa(`socrata:${key}`);
      if (socrataCached) {
        const normalized3 = normalize(socrataCached.response, query);
        if (normalized3) return withSource(normalized3, 'cache', socrataCached.cachedAt);
      }

      // 5. Truly final fallback: serve from carrier_snapshots. We have
      //    5,748 archive snapshots imported plus whatever live searches
      //    have written. Serving partial reconstructed data beats 503'ing
      //    paid users who deserve *something* on every search.
      const snapshot = await snapshotFallback(query);
      if (snapshot) {
        console.warn('[fmcsa] FMCSA+Socrata+caches all down — reconstructing from carrier_snapshots:', key);
        return snapshot;
      }

      throw new Error(
        `FMCSA is temporarily unavailable and we have no cached record for this identifier. ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  // -------- NAME lookups --------
  return lookupByName(query.value, opts, webKey);
}

// A name can belong to many registered companies ("Summit Logistics" is 50+
// FMCSA records), so a name search never just takes the first result:
//   1. FMCSA's name search and the Socrata copy of the registry run in
//      parallel. Their results are merged and scored against what the user
//      typed (lib/name-match: normalized words, corporate suffixes ignored).
//   2. Exactly one strong match → that company is looked up by MC/DOT
//      through the id chain above (live → Socrata → cache → archive).
//      Several → AmbiguousNameError, so the user picks.
//   3. No strong match → the web-search resolver (trade names). A company it
//      finds is accepted only when its registered name resembles the search;
//      otherwise it is offered as a candidate for the user to confirm.
//   4. Registries unreachable → the last resolution saved for this name.
async function lookupByName(name: string, opts: LookupOpts, webKey: string): Promise<CarrierReport> {
  const nameKey = nameCacheKey(name, opts);
  const ctx = { preferActiveBroker: opts.preferActiveBroker, addressHint: opts.addressHint };

  const [fmcsaRows, socrata] = await Promise.all([
    fmcsaFetch(pathFor({ kind: 'name', value: name }), webKey)
      .then((raw) => carrierEntries(raw).map(fmcsaCandidate))
      .catch((err) => {
        console.warn('[fmcsa] FMCSA name search failed:', err instanceof Error ? err.message : err);
        return null;
      }),
    import('./fmcsa-socrata')
      .then(({ isSocrataConfigured, searchSocrataByName }) => (isSocrataConfigured() ? searchSocrataByName(name) : null))
      .catch((err) => {
        console.warn('[fmcsa] Socrata name search failed:', err instanceof Error ? err.message : err);
        return null;
      }),
  ]);
  const registryAnswered = fmcsaRows != null || socrata != null;
  // FMCSA rows first: for a company both sources list, the live fields win.
  const selection = selectNameMatch(name, [...(fmcsaRows || []), ...(socrata?.rows || [])], ctx);
  console.log('[fmcsa] name search', {
    name,
    fmcsaRows: fmcsaRows ? fmcsaRows.length : 'failed',
    socrataRows: socrata ? socrata.rows.length : 'n/a',
    result: selection.kind,
  });

  if (selection.kind === 'unique') {
    const report = await lookupNameMatch(name, selection.match, opts);
    await writeCachedFmcsa(nameKey, { resolution: { mc: report.mc ?? null, dot: report.dot ?? null, name: report.name } });
    return markNameMatch(report, name);
  }
  if (selection.kind === 'ambiguous') {
    throw new AmbiguousNameError(name, selection.candidates.map((c) => toNameCandidate(c, c.strength)), {
      total: selection.total,
      more: Boolean(socrata?.truncated),
    });
  }

  if (!registryAnswered) {
    const cached = await nameFromCache(name, nameKey, opts);
    if (cached) return cached;
  }

  const web = await resolveViaWebSearch(name, opts);
  if (web.match) {
    await writeCachedFmcsa(nameKey, { resolution: { mc: web.match.mc ?? null, dot: web.match.dot ?? null, name: web.match.name } });
    return markNameMatch(web.match, name);
  }

  const candidates = [
    ...web.candidates,
    ...selection.near.map((c) => toNameCandidate(c, c.strength)),
  ].filter((c, i, all) => all.findIndex((o) => o.query === c.query) === i);
  if (candidates.length) {
    throw new AmbiguousNameError(name, candidates.slice(0, MAX_CANDIDATES), {
      total: candidates.length,
      exactMatchFound: false,
      needsConfirmation: web.candidates.some((c) => c.match === 'unrelated'),
    });
  }
  // Both registries failing is an outage, not "no such company": a plain
  // Error makes the verify route answer 503 instead of 404.
  if (!registryAnswered) throw new Error(`FMCSA's name search didn't respond for "${name}".`);
  throw new NotFoundByNameError(name);
}

function markNameMatch(report: CarrierReport, name: string): CarrierReport {
  report.matchedBy = 'name';
  report.searchedFor = name;
  return report;
}

// Carrier objects in an FMCSA response (`content` is an array for name and
// docket searches, an object for DOT lookups).
function carrierEntries(json: any): any[] {
  const content = json?.content;
  if (!content) return [];
  return (Array.isArray(content) ? content : [content])
    .map((e: any) => e?.carrier ?? e)
    .filter((c: any) => c && typeof c === 'object' && (c.legalName || c.dbaName));
}

function fmcsaCandidate(c: any): NameCandidateInput {
  const allowed = String(c.allowedToOperate ?? '').toUpperCase();
  const auth = (k: string) => String(c[k] ?? '').toUpperCase() === 'A';
  const brokerActive = auth('brokerAuthorityStatus');
  const docket = c.docketNumber != null ? String(c.docketNumber).replace(/\D/g, '').replace(/^0+/, '') : '';
  const dot = c.dotNumber != null ? String(c.dotNumber).replace(/\D/g, '').replace(/^0+/, '') : '';
  return {
    name: String(c.legalName || c.dbaName),
    dba: c.legalName && c.dbaName ? String(c.dbaName) : undefined,
    mc: docket || undefined,
    dot: dot || undefined,
    city: c.phyCity || undefined,
    state: c.phyState || undefined,
    zip: c.phyZipcode ? String(c.phyZipcode) : undefined,
    status: allowed === 'Y' ? 'Allowed to operate' : allowed === 'N' ? 'Not allowed to operate' : undefined,
    active: allowed === 'Y' || brokerActive || auth('commonAuthorityStatus') || auth('contractAuthorityStatus'),
    brokerActive,
    via: 'fmcsa',
  };
}

// Full record for the one company a name matched, by MC (else DOT). The
// record that comes back must still resemble the search: a docket can map
// to a different company in the live registry than in the Socrata copy.
async function lookupNameMatch(name: string, match: NameCandidateInput, opts: LookupOpts): Promise<CarrierReport> {
  const ids: ParsedQuery[] = [];
  if (match.mc) ids.push({ kind: 'mc', value: match.mc });
  if (match.dot) ids.push({ kind: 'dot', value: match.dot });
  let lastErr: unknown = null;
  let mismatch = false;
  for (const id of ids) {
    try {
      const report = await lookupCarrierImpl(id, opts);
      if (isStrongMatch(scoreCompany(name, report.name, report.dba))) return report;
      mismatch = true;
      console.warn('[fmcsa] name match lookup returned a different company', { name, id, got: report.name });
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr && !mismatch) throw lastErr;
  throw new AmbiguousNameError(name, [toNameCandidate(match, 'partial')], { exactMatchFound: false });
}

// Last resolution saved for this name, used only when both registries are
// unreachable. New rows store the resolved id and go through the id chain
// (which labels the data's source and date). Legacy rows held a whole FMCSA
// name-search response, which is re-scored; legacy single records are
// ignored because nothing recorded whether that name was ambiguous.
async function nameFromCache(name: string, nameKey: string, opts: LookupOpts): Promise<CarrierReport | null> {
  const cached = await readCachedFmcsa(nameKey);
  if (!cached) return null;
  const res = cached.response?.resolution;
  try {
    if (res && (res.mc || res.dot)) {
      const id: ParsedQuery = res.mc ? { kind: 'mc', value: String(res.mc) } : { kind: 'dot', value: String(res.dot) };
      const report = await lookupCarrierImpl(id, opts);
      return isStrongMatch(scoreCompany(name, report.name, report.dba)) ? markNameMatch(report, name) : null;
    }
    const entries = carrierEntries(cached.response);
    if (entries.length < 2) return null;
    const sel = selectNameMatch(name, entries.map(fmcsaCandidate), {
      preferActiveBroker: opts.preferActiveBroker,
      addressHint: opts.addressHint,
    });
    if (sel.kind !== 'unique') return null;
    const entry = entries.find((e) => String(e.dotNumber ?? '').replace(/^0+/, '') === sel.match.dot);
    const report = entry ? normalize({ content: { carrier: entry } }, { kind: 'name', value: name }) : null;
    return report ? markNameMatch(withSource(report, 'cache', cached.cachedAt), name) : null;
  } catch (err) {
    console.warn('[fmcsa] name cache fallback failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Trade names: web results often cite the MC/DOT of a company whose
// registered name differs from what users call it ("Super Ego Logistics" →
// GRAY FALCON UNITED LLC). The most-cited numbers are looked up; one whose
// registered name resembles the search is accepted, the rest come back as
// candidates the user has to confirm.
async function resolveViaWebSearch(name: string, opts: LookupOpts): Promise<{ match?: CarrierReport; candidates: NameCandidate[] }> {
  try {
    const { isNameResolverConfigured, resolveNameToMc } = await import('./name-to-mc-resolver');
    if (!isNameResolverConfigured()) return { candidates: [] };
    const resolved = await resolveNameToMc(name);
    if (!resolved.found) return { candidates: [] };
    const reports = await Promise.all(
      resolved.ids.slice(0, 3).map((id) => lookupCarrierImpl({ kind: id.kind, value: id.value }, opts).catch(() => null)),
    );
    const seen = new Set<string>();
    const found: { report: CarrierReport; strength: MatchStrength }[] = [];
    for (const report of reports) {
      if (!report || report.source === 'mock') continue;
      const key = report.dot || `mc:${report.mc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ report, strength: scoreCompany(name, report.name, report.dba).strength });
    }
    const strong = found.filter((f) => isStrongMatch(f.strength));
    console.log('[fmcsa] web-search name resolver', {
      name,
      ids: resolved.ids.slice(0, 3),
      found: found.map((f) => ({ name: f.report.name, strength: f.strength })),
    });
    if (strong.length === 1) return { match: strong[0].report, candidates: [] };
    return {
      candidates: found.map((f) => toNameCandidate(
        reportCandidate(f.report),
        isStrongMatch(f.strength) ? f.strength : 'unrelated',
      )),
    };
  } catch (err) {
    console.warn('[fmcsa] name-to-mc resolver failed:', err instanceof Error ? err.message : err);
    return { candidates: [] };
  }
}

function reportCandidate(r: CarrierReport): NameCandidateInput {
  // fmtAddress joins street, city, state, ZIP; only trust positions when all four are there.
  const parts = (r.address || '').split(', ');
  return {
    name: r.name,
    dba: r.dba,
    mc: r.mc,
    dot: r.dot,
    city: parts.length === 4 ? parts[1] : undefined,
    state: parts.length === 4 ? parts[2] : undefined,
    status: r.brokerAuthority === 'Active' ? 'Active broker authority' : r.authorityStatus ? `Authority ${r.authorityStatus.toLowerCase()}` : undefined,
    via: 'web-search',
  };
}

export class NotFoundByNameError extends Error {
  readonly code = 'name_not_found';
  readonly searched: string;
  constructor(searched: string) {
    super(`No carrier registered under "${searched}" was found in FMCSA, Socrata, or via web search.`);
    this.name = 'NotFoundByNameError';
    this.searched = searched;
  }
}

// One company a name search could mean. Carries the same kind/value/query
// fields as QueryCandidate: searching `query` picks this company.
export type NameCandidate = {
  name: string;
  dba?: string;
  mc?: string;
  dot?: string;
  city?: string;
  state?: string;
  status?: string;
  kind: 'mc' | 'dot';
  value: string;
  query: string;
  // How closely the registered name matches the search. 'unrelated' = web
  // results tie the searched name to this company, but its registered legal
  // name and DBA are different.
  match: 'exact' | 'strong' | 'partial' | 'unrelated';
  via: 'fmcsa' | 'socrata' | 'web-search';
};

function toNameCandidate(c: NameCandidateInput, strength: MatchStrength | 'unrelated'): NameCandidate {
  const kind: 'mc' | 'dot' = c.mc ? 'mc' : 'dot';
  const value = String(c.mc || c.dot);
  return {
    name: c.name,
    dba: c.dba || undefined,
    mc: c.mc || undefined,
    dot: c.dot || undefined,
    city: c.city || undefined,
    state: c.state || undefined,
    status: c.status || undefined,
    kind,
    value,
    query: `${kind === 'mc' ? 'MC' : 'DOT'}-${value}`,
    match: strength === 'exact' || strength === 'strong' || strength === 'unrelated' ? strength : 'partial',
    via: c.via ?? 'fmcsa',
  };
}

// A typed name matched several companies, or none closely enough to accept
// without asking. The verify routes answer 409 `ambiguous_name` with the list.
export class AmbiguousNameError extends Error {
  readonly code = 'ambiguous_name';
  readonly searched: string;
  readonly candidates: NameCandidate[];
  // Every plausible match; `candidates` holds the closest MAX_CANDIDATES.
  readonly total: number;
  // False when no registered name matched; the list holds near names and
  // companies linked to the name only by web results.
  readonly exactMatchFound: boolean;
  readonly needsConfirmation: boolean;
  constructor(
    searched: string,
    candidates: NameCandidate[],
    opts: { total?: number; more?: boolean; exactMatchFound?: boolean; needsConfirmation?: boolean } = {},
  ) {
    const total = Math.max(opts.total ?? candidates.length, candidates.length);
    const exactMatchFound = opts.exactMatchFound ?? true;
    const needsConfirmation = Boolean(opts.needsConfirmation);
    super(ambiguousNameMessage(searched, candidates.length, total, Boolean(opts.more), exactMatchFound, needsConfirmation));
    this.name = 'AmbiguousNameError';
    this.searched = searched;
    this.candidates = candidates;
    this.total = total;
    this.exactMatchFound = exactMatchFound;
    this.needsConfirmation = needsConfirmation;
  }
}

function ambiguousNameMessage(searched: string, shown: number, total: number, more: boolean, exactMatchFound: boolean, needsConfirmation: boolean): string {
  if (!exactMatchFound) {
    return `No company is registered as "${searched}". ${shown === 1 ? 'This is the closest match we found' : 'These are the closest matches we found'}${needsConfirmation ? ', some only through web search results under a different registered name' : ''}. Pick one only if you know it's the company you mean.`;
  }
  const count = `${total}${more ? '+' : ''}`;
  return `"${searched}" matches ${count} registered companies${total > shown ? ` (showing the ${shown} closest)` : ''}. Pick the one you mean, or search by MC or DOT number.`;
}

export function mockCarrier(query: ParsedQuery): CarrierReport {
  const id = query.value;
  const isHighRisk = id === '847291' || /acme/i.test(id);
  const isMedium = id === '498732';
  if (isHighRisk) {
    return {
      name: 'Acme Freight Brokers LLC',
      mc: '847291',
      dot: '3291847',
      address: '2401 NW 12th Ave, Miami, FL 33127',
      phone: '(305) 555-0183',
      emailDomain: 'acmefreightbrokers.com',
      authorityStatus: 'Active',
      commonAuthority: 'Active',
      brokerAuthority: 'Active',
      authorityAge: '3 months · reactivated',
      safetyRating: 'Not rated',
      outOfService: false,
      bipdOnFile: 0,
      bipdRequired: 750,
      cargoOnFile: 0,
      cargoRequired: true,
      insuranceSummary: 'No insurance on file',
      drivers: 2,
      powerUnits: 2,
      crashTotal: 0,
      source: 'mock',
      fetchedAt: new Date().toISOString(),
      score: 0,
      verdict: 'low',
      flags: [],
    };
  }
  if (isMedium) {
    return {
      name: 'Coastline Transit Co',
      mc: '498732',
      dot: '2918473',
      address: '1840 Industrial Pkwy, Houston, TX 77032',
      phone: '(713) 555-0142',
      emailDomain: 'coastlinetransit.com',
      authorityStatus: 'Active',
      commonAuthority: 'Active',
      authorityAge: '7 months',
      safetyRating: 'Not rated',
      outOfService: false,
      bipdOnFile: 750,
      cargoOnFile: 100,
      insuranceSummary: '$750,000 liability · $100,000 cargo',
      drivers: 8,
      powerUnits: 6,
      source: 'mock',
      fetchedAt: new Date().toISOString(),
      score: 0,
      verdict: 'low',
      flags: [],
    };
  }
  return {
    name: query.kind === 'name' ? query.value : 'Summit Logistics Inc',
    mc: query.kind === 'mc' ? query.value : '226104',
    dot: query.kind === 'dot' ? query.value : '1827493',
    address: '500 Industrial Way, Denver, CO 80216',
    phone: '(303) 555-0119',
    emailDomain: 'summitlogistics.com',
    authorityStatus: 'Active',
    commonAuthority: 'Active',
    authorityAge: '8 years',
    safetyRating: 'Satisfactory',
    outOfService: false,
    bipdOnFile: 1000,
    cargoOnFile: 250,
    insuranceSummary: '$1,000,000 liability · $250,000 cargo',
    drivers: 24,
    powerUnits: 18,
    crashTotal: 1,
    source: 'mock',
    fetchedAt: new Date().toISOString(),
    score: 0,
    verdict: 'low',
    flags: [],
  };
}
