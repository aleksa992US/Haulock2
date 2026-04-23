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

async function fmcsaFetch(path: string, webKey: string): Promise<any> {
  const url = `${FMCSA_BASE}${path}${path.includes('?') ? '&' : '?'}webKey=${encodeURIComponent(webKey)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`FMCSA ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return res.json();
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

const FMCSA_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const inflight = new Map<string, Promise<any>>();

function cacheKeyFor(query: ParsedQuery): string {
  return `${query.kind}:${query.value.toLowerCase()}`;
}

async function readCachedFmcsa(key: string): Promise<any | null> {
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
    const age = Date.now() - new Date(data.cached_at).getTime();
    if (age > FMCSA_CACHE_TTL_MS) return null;
    return data.response;
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

export async function lookupCarrier(query: ParsedQuery): Promise<CarrierReport> {
  const webKey = process.env.FMCSA_WEB_KEY;
  if (!webKey) return mockCarrier(query);

  const key = cacheKeyFor(query);

  // 1. Global shared cache (24h TTL) — serves every user.
  const cached = await readCachedFmcsa(key);
  if (cached) {
    const normalized = normalize(cached, query);
    if (normalized) return normalized;
  }

  // 2. In-flight dedup — concurrent requests for the same key wait on one FMCSA call.
  let promise = inflight.get(key);
  if (!promise) {
    let path: string;
    if (query.kind === 'dot') path = `/${encodeURIComponent(query.value)}`;
    else if (query.kind === 'mc') path = `/docket-number/${encodeURIComponent(query.value)}`;
    else path = `/name/${encodeURIComponent(query.value)}`;
    promise = fmcsaFetch(path, webKey)
      .then(async (raw) => {
        await writeCachedFmcsa(key, raw);
        return raw;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, promise);
  }

  try {
    const raw = await promise;
    const normalized = normalize(raw, query);
    if (!normalized) throw new Error('Carrier not found in FMCSA response');
    return normalized;
  } catch (err) {
    const fallback = mockCarrier(query);
    fallback.flags.push({
      sev: 'info',
      title: 'FMCSA lookup failed — showing demo data',
      desc: err instanceof Error ? err.message : 'Unknown error',
      pts: 0,
    });
    return fallback;
  }
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
