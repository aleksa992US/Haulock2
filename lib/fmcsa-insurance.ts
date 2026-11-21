// Insurance filings on record with FMCSA, from the public datasets on
// data.transportation.gov. Used by the COI check to compare a certificate of
// insurance against what the insurer actually filed, and by the report to
// show policies and pending cancellations.
//
// FMCSA moved licensing & insurance to its new Motus system in May 2026. The
// legacy "ActPendInsur - All With History" dataset was frozen then; the Motus
// datasets only hold companies that were registered or changed something
// since. So:
//   - Motus "Insur - All With History" (active + pending policies) and
//     "InsHist - All With History" (ended policies) win for any company they
//     list — every company with an insurance change since the cutover is in
//     one of them.
//   - Everyone else is still described by the frozen legacy snapshot.
//
// FMCSA has no "policy expires" date: a filing stays in force until the
// insurer cancels it with at least 30 days' notice. The notice is the
// warning — in Motus it is a BMC-35 row (cancellation notice) whose effective
// date is the day the cancellation takes effect; in the legacy data it was
// cancl_effective_date on the policy row.
//
// Configure via env (optional):
//   FMCSA_INSURANCE_DATASET_ID        legacy, defaults to qh9u-swkp
//   FMCSA_MOTUS_INSUR_DATASET_ID      defaults to c5y8-a4uz
//   FMCSA_MOTUS_INSHIST_DATASET_ID    defaults to 3uet-3z4i
//   FMCSA_INSHIST_DATASET_ID          legacy ended policies, defaults to 6sqe-dvqs
//   SOCRATA_APP_TOKEN                 (shared with lib/fmcsa-socrata.ts)

const BASE = 'https://data.transportation.gov';
const LEGACY = () => process.env.FMCSA_INSURANCE_DATASET_ID || 'qh9u-swkp';
const MOTUS_ACTIVE = () => process.env.FMCSA_MOTUS_INSUR_DATASET_ID || 'c5y8-a4uz';
const MOTUS_HISTORY = () => process.env.FMCSA_MOTUS_INSHIST_DATASET_ID || '3uet-3z4i';
const LEGACY_HISTORY = () => process.env.FMCSA_INSHIST_DATASET_ID || '6sqe-dvqs';

export type InsuranceFiling = {
  // FMCSA's coverage label, e.g. "BIPD/Primary", "BIPD/Excess", "CARGO", "SURETY".
  coverage: string;
  formCode: string | null; // "91X", "34", "84"… (no "BMC-" prefix)
  insurer: string;
  policyNumber: string | null;
  // Amounts are in thousands of dollars (750 = $750K).
  maxCoverageK: number | null;
  underlyingK: number | null;
  postedDate: string | null; // YYYY-MM-DD
  effectiveDate: string | null; // YYYY-MM-DD
  cancelEffectiveDate: string | null; // YYYY-MM-DD — set when a cancellation is pending
  source?: 'motus' | 'legacy';
};

// A policy that is no longer in force, and how it ended:
//   cancelled   the insurer cancelled it (non-payment, or the company moved
//               to another insurer without the old one filing a replacement)
//   replaced    a new filing took its place with no gap
//   name-change re-filed because the company or insurer name changed
export type PastFiling = {
  coverage: string;
  formCode: string | null;
  insurer: string;
  policyNumber: string | null;
  maxCoverageK: number | null;
  effectiveDate: string | null; // YYYY-MM-DD
  endedDate: string;            // YYYY-MM-DD
  ended: 'cancelled' | 'replaced' | 'name-change' | 'transferred' | 'ended';
  source: 'motus' | 'legacy';
};

export type InsuranceFilingsResult = {
  filings: InsuranceFiling[];
  // Policies that ended, newest first (up to 40), and how many of them the
  // insurer cancelled in the last 24 months.
  history?: PastFiling[];
  cancelled24m?: number;
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

async function rowsOf(dataset: string, params: URLSearchParams): Promise<any[]> {
  const rows = await fetchJson(`${BASE}/resource/${dataset}.json?${params.toString()}`);
  return Array.isArray(rows) ? rows : [];
}

// Legacy "MM/DD/YYYY" or Motus "YYYYMMDD" → "YYYY-MM-DD"
function isoDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact && compact[1] !== '0000') return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return null;
}

