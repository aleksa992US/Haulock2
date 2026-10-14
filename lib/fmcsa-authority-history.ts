// Operating-authority history from FMCSA's public datasets on
// data.transportation.gov. QCMobile returns current authority statuses but
// no grant date, so this is where "authority age" and "reactivated after a
// long gap" come from.
//
//   AuthHist - All With History (9mw4-x3tu) — legacy L&I history. One row
//     per authority action: original_action_desc (GRANTED, REINSTATED,
//     INVOLUNTARY REVOCATION, ...), orig_served_date (MM/DD/YYYY),
//     disp_action_desc (REVOKED, DISCONTINUED REVOCATION, ...),
//     disp_served_date / disp_decided_date, mod_col_1 (authority type).
//     dot_number is zero-padded to 8 digits. It has no grants after May
//     2026, when FMCSA moved registration to Motus.
//   Motus AuthHist - All With History (yu5v-wbh6) — status changes in the
//     Motus system: op_auth_type, op_auth_status (Active / Inactive /
//     Pending / Withdrawn), reason, status_change_date (YYYYMMDD).
//     usdot_number is not padded.
//
// Both are public; SOCRATA_APP_TOKEN (optional) raises the rate limit.
// Override the dataset ids with FMCSA_AUTHHIST_DATASET_ID /
// FMCSA_MOTUS_AUTHHIST_DATASET_ID.

import type { CarrierReport } from './fmcsa';

type AuthorityHistory = NonNullable<CarrierReport['authorityHistory']>;

const BASE = 'https://data.transportation.gov/resource';
const LEGACY_DATASET = () => process.env.FMCSA_AUTHHIST_DATASET_ID || '9mw4-x3tu';
const MOTUS_DATASET = () => process.env.FMCSA_MOTUS_AUTHHIST_DATASET_ID || 'yu5v-wbh6';

// A gap of at least this long with no active authority, followed by a new
// grant or reinstatement, counts as "reactivated". Short gaps (an insurance
// lapse fixed within weeks) are routine and don't count.
export const DORMANT_GAP_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // datasets refresh daily
const cache = new Map<string, { at: number; value: AuthorityHistory }>();
const inflight = new Map<string, Promise<AuthorityHistory>>();

type Category = 'property-carrier' | 'property-broker' | 'hhg-carrier' | 'hhg-broker' | 'passenger' | 'forwarder' | 'other';
type Interval = { start: number; end: number | null; category: Category; granted: boolean };

function categoryOf(label: string | undefined): Category {
  const s = String(label || '').toUpperCase();
  const hhg = /HOUSEHOLD/.test(s);
  if (/BROKER/.test(s)) return hhg ? 'hhg-broker' : 'property-broker';
  if (/FORWARDER/.test(s)) return 'forwarder';
  if (/PASSENGER/.test(s)) return 'passenger';
  if (hhg) return 'hhg-carrier';
  if (/PROPERTY|COMMON|CONTRACT/.test(s)) return 'property-carrier';
  return 'other';
}

