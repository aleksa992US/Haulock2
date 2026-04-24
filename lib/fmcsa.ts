export type RiskFlag = {
  sev: 'critical' | 'warning' | 'info';
  title: string;
  desc: string;
  pts: number;
  details?: string;
  metrics?: { label: string; value: string }[];
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
  safetyRating?: string;
  safetyRatingDate?: string;
  outOfService?: boolean;
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
  source: 'fmcsa' | 'mock';
  fetchedAt: string;
  score: number;
  verdict: 'low' | 'medium' | 'high';
  flags: RiskFlag[];
};

export type ParsedQuery =
  | { kind: 'dot'; value: string }
  | { kind: 'mc'; value: string }
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
    return q.length >= 7 ? { kind: 'dot', value: q } : { kind: 'mc', value: q };
  }
  return { kind: 'name', value: q };
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

  // FMCSA's public API is flaky — many hiccups are transient (single digit seconds).
  // Be aggressive on retries: 5 attempts with jittered exponential backoff, 8s per
  // attempt cap. Worst-case total budget ≈ 30s, leaves room for other checks.
  const maxAttempts = 5;
  let lastError: Error | null = null;
  let lastHttpStatus: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    let httpStatus: number | null = null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8_000); // 8s per attempt
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

  const allowedY = String(c.allowedToOperate ?? '').toUpperCase() === 'Y';
  const oos = Boolean(c.oosDate);

  const granted = c.authorityGrantedDate ?? c.firstAuthorityDate ?? c.originalAuthorityDate ?? null;
  const months = monthsBetween(granted);

  return {
    name: c.legalName || c.dbaName || 'Unknown carrier',
    dba: c.dbaName || undefined,
    mc: query.kind === 'mc' ? query.value : c.docketNumber ? String(c.docketNumber) : undefined,
    dot: c.dotNumber ? String(c.dotNumber) : query.kind === 'dot' ? query.value : undefined,
    address: fmtAddress(c),
    phone: c.telephone || undefined,
    authorityStatus: common ?? (allowedY ? 'Active' : 'Inactive'),
    commonAuthority: common,
    brokerAuthority: broker,
    contractAuthority: contract,
    authorityGrantDate: granted ?? undefined,
    authorityAge: humanAge(months),
    safetyRating: c.safetyRating || 'Not rated',
    safetyRatingDate: c.safetyRatingDate || undefined,
    outOfService: oos,
    bipdOnFile: bipd,
    bipdRequired: toNum(c.bipdRequiredAmount),
    cargoOnFile: cargo,
    cargoRequired: cargoReq || undefined,
    bondOnFile: bond,
    insuranceSummary: buildInsuranceSummary(bipd, cargo, cargoReq),
    mcs150Date: c.mcs150Date || undefined,
    mcs150Outdated: String(c.mcs150Outdated ?? '').toUpperCase() === 'Y',
    drivers: toNum(c.totalDrivers),
    powerUnits: toNum(c.totalPowerUnits),
    crashTotal: toNum(c.crashTotal),
    fatalCrash: toNum(c.fatalCrash),
    injCrash: toNum(c.injCrash),
    driverOosRate: toNum(c.driverOosRate),
    driverOosRateNat: toNum(c.driverOosRateNationalAverage),
    vehicleOosRate: toNum(c.vehicleOosRate),
    vehicleOosRateNat: toNum(c.vehicleOosRateNationalAverage),
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

async function readCachedFmcsa(key: string): Promise<{ response: any; ageMs: number } | null> {
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
    return { response: data.response, ageMs: Date.now() - new Date(data.cached_at).getTime() };
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

function pathFor(query: ParsedQuery): string {
  if (query.kind === 'dot') return `/${encodeURIComponent(query.value)}`;
  if (query.kind === 'mc') return `/docket-number/${encodeURIComponent(query.value)}`;
  return `/name/${encodeURIComponent(query.value)}`;
}

export type LookupOpts = {
  preferActiveBroker?: boolean;
  addressHint?: string;
};

export async function lookupCarrier(query: ParsedQuery, opts: LookupOpts = {}): Promise<CarrierReport> {
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
      return normalized;
    } catch (err) {
      // 2. FMCSA primary failed — try Socrata. Socrata's payload is partial
      //    (no fatalCrash, no OOS rates), so we cache it under a SEPARATE
      //    `socrata:` keyspace and never let it masquerade as full FMCSA
      //    data under the canonical `mc:` / `dot:` keys.
      try {
        const { isSocrataConfigured, lookupOnSocrata } = await import('./fmcsa-socrata');
        if (isSocrataConfigured()) {
          const raw2 = await lookupOnSocrata(query, {
            preferActiveBroker: opts.preferActiveBroker,
            addressHint: opts.addressHint,
          });
          if (raw2) {
            const normalized2 = normalize(raw2, query);
            if (normalized2) {
              await writeCachedFmcsa(`socrata:${key}`, raw2);
              return normalized2;
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
          return normalizedCached;
        }
      }

      // 4. Final fallback: prior Socrata-namespaced cache.
      const socrataCached = await readCachedFmcsa(`socrata:${key}`);
      if (socrataCached) {
        const normalized3 = normalize(socrataCached.response, query);
        if (normalized3) return normalized3;
      }

      throw new Error(
        `FMCSA is temporarily unavailable and we have no cached record for this identifier. ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  // -------- NAME lookups --------
  // Strict order: FMCSA primary → Socrata (with FMCSA-by-resolved-id retry
  // for richer data) → DB fallback (last successful resolution for this
  // name+opts). Users are paying — we always try to return *something*.
  const nameKey = nameCacheKey(query.value, opts);

  // 1. FMCSA primary first.
  try {
    const raw = await fmcsaFetch(pathFor(query), webKey);
    const normalized = normalize(raw, query);
    if (normalized) {
      // Cache the full FMCSA payload under canonical id keys AND under the
      // name+opts key for last-resort fallback.
      if (normalized.mc) await writeCachedFmcsa(`mc:${normalized.mc}`, raw);
      if (normalized.dot) await writeCachedFmcsa(`dot:${normalized.dot}`, raw);
      await writeCachedFmcsa(nameKey, raw);
      return normalized;
    }
  } catch (err) {
    console.warn('[fmcsa] FMCSA name lookup failed, trying Socrata:', err instanceof Error ? err.message : err);
  }

  // 2. Socrata fallback — much better at name disambiguation than FMCSA's
  //    /name/ endpoint. If Socrata resolves a name to an MC/DOT, retry FMCSA
  //    primary by that id to upgrade to a full payload (crashes, OOS rates,
  //    fatal-crash counts). Only fall back to the partial Socrata data if
  //    FMCSA is fully unavailable.
  try {
    const { isSocrataConfigured, lookupOnSocrata } = await import('./fmcsa-socrata');
    if (isSocrataConfigured()) {
      const socRaw = await lookupOnSocrata(query, {
        preferActiveBroker: opts.preferActiveBroker,
        addressHint: opts.addressHint,
      });
      if (socRaw) {
        const socNormalized = normalize(socRaw, query);
        if (socNormalized) {
          // Try FMCSA primary by the resolved MC or DOT for full data.
          const idQuery: ParsedQuery | null = socNormalized.mc
            ? { kind: 'mc', value: socNormalized.mc }
            : socNormalized.dot
              ? { kind: 'dot', value: socNormalized.dot }
              : null;
          if (idQuery) {
            try {
              const fullRaw = await fmcsaFetch(pathFor(idQuery), webKey);
              const fullNormalized = normalize(fullRaw, idQuery);
              if (fullNormalized) {
                if (fullNormalized.mc) await writeCachedFmcsa(`mc:${fullNormalized.mc}`, fullRaw);
                if (fullNormalized.dot) await writeCachedFmcsa(`dot:${fullNormalized.dot}`, fullRaw);
                await writeCachedFmcsa(nameKey, fullRaw);
                return fullNormalized;
              }
            } catch (idErr) {
              console.warn('[fmcsa] FMCSA-by-resolved-id failed, using Socrata data:', idErr instanceof Error ? idErr.message : idErr);
            }
          }

          // FMCSA enrichment failed — serve Socrata data. Cache under the
          // socrata: namespace (per-id) and under the name key.
          if (socNormalized.mc) await writeCachedFmcsa(`socrata:mc:${socNormalized.mc}`, socRaw);
          if (socNormalized.dot) await writeCachedFmcsa(`socrata:dot:${socNormalized.dot}`, socRaw);
          await writeCachedFmcsa(nameKey, socRaw);
          return socNormalized;
        }
      }
    }
  } catch (err) {
    console.warn('[fmcsa] Socrata name fallback failed:', err instanceof Error ? err.message : err);
  }

  // 3. Last resort: DB cache by name+opts. Returns whatever was last
  //    successfully resolved for this exact lookup context.
  const cachedByName = await readCachedFmcsa(nameKey);
  if (cachedByName) {
    const normalizedFromCache = normalize(cachedByName.response, query);
    if (normalizedFromCache) {
      console.warn('[fmcsa] Both FMCSA and Socrata down — serving last-known cache for', nameKey);
      return normalizedFromCache;
    }
  }

  throw new Error(
    'Carrier lookup failed: FMCSA, Socrata, and our cache all returned no match for this name.',
  );
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