function num(v: unknown): number | null {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Motus publishes whole dollars (1000000.00); legacy published thousands
// (1000). A few migrated Motus liability rows still carry thousands (750.00);
// no liability limit is under $10,000, so a small BIPD value is already in
// thousands. Cargo and bond amounts are small dollar figures ($5,000 cargo,
// $75,000 bond), so they're always dollars.
function dollarsToK(v: unknown, bipd: boolean): number | null {
  const n = num(v);
  if (n == null) return null;
  if (bipd && n > 0 && n < 10_000) return Math.round(n);
  return Math.round(n / 1000);
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const asOfCache = new Map<string, { value: string | null; at: number }>();

async function datasetUpdatedAt(dataset: string): Promise<string | null> {
  const hit = asOfCache.get(dataset);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.value;
  try {
    const meta = await fetchJson(`${BASE}/api/views/${dataset}.json`, 5000);
    const value = typeof meta?.rowsUpdatedAt === 'number' ? new Date(meta.rowsUpdatedAt * 1000).toISOString().slice(0, 10) : null;
    asOfCache.set(dataset, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}

// ---------- Row → filing ----------

function formCodeOf(v: unknown): string | null {
  const s = String(v ?? '').trim().toUpperCase().replace(/^BMC-?/, '');
  return s || null;
}

// BMC-35 (motor carrier policy) and BMC-36 (surety bond) are cancellation
// notices, not policies.
function isCancelNotice(r: any): boolean {
  const f = formCodeOf(r?.ins_form_code);
  return f === '35' || f === '36';
}

function motusCoverage(r: any): string {
  const type = String(r.ins_type_code ?? '').trim();
  const form = formCodeOf(r.ins_form_code);
  const cls = String(r.ins_class_code ?? '').trim().toUpperCase();
  if (type === '1' || form === '91' || form === '91X' || form === '82' || form === '35') {
    return cls === 'P' ? 'BIPD/Primary' : cls === 'E' ? 'BIPD/Excess' : 'BIPD';
  }
  if (type === '2' || form === '34' || form === '83') return 'CARGO';
  if (type === '3' || form === '84' || form === '36') return 'SURETY';
  if (type === '4' || form === '85') return 'TRUST FUND';
  return String(r.ins_type_desc || form || 'Unknown').trim();
}

const isMotusRow = (r: any) => r && ('insurance_company_name' in r || 'usdot_number' in r);

function fromMotus(r: any): InsuranceFiling {
  const coverage = motusCoverage(r);
  const bipd = /^BIPD/.test(coverage);
  return {
    coverage,
    formCode: formCodeOf(r.ins_form_code),
    insurer: String(r.insurance_company_name || '').replace(/\s+/g, ' ').trim(),
    policyNumber: r.policy_no ? String(r.policy_no).trim() : null,
    maxCoverageK: dollarsToK(r.max_cov_amount, bipd),
    underlyingK: dollarsToK(r.underl_lim_amount, bipd),
    postedDate: isoDate(r.trans_date),
    effectiveDate: isoDate(r.effective_date),
    cancelEffectiveDate: null,
    source: 'motus',
  };
}

function fromLegacy(r: any): InsuranceFiling {
  return {
    coverage: String(r.mod_col_1 || r.ins_form_code || 'Unknown').trim(),
    formCode: formCodeOf(r.ins_form_code),
    insurer: String(r.name_company || '').replace(/\s+/g, ' ').trim(),
    policyNumber: r.policy_no ? String(r.policy_no).trim() : null,
    maxCoverageK: num(r.max_cov_amount),
    underlyingK: num(r.underl_lim_amount),
    postedDate: isoDate(r.trans_date),
    effectiveDate: isoDate(r.effective_date),
    cancelEffectiveDate: isoDate(r.cancl_effective_date),
    source: 'legacy',
  };
}

function toFiling(r: any): InsuranceFiling {
  return isMotusRow(r) ? fromMotus(r) : fromLegacy(r);
}

// ---------- Ended policies ----------

function pastFromMotus(r: any, today: string): PastFiling | null {
  if (isCancelNotice(r)) return null; // the notice, not the policy
  const endedDate = isoDate(r.cancl_effective_date);
  if (!endedDate || endedDate > today) return null; // still ahead = pending, handled above
  const reason = String(r.filing_status_reason || '').toUpperCase().trim();
  const f = fromMotus(r);
  return {
    coverage: f.coverage, formCode: f.formCode, insurer: f.insurer, policyNumber: f.policyNumber,
    maxCoverageK: f.maxCoverageK, effectiveDate: f.effectiveDate, endedDate,
    ended: reason === 'TERM/REPL' ? 'replaced' : reason === 'NAMECHG' ? 'name-change' : /CANC/.test(reason) ? 'cancelled' : 'ended',
    source: 'motus',
  };
}

// The old system's history: mod_col_1 says what happened ("Cancelled",
// "Replaced", "Name Changed"), mod_col_3 the coverage, mod_col_5 the limit in
// thousands. A cancellation that was itself cancelled (CANC/CANCL) never took
// effect, so it isn't an ended policy.
function pastFromLegacy(r: any, today: string): PastFiling | null {
  const method = String(r.cancl_method || '').toUpperCase().trim();
  if (method === 'CANC/CANCL' || method === 'DUPLICATE') return null;
  const endedDate = isoDate(r.cancl_effective_date);
  if (!endedDate || endedDate > today) return null;
  const what = String(r.mod_col_1 || '').toLowerCase();
  const kind = String(r.mod_col_3 || '').toUpperCase().trim();
  const cls = String(r.ins_class_code || '').toUpperCase().trim();
  // "BIPD", "BIPD/PRIMARY" and "BIPD/EXCESS" all occur; the class code says
  // primary or excess when the label doesn't.
  const bipd = /^BIPD/.test(kind);
  const limit = bipd ? num(r.mod_col_5) : null;
  return {
    coverage: bipd ? (/PRIMARY/.test(kind) || cls === 'P' ? 'BIPD/Primary' : /EXCESS/.test(kind) || cls === 'E' ? 'BIPD/Excess' : 'BIPD') : kind || 'Unknown',
    formCode: formCodeOf(r.ins_cancl_form || r.ins_form_code),
    insurer: String(r.name_company || '').replace(/\s+/g, ' ').trim(),
    policyNumber: r.policy_no ? String(r.policy_no).trim() : null,
    maxCoverageK: limit && limit > 0 ? limit : null,
    effectiveDate: isoDate(r.effective_date),
    endedDate,
    ended: /name/.test(what) || method === 'NAMECHG' ? 'name-change'
      : /replac/.test(what) || method === 'TERM/REPL' ? 'replaced'
        : method === 'TRANSFER' ? 'transferred'
          : /cancel/.test(what) || /CANC/.test(method) ? 'cancelled' : 'ended',
    source: 'legacy',
  };
}

const HISTORY_LIMIT = 40;
const recentYears = (today: string, n: number) => Array.from({ length: n }, (_, i) => Number(today.slice(0, 4)) - i);
const monthsAgoIso = (today: string, months: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

// Pure: ended policies from either system, one row per policy + coverage +
// end date (both files repeat rows), newest first. Motus carries the old
// history for every company it lists, so the legacy rows are only used when
// Motus has none. Exported for tests.
export function summarizePastFilings(motusRows: any[], legacyRows: any[], today: string = todayIso()): { history: PastFiling[]; cancelled24m: number } {
  let all = (Array.isArray(motusRows) ? motusRows : []).map((r) => pastFromMotus(r, today)).filter((f): f is PastFiling => f != null);
  if (all.length === 0) all = (Array.isArray(legacyRows) ? legacyRows : []).map((r) => pastFromLegacy(r, today)).filter((f): f is PastFiling => f != null);
  const seen = new Set<string>();
  const unique = all
    .sort((a, b) => b.endedDate.localeCompare(a.endedDate) || a.coverage.localeCompare(b.coverage))
    .filter((f) => {
      const key = `${alnum(f.policyNumber) || f.insurer}|${f.coverage}|${f.endedDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  // One cancellation often ends the liability and cargo filing of the same
  // policy on the same day: that's one cancellation, not two.
  const since = monthsAgoIso(today, 24);
  const cancelled = new Set(unique.filter((f) => f.ended === 'cancelled' && f.endedDate >= since).map((f) => `${alnum(f.policyNumber) || f.insurer}|${f.endedDate}`));
  return { history: unique.slice(0, HISTORY_LIMIT), cancelled24m: cancelled.size };
}

// ---------- Ids → dataset filters ----------

function digitsOf(v: unknown): string {
  return String(v ?? '').replace(/[^0-9]/g, '').replace(/^0+/, '');
}

// Legacy dockets are zero-padded to 6 digits ("MC012345"), Motus ones aren't.
function docketForms(mc: string): string[] {
  return Array.from(new Set([`MC${mc}`, `MC${mc.padStart(6, '0')}`]));
}

const inList = (values: string[]) => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');

// ---------- Merging Motus notices into policies ----------

type Cancellation = { policyNumber: string | null; date: string; row: any };

// Applies cancellation notices to the active policies:
//   - notice dated after today → that policy's cancellation is pending;
//   - notice dated today or earlier → the policy is no longer in force;
//   - a policy filed again on/after the notice date is a reinstatement or
//     renewal, so the notice no longer applies to it;
//   - a future notice for a policy that's no longer listed as active still
//     means coverage until that date, so it's listed with the pending date.
function applyCancellations(policies: InsuranceFiling[], cancels: Cancellation[], today: string): InsuranceFiling[] {
  const dropped = new Set<InsuranceFiling>();
  const extra: InsuranceFiling[] = [];
  for (const c of cancels) {
    const matches = policies.filter((f) => c.policyNumber && f.policyNumber && samePolicyNumber(c.policyNumber, f.policyNumber));
    if (matches.length > 0) {
      for (const f of matches) {
        if (f.effectiveDate && f.effectiveDate >= c.date) continue;
        if (c.date > today) {
          if (!f.cancelEffectiveDate || c.date < f.cancelEffectiveDate) f.cancelEffectiveDate = c.date;
        } else {
          dropped.add(f);
        }
      }
    } else if (c.date > today) {
      const already = extra.find((f) => f.policyNumber && c.policyNumber && samePolicyNumber(c.policyNumber, f.policyNumber));
      if (already) {
        if (!already.cancelEffectiveDate || c.date < already.cancelEffectiveDate) already.cancelEffectiveDate = c.date;
        continue;
      }
      const f = fromMotus(c.row);
      // On a BMC-35 notice the "effective date" is the cancellation date itself.
      if (isCancelNotice(c.row)) {
        f.effectiveDate = null;
        f.postedDate = null;
      }
      f.cancelEffectiveDate = c.date;
      extra.push(f);
    }
  }
  return [...policies.filter((f) => !dropped.has(f)), ...extra];
}

// FMCSA lists a policy once per authority it covers (carrier, broker,
// household goods…), so a company with four authorities shows the same
// policy four times. One row per policy, coverage and dates. Exported for tests.
export function dedupeFilings(filings: InsuranceFiling[]): InsuranceFiling[] {
  const seen = new Set<string>();
  return filings.filter((f) => {
    const key = `${alnum(f.policyNumber) || f.insurer.toUpperCase()}|${f.coverage.toUpperCase()}|${f.maxCoverageK ?? ''}|${f.effectiveDate || ''}|${f.cancelEffectiveDate || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Look up filings by MC docket (preferred) or USDOT number.
export async function fetchInsuranceFilings(ids: { mc?: string | null; dot?: string | null }): Promise<InsuranceFilingsResult> {
  const mc = digitsOf(ids.mc);
  const dot = digitsOf(ids.dot);
  if (!mc && !dot) return { filings: [], asOf: null, error: 'No MC or DOT number to look up' };

  const motusWhere = mc ? `docket_number in (${inList(docketForms(mc))})` : `usdot_number = '${dot}'`;
  const legacyWhere = mc ? `docket_number in (${inList(docketForms(mc))})` : `dot_number = '${dot.padStart(8, '0')}'`;
  const today = todayIso();

  try {
    const [active, history, asOf, legacyHistory] = await Promise.all([
      rowsOf(MOTUS_ACTIVE(), new URLSearchParams({ $where: motusWhere, $limit: '100' })),
      rowsOf(MOTUS_HISTORY(), new URLSearchParams({ $where: motusWhere, $order: 'cancl_effective_date DESC', $limit: '200' })),
      datasetUpdatedAt(MOTUS_ACTIVE()),
      // Ended policies from the old system, for companies Motus has no
      // history for. Optional: without it the report just has no past list.
      // Its dates are text (MM/DD/YYYY), so "recent" is asked for by year.
      rowsOf(LEGACY_HISTORY(), new URLSearchParams({ $where: `(${legacyWhere}) AND (${recentYears(today, 6).map((y) => `cancl_effective_date like '%/${y}'`).join(' OR ')})`, $limit: '500' })).catch(() => null),
    ]);
    // Motus has no history for the company and the older file didn't answer:
    // nothing is known about past policies, which is not the same as none.
    const past = history.length === 0 && legacyHistory === null ? {} : summarizePastFilings(history, legacyHistory || [], today);

    if (active.length > 0 || history.length > 0) {
      const policies = active.filter((r) => !isCancelNotice(r)).map(fromMotus);
      const cancels: Cancellation[] = [];
      for (const r of active) {
        const date = isCancelNotice(r) ? isoDate(r.effective_date) : null;
        if (date) cancels.push({ policyNumber: r.policy_no ? String(r.policy_no).trim() : null, date, row: r });
      }
      // Ended-policy rows marked CANCEL with a date still ahead are pending too.
      for (const r of history) {
        const date = isoDate(r.cancl_effective_date);
        if (date && date > today && /^CANCEL/i.test(String(r.filing_status_reason || ''))) {
          cancels.push({ policyNumber: r.policy_no ? String(r.policy_no).trim() : null, date, row: r });
        }
      }
      return { filings: dedupeFilings(applyCancellations(policies, cancels, today)), ...past, asOf };
    }

    // Nothing changed in Motus since the cutover: the legacy snapshot still
    // describes this company. Drop filings whose cancellation has since taken
    // effect (the dataset repeats the effective date as a placeholder on a
    // few rows; those aren't cancellations).
    const legacy = await rowsOf(LEGACY(), new URLSearchParams({ $where: legacyWhere, $limit: '50' }));
    const filings = legacy.map(fromLegacy).filter((f) =>
      !f.cancelEffectiveDate || f.cancelEffectiveDate === f.effectiveDate || f.cancelEffectiveDate > today);
    return { filings: dedupeFilings(filings), ...past, asOf };
  } catch (e: any) {
    return { filings: [], asOf: null, error: e?.name === 'AbortError' ? 'FMCSA insurance data timed out' : e?.message || 'FMCSA insurance data unavailable' };
  }
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

// Keeps the rows whose policy number is the certificate's policy. Takes rows
// from either the Motus or the legacy dataset; cancellation notices aren't
// policies and are skipped. Motus rows come first, and a docket + policy seen
// in Motus isn't repeated from the legacy snapshot.
export function matchPolicyRows(policyNumber: string, rows: any[]): PolicyFilingMatch[] {
  const seen = new Set<string>();
  const out: PolicyFilingMatch[] = [];
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && !isCancelNotice(r) && samePolicyNumber(policyNumber, r.policy_no));
  list.sort((a, b) => Number(isMotusRow(b)) - Number(isMotusRow(a)));
  for (const r of list) {
    // Only MC dockets are motor-carrier numbers; MX/FF dockets aren't looked up by MC.
    const docket = /^\s*MC/i.test(String(r.docket_number || '')) ? digitsOf(r.docket_number) || null : null;
    const dot = digitsOf(r.usdot_number ?? r.dot_number) || null;
    const key = `${docket || ''}|${dot || ''}|${alnum(r.policy_no)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ docket, dot, filing: toFiling(r) });
  }
  return out;
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
  const [motus, legacy] = await Promise.allSettled([rowsOf(MOTUS_ACTIVE(), params), rowsOf(LEGACY(), params)]);
  if (motus.status === 'rejected' && legacy.status === 'rejected') {
    const e: any = motus.reason;
    return { matches: [], error: e?.name === 'AbortError' ? 'FMCSA insurance data timed out' : e?.message || 'FMCSA insurance data unavailable' };
  }
  const rows = [
    ...(motus.status === 'fulfilled' ? motus.value : []),
    ...(legacy.status === 'fulfilled' ? legacy.value : []),
  ];
  return { matches: matchPolicyRows(raw, rows) };
}
