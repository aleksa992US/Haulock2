// The carrier's own registration contact details from FMCSA's public
// Company Census File (data.transportation.gov az4n-8mr2), as filed on its
// MCS-150: company officer names, email address, phone and the filing date.
// QCMobile doesn't return any of these. Public FMCSA data, shown so a user
// can ask for the officer by name on a number they got from FMCSA.

const CENSUS = process.env.FMCSA_CENSUS_DATASET_ID || 'az4n-8mr2';
const BASE = 'https://data.transportation.gov/resource';
const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // the census refreshes daily

export type CensusContact = {
  legalName?: string;
  officers: string[];       // up to two, as filed (title-cased)
  email?: string;
  phone?: string;
  cellPhone?: string;
  mcs150Date?: string;      // YYYY-MM-DD — when the filing was last updated
  // FMCSA's latest on-site/off-site review of the company (an "audit") and
  // the safety rating that came out of one, if any.
  lastReview?: { code: string; label: string; date: string };
  safetyRatingCode?: 'S' | 'C' | 'U';
  safetyRatingDate?: string; // YYYY-MM-DD
};

// MCMIS Company Census data dictionary (Rev08, 2026-01-23), REVIEW_TYPE.
const REVIEW_TYPES: Record<string, string> = {
  C: 'Compliance review',
  H: 'Shipper review',
  N: 'Non-ratable review',
  A: 'New-entrant safety audit',
  S: 'Safety review',
  E: 'Educational contact',
  U: 'Historical audit record',
  K: 'Automatic safety assessment review',
  F: 'Cargo tank facility review',
  G: 'Compliance review + cargo tank facility review',
  I: 'Carrier inactivated',
  J: 'Compliance review + security contact review',
};

function censusDate(v: unknown): string | undefined {
  const d = String(v ?? '').match(/^(\d{4})(\d{2})(\d{2})/);
  return d && d[1] !== '0000' ? `${d[1]}-${d[2]}-${d[3]}` : undefined;
}

const cache = new Map<string, { at: number; value: CensusContact | null }>();

function titleCase(name: string): string {
  // "MILOS STOJANOVIC" → "Milos Stojanovic"; mixed case is left as filed.
  return name === name.toUpperCase()
    ? name.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
    : name;
}

function phone(v: unknown): string | undefined {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : undefined;
}

export async function fetchCensusContact(dot: string | null | undefined): Promise<CensusContact | null> {
  const n = String(dot ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!n) return null;
  const hit = cache.get(n);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const params = new URLSearchParams({
    $where: `dot_number = ${Number(n)}`,
    $limit: '1',
    $select: 'legal_name,company_officer_1,company_officer_2,email_address,phone,cell_phone,mcs150_date,review_type,review_date,safety_rating,safety_rating_date',
  });
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${CENSUS}.json?${params.toString()}`, { headers, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Census ${res.status}`);
    const rows = await res.json();
    const r = Array.isArray(rows) ? rows[0] : null;
    let value: CensusContact | null = null;
    if (r) {
      const officers = [r.company_officer_1, r.company_officer_2]
        .map((o: unknown) => String(o ?? '').replace(/\s+/g, ' ').trim())
        .filter((o: string) => o.length > 1)
        .map(titleCase)
        .filter((o: string, i: number, all: string[]) => all.findIndex((x) => x.toLowerCase() === o.toLowerCase()) === i);
      const email = String(r.email_address || '').trim().toLowerCase();
      const reviewCode = String(r.review_type || '').trim().toUpperCase();
      const reviewDate = censusDate(r.review_date);
      const rating = String(r.safety_rating || '').trim().toUpperCase();
      value = {
        legalName: r.legal_name ? String(r.legal_name).trim() : undefined,
        officers,
        email: /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) ? email : undefined,
        phone: phone(r.phone),
        cellPhone: phone(r.cell_phone),
        mcs150Date: censusDate(r.mcs150_date),
        lastReview: reviewCode && reviewDate ? { code: reviewCode, label: REVIEW_TYPES[reviewCode] || `Review (type ${reviewCode})`, date: reviewDate } : undefined,
        safetyRatingCode: rating === 'S' || rating === 'C' || rating === 'U' ? rating : undefined,
        safetyRatingDate: censusDate(r.safety_rating_date),
      };
    }
    cache.set(n, { at: Date.now(), value });
    return value;
  } catch (e) {
    console.warn('[census] contact lookup failed', { dot: n, error: e instanceof Error ? e.message : e });
    return null; // not cached: try again next lookup
  } finally {
    clearTimeout(timer);
  }
}

// USDOT number for an MC, from FMCSA's public registry ("Carrier - All With
// History") — the census is keyed by USDOT only.
export async function dotForMc(mc: string | null | undefined): Promise<string | null> {
  const digits = String(mc ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  // Motus registry first (companies registered or changed since FMCSA's May
  // 2026 cutover, unpadded dockets), then the frozen legacy registry, where
  // dockets are zero-padded to 6 digits ("MC012345").
  const motus = process.env.FMCSA_MOTUS_REGISTRY_DATASET_ID || 'inys-ebih';
  const registry = process.env.FMCSA_REGISTRY_DATASET_ID || '6eyk-hxee';
  const dockets = `'MC${digits.padStart(6, '0')}', 'MC${digits}'`;
  return (
    (await firstDot(motus, `docket_number IN (${dockets})`, 'usdot_number')) ??
    (await firstDot(registry, `docket_number IN (${dockets})`, 'dot_number'))
  );
}

async function firstDot(dataset: string, where: string, column: string): Promise<string | null> {
  const params = new URLSearchParams({ $where: where, $limit: '1', $select: column });
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${dataset}.json?${params.toString()}`, { headers, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const rows = await res.json();
    const dot = String(rows?.[0]?.[column] || '').replace(/\D/g, '').replace(/^0+/, '');
    return dot || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