// "MM/DD/YYYY" (legacy) or "YYYYMMDD" (Motus) → epoch ms (UTC midnight).
export function parseFmcsaDate(v: unknown): number | null {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return null;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function monthsBetween(from: number, to: number): number {
  return Math.max(0, Math.round((to - from) / (DAY_MS * 30.44)));
}

export function humanMonths(months: number): string {
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}y ${rem}m` : `${years} year${years === 1 ? '' : 's'}`;
}

// Pure: turns raw dataset rows into the summary. Exported for tests.
export function summarizeAuthorityHistory(
  legacyRows: Array<Record<string, any>>,
  motusRows: Array<Record<string, any>>,
  now: number = Date.now(),
): AuthorityHistory {
  const intervals: Interval[] = [];

  // Legacy: each GRANTED / REINSTATED row is an authority that started on
  // orig_served_date and, if it has a disposition, ended on that date.
  // (INVOLUNTARY REVOCATION rows are proceedings, not authorities; when one
  // ends in REVOKED the matching grant row carries the REVOKED disposition.)
  for (const r of legacyRows) {
    const action = String(r.original_action_desc || '').toUpperCase();
    if (action !== 'GRANTED' && action !== 'REINSTATED') continue;
    const start = parseFmcsaDate(r.orig_served_date);
    if (start == null) continue;
    let end: number | null = null;
    if (r.disp_action_desc) {
      end = parseFmcsaDate(r.disp_served_date) ?? parseFmcsaDate(r.disp_decided_date) ?? start;
    }
    intervals.push({ start, end, category: categoryOf(r.mod_col_1), granted: action === 'GRANTED' });
  }

  // Motus: status changes after the cutover. Active opens an authority of
  // that type (unless one is already open), Inactive / Withdrawn closes it.
  const motus = motusRows
    .map((r) => ({ at: parseFmcsaDate(r.status_change_date), status: String(r.op_auth_status || '').toLowerCase(), reason: String(r.reason || ''), category: categoryOf(r.op_auth_type) }))
    .filter((e): e is { at: number; status: string; reason: string; category: Category } => e.at != null)
    .sort((a, b) => a.at - b.at);
  for (const e of motus) {
    const open = intervals.filter((iv) => iv.category === e.category && iv.start <= e.at && (iv.end == null || iv.end >= e.at));
    if (e.status === 'active') {
      if (!intervals.some((iv) => iv.category === e.category && iv.end == null) && open.length === 0) {
        intervals.push({ start: e.at, end: null, category: e.category, granted: /^granted$/i.test(e.reason.trim()) });
      }
    } else if (e.status === 'inactive' || e.status === 'withdrawn') {
      for (const iv of intervals) {
        if (iv.category === e.category && iv.end == null && iv.start <= e.at) iv.end = e.at;
      }
    }
  }

  if (intervals.length === 0) return { checked: true };

  // Earliest grant on record. Some old records only show REINSTATED rows
  // (the original grant predates the dataset), so fall back to the earliest
  // start of any kind — that can only make the age longer, never shorter.
  const grants = intervals.filter((iv) => iv.granted);
  const first = Math.min(...(grants.length ? grants : intervals).map((iv) => iv.start));

  // Union of all authority periods, to find the current unbroken period
  // and the gap (if any) before it.
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number | null }> = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && (last.end == null || iv.start <= last.end)) {
      if (last.end != null && (iv.end == null || iv.end > last.end)) last.end = iv.end;
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }

  const out: AuthorityHistory = {
    checked: true,
    firstGrantDate: isoDay(first),
    ageMonths: monthsBetween(first, now),
  };
  const current = merged[merged.length - 1];
  if (current && current.end == null) {
    out.activeSince = isoDay(current.start);
    const prev = merged.length > 1 ? merged[merged.length - 2] : null;
    if (prev && prev.end != null) {
      const gapDays = Math.round((current.start - prev.end) / DAY_MS);
      if (gapDays >= DORMANT_GAP_DAYS) {
        out.reactivatedDate = isoDay(current.start);
        out.dormantMonths = monthsBetween(prev.end, current.start);
      }
    }
  }
  return out;
}

async function socrata(dataset: string, where: string): Promise<Array<Record<string, any>>> {
  const params = new URLSearchParams({ $where: where, $limit: '1000' });
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${BASE}/${dataset}.json?${params.toString()}`, { headers, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Socrata ${res.status}`);
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } finally {
    clearTimeout(timeout);
  }
}

const digits = (v: string | undefined) => (v || '').replace(/\D/g, '').replace(/^0+/, '');
const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;

export async function fetchAuthorityHistory(ids: { dot?: string; mc?: string }): Promise<AuthorityHistory | null> {
  const dot = digits(ids.dot);
  const mc = digits(ids.mc);
  if (!dot && !mc) return null;
  const key = dot ? `dot:${dot}` : `mc:${mc}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async (): Promise<AuthorityHistory> => {
    const dockets = mc ? [`MC${mc.padStart(6, '0')}`, `MC${mc}`] : [];
    const legacyWhere = dot ? `dot_number=${quote(dot.padStart(8, '0'))}` : `docket_number in (${dockets.map(quote).join(',')})`;
    const motusWhere = dot ? `usdot_number=${quote(dot)}` : `docket_number in (${dockets.map(quote).join(',')})`;
    const [legacy, motus] = await Promise.allSettled([
      socrata(LEGACY_DATASET(), legacyWhere),
      socrata(MOTUS_DATASET(), motusWhere),
    ]);
    // The legacy dataset holds the long history; without it a Motus-only
    // view can make an old authority look new, so treat that as unchecked.
    // Without Motus we'd miss grants since May 2026, so an empty legacy
    // result plus a failed Motus call is also unchecked.
    if (legacy.status === 'rejected') {
      return { checked: false, error: `Authority history unavailable (${legacy.reason instanceof Error ? legacy.reason.message : 'error'})` };
    }
    if (motus.status === 'rejected' && legacy.value.length === 0) {
      return { checked: false, error: 'Authority history unavailable (Motus dataset did not respond)' };
    }
    return summarizeAuthorityHistory(legacy.value, motus.status === 'fulfilled' ? motus.value : []);
  })();

  inflight.set(key, p);
  try {
    const value = await p;
    if (value.checked) cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    return { checked: false, error: err instanceof Error ? err.message : 'Authority history unavailable' };
  } finally {
    inflight.delete(key);
  }
}

// "Recent" reactivation = the current authority period began within the
// last 12 months after a long gap. Older reactivations are history, not a
// live signal.
export function isRecentReactivation(h: AuthorityHistory | undefined, now: number = Date.now()): boolean {
  if (!h?.reactivatedDate) return false;
  const at = parseFmcsaDate(h.reactivatedDate);
  return at != null && now - at <= 365 * DAY_MS;
}

// Report label, e.g. "8y 1m" or "6 years · reactivated 3 months ago".
export function authorityAgeLabel(h: AuthorityHistory, now: number = Date.now()): string | undefined {
  if (!h.checked || h.ageMonths == null) return undefined;
  const age = humanMonths(h.ageMonths);
  if (isRecentReactivation(h, now)) {
    const since = monthsBetween(parseFmcsaDate(h.reactivatedDate)!, now);
    return `${age} · reactivated ${since === 0 ? 'this month' : `${humanMonths(since)} ago`}`;
  }
  return age;
}

// Adds authorityHistory / authorityGrantDate / authorityAge to a live FMCSA
// report. Never throws; returns a new object so callers holding the
// original (e.g. the snapshot recorder) are unaffected.
export async function withAuthorityHistory(c: CarrierReport): Promise<CarrierReport> {
  if (c.source !== 'fmcsa' || (!c.dot && !c.mc) || c.authorityHistory) return c;
  try {
    const h = await fetchAuthorityHistory({ dot: c.dot, mc: c.dot ? undefined : c.mc });
    if (!h) return c;
    return {
      ...c,
      authorityHistory: h,
      authorityGrantDate: h.firstGrantDate ?? c.authorityGrantDate,
      authorityAge: authorityAgeLabel(h) ?? c.authorityAge,
    };
  } catch {
    return c;
  }
}
