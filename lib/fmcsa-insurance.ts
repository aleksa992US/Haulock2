// Insurance filings on record with FMCSA, from the public "ActPendInsur - All
// With History" dataset on data.transportation.gov (active and pending
// policies, refreshed daily). Used by the COI check to compare a certificate
// of insurance against what the insurer actually filed.
//
// Configure via env (optional):
//   FMCSA_INSURANCE_DATASET_ID  (defaults to qh9u-swkp)
//   SOCRATA_APP_TOKEN           (shared with lib/fmcsa-socrata.ts)

const BASE = 'https://data.transportation.gov';
const DATASET = () => process.env.FMCSA_INSURANCE_DATASET_ID || 'qh9u-swkp';

export type InsuranceFiling = {
  // FMCSA's coverage label, e.g. "BIPD/Primary", "BIPD/Excess", "CARGO", "SURETY".
  coverage: string;
  formCode: string | null;
  insurer: string;
  policyNumber: string | null;
  // Amounts are in thousands of dollars, as FMCSA publishes them (750 = $750K).
  maxCoverageK: number | null;
  underlyingK: number | null;
  postedDate: string | null; // YYYY-MM-DD
  effectiveDate: string | null; // YYYY-MM-DD
  cancelEffectiveDate: string | null; // YYYY-MM-DD — set when a cancellation is pending
};

export type InsuranceFilingsResult = {
  filings: InsuranceFiling[];
  // When FMCSA last refreshed the dataset (ISO date), for "data as of" lines.
  asOf: string | null;
  error?: string;
};

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) h['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  return h;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: headers(), signal: controller.signal });
    if (!res.ok) throw new Error(`FMCSA insurance data ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// MM/DD/YYYY → YYYY-MM-DD
function isoDate(v: unknown): string | null {
  const m = String(v ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function num(v: unknown): number | null {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

let asOfCache: { value: string | null; at: number } | null = null;

async function datasetUpdatedAt(): Promise<string | null> {
  if (asOfCache && Date.now() - asOfCache.at < 6 * 3600_000) return asOfCache.value;
  try {
    const meta = await fetchJson(`${BASE}/api/views/${DATASET()}.json`, 5000);
    const value = typeof meta?.rowsUpdatedAt === 'number' ? new Date(meta.rowsUpdatedAt * 1000).toISOString().slice(0, 10) : null;
    asOfCache = { value, at: Date.now() };
    return value;
  } catch {
    return null;
  }
}

// Look up filings by MC docket (preferred) or USDOT number.
export async function fetchInsuranceFilings(ids: { mc?: string | null; dot?: string | null }): Promise<InsuranceFilingsResult> {
  const mc = String(ids.mc || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
  const dot = String(ids.dot || '').replace(/[^0-9]/g, '');
  if (!mc && !dot) return { filings: [], asOf: null, error: 'No MC or DOT number to look up' };

  const params = new URLSearchParams({ $limit: '50' });
  if (mc) params.set('docket_number', `MC${mc}`);
  else params.set('dot_number', dot.padStart(8, '0'));

  try {
    const [rows, asOf] = await Promise.all([
      fetchJson(`${BASE}/resource/${DATASET()}.json?${params.toString()}`),
      datasetUpdatedAt(),
    ]);
    const filings: InsuranceFiling[] = (Array.isArray(rows) ? rows : []).map(toFiling);
    return { filings, asOf };
  } catch (e: any) {
    return { filings: [], asOf: null, error: e?.name === 'AbortError' ? 'FMCSA insurance data timed out' : e?.message || 'FMCSA insurance data unavailable' };
  }
}

function toFiling(r: any): InsuranceFiling {
  return {
    coverage: String(r.mod_col_1 || r.ins_form_code || 'Unknown').trim(),
    formCode: r.ins_form_code ? String(r.ins_form_code).trim() : null,
    insurer: String(r.name_company || '').replace(/\s+/g, ' ').trim(),
    policyNumber: r.policy_no ? String(r.policy_no).trim() : null,
    maxCoverageK: num(r.max_cov_amount),
    underlyingK: num(r.underl_lim_amount),
    postedDate: isoDate(r.trans_date),
    effectiveDate: isoDate(r.effective_date),
    cancelEffectiveDate: isoDate(r.cancl_effective_date),
  };
}

// ---------- Reverse lookup: which carrier filed this policy number? ----------
// Used when the certificate doesn't print an MC/DOT number (or the one it
// prints can't be matched): the auto liability policy number usually appears
// in the insurer's FMCSA filing, which carries the carrier's docket and DOT.

const alnum = (s: string | null | undefined) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Certificates often add a term suffix the FMCSA filing doesn't have
// ("TINCA1444040-25" vs "TINCA1444040"), or the other way round. The core is
// the number without a trailing separator + 1–3 character suffix.
export function policyNumberCore(raw: string | null | undefined): string {
  const up = String(raw || '').toUpperCase().trim();
  const core = alnum(up.replace(/[\s\-/.]+[A-Z0-9]{1,3}[\s\-/.]*$/, ''));
  // Too little left ("CA 123 456" → "CA123"): the "suffix" was part of the number.
  return core.length >= 6 ? core : alnum(up);
}

// True when an FMCSA policy number is the same policy as the certificate's,
// allowing for a term suffix on either side. Deliberately stricter than a
// substring test: "TINCA14440401" is a different policy from "TINCA1444040".
export function samePolicyNumber(certificate: string | null | undefined, fmcsa: string | null | undefined): boolean {
  const a = alnum(certificate);
  const b = alnum(fmcsa);
  if (a.length < 6 || b.length < 6) return false;
  if (a === b) return true;
  const ca = policyNumberCore(certificate);
  const cb = policyNumberCore(fmcsa);
  return ca.length >= 6 && (ca === cb || ca === b || a === cb);
}

export type PolicyFilingMatch = {
  docket: string | null; // MC digits, no leading zeros
  dot: string | null; // USDOT digits, no leading zeros
  filing: InsuranceFiling;
};

// Keeps the rows whose policy number is the certificate's policy.
export function matchPolicyRows(policyNumber: string, rows: any[]): PolicyFilingMatch[] {
  const digits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '').replace(/^0+/, '') || null;
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => samePolicyNumber(policyNumber, r?.policy_no))
    .map((r) => ({
      // Only MC dockets are motor-carrier numbers; MX/FF dockets aren't looked up by MC.
      docket: /^\s*MC/i.test(String(r.docket_number || '')) ? digits(r.docket_number) : null,
      dot: digits(r.dot_number),
      filing: toFiling(r),
    }));
}

export type PolicyLookupResult = { matches: PolicyFilingMatch[]; error?: string };

export async function findFilingsByPolicyNumber(policyNumber: string | null | undefined): Promise<PolicyLookupResult> {
  const raw = String(policyNumber || '').toUpperCase().trim();
  const core = policyNumberCore(raw);
  if (core.length < 6) return { matches: [], error: 'Policy number too short to look up' };
  // Prefixes to search: the number as printed and its core. Only characters a
  // policy number can contain go into the query.
  const safe = (s: string) => s.replace(/[^A-Z0-9 \-/.]/g, '');
  const prefixes = Array.from(new Set([safe(raw), safe(raw.replace(/[\s\-/.]+[A-Z0-9]{1,3}[\s\-/.]*$/, '')), core]))
    .filter((p) => alnum(p).length >= 6);
  const where = prefixes.map((p) => `starts_with(upper(policy_no), '${p.replace(/'/g, "''")}')`).join(' OR ');
  const params = new URLSearchParams({ $where: where, $limit: '25' });
  try {
    const rows = await fetchJson(`${BASE}/resource/${DATASET()}.json?${params.toString()}`);
    return { matches: matchPolicyRows(raw, rows) };
  } catch (e: any) {
    return { matches: [], error: e?.name === 'AbortError' ? 'FMCSA insurance data timed out' : e?.message || 'FMCSA insurance data unavailable' };
  }
}
