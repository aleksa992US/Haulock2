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
  // Motus names the ordinary authority "… of Property (Except Household
  // Goods)": that is property, not household goods.
  const hhg = /HOUSEHOLD/.test(s) && !/EXCEPT HOUSEHOLD/.test(s);
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

// "May 7, 2026", for sentences shown on the report.
function longDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
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

// ---------- The timeline: every authority action on record ----------

export type AuthorityEventKind =
  | 'granted' | 'reinstated'        // authority starts or comes back
  | 'suspended' | 'revoked'         // authority lost
  | 'voluntary'                     // paused at the company's own request
  | 'notice'                        // revocation notice that was dropped
  | 'application' | 'withdrawn'     // an application, not an authority
  | 'ended'                         // transferred, expired, superseded…
  | 'correction';                   // FMCSA's own administrative change

export type AuthorityEvent = {
  date: string;                     // YYYY-MM-DD
  authority: string;                // "Carrier", "Broker", …
  kind: AuthorityEventKind;
  text: string;                     // plain words for the report
  detail?: string;
  bad?: boolean;                    // FMCSA took the authority away
  corrected?: boolean;              // …and later reversed that as its own error
  source: 'motus' | 'older';
};

const AUTHORITY_LABEL: Record<Category, string> = {
  'property-carrier': 'Carrier',
  'property-broker': 'Broker',
  'hhg-carrier': 'Household goods carrier',
  'hhg-broker': 'Household goods broker',
  passenger: 'Passenger carrier',
  forwarder: 'Freight forwarder',
  other: 'Authority',
};

type Classified = { kind: AuthorityEventKind; text: string; detail?: string; bad?: boolean; fmcsaFix?: boolean; fixOf?: string };

// Motus writes a free-text reason for each status change. The status column
// isn't reliable for history carried over from the old system (it can hold
// today's status), so the reason decides what happened.
function classifyMotus(reasonRaw: unknown, statusRaw: unknown): Classified {
  const reason = String(reasonRaw ?? '').replace(/\s+/g, ' ').trim();
  const R = reason.toLowerCase();
  const status = String(statusRaw ?? '').trim();
  if (!reason || R === 'undefined') return { kind: 'correction', text: status ? `Recorded as ${status.toLowerCase()}` : 'Status change recorded' };
  if (/motus issue|consolidation corrected|suspension of .* reversed/.test(R)) {
    return { kind: 'correction', text: 'Reinstated: FMCSA reversed a suspension that was its own error', fmcsaFix: true, fixOf: R.match(/suspension of (\d{4}-\d{2}-\d{2})/)?.[1] };
  }
  // "Withdrawn by <someone's email>": the address is never shown.
  if (/^withdrawn/.test(R)) return { kind: 'withdrawn', text: 'Application withdrawn' };
  if (/^granted$/.test(R)) return { kind: 'granted', text: 'Authority granted' };
  if (/^reinstated/.test(R)) return { kind: 'reinstated', text: 'Authority reinstated', detail: /insurance coverage restored/.test(R) ? 'Insurance was filed again' : undefined };
  if (/^involuntary suspension|^inactivated/.test(R)) {
    const insurance = /insurance/.test(R);
    const agent = /boc-3/.test(R);
    return {
      kind: 'suspended', bad: true, text: 'Authority suspended by FMCSA',
      detail: insurance && agent ? 'Insurance and the process agent (BOC-3) filing were both cancelled'
        : agent ? 'The process agent (BOC-3) filing was cancelled and no other was on file'
          : insurance ? 'Insurance was cancelled and no other policy meeting the minimum was on file'
            : undefined,
    };
  }
  if (/^out of service/.test(R)) return { kind: 'suspended', bad: true, text: 'Placed out of service' };
  if (/bond\/trust fund below minimum/.test(R)) return { kind: 'suspended', bad: true, text: 'Authority suspended by FMCSA', detail: 'The broker bond or trust fund fell below the $75,000 minimum' };
  if (/^revoked$/.test(R)) return { kind: 'revoked', text: 'Authority revoked' };
  if (/^voluntary suspension/.test(R)) return { kind: 'voluntary', text: 'Authority paused at the company’s own request' };
  if (/^discontinued revocation/.test(R)) return { kind: 'notice', text: 'Revocation notice dropped', detail: 'The missing filing arrived in time' };
  if (/^dismissed/.test(R)) return { kind: 'application', text: 'Application dismissed' };
  if (/^initial status/.test(R)) return { kind: 'application', text: 'Application received' };
  if (/published to fmcsa register/.test(R)) return { kind: 'application', text: 'Application published in the FMCSA Register' };
  if (/administrative|renumbered/.test(R)) return { kind: 'correction', text: 'Administrative change by FMCSA' };
  if (/transferred/.test(R)) return { kind: 'ended', text: 'Authority transferred' };
  if (/eta expired/.test(R)) return { kind: 'ended', text: 'Emergency temporary authority expired' };
  // Anything unforeseen: FMCSA's words, minus any email address.
  const safe = reason.replace(/\S+@\S+/g, '').replace(/\s+/g, ' ').trim();
  return { kind: 'correction', text: safe ? safe[0].toUpperCase() + safe.slice(1).toLowerCase() : 'Status change recorded' };
}

// How an authority ended in the old system (disp_action_desc).
function classifyLegacyEnd(disp: string): Classified {
  const D = disp.toUpperCase();
  if (D === 'REVOKED') return { kind: 'revoked', text: 'Authority revoked' };
  if (D === 'SAFETY SUSPENSION') return { kind: 'suspended', bad: true, text: 'Authority suspended by FMCSA', detail: 'Safety suspension' };
  if (D === 'OUT OF SERVICE') return { kind: 'suspended', bad: true, text: 'Placed out of service' };
  if (/TRANSFER/.test(D)) return { kind: 'ended', text: 'Authority transferred' };
  if (D === 'FAILURE TO REAPPLY') return { kind: 'ended', text: 'Authority ended', detail: 'The company didn’t reapply' };
  if (/EXPIRED/.test(D)) return { kind: 'ended', text: 'Temporary authority expired' };
  if (D === 'ADMINISTRATIVE INACTIVATION') return { kind: 'ended', text: 'Authority made inactive by FMCSA', detail: 'Administrative inactivation' };
  return { kind: 'correction', text: 'Administrative change by FMCSA' };
}

const LAPSE_WINDOW_DAYS = 730;

// Pure: every authority action on record, newest first, plus two counts for
// the last 24 months:
//   lapses24m  times FMCSA took the authority away (one per period without
//              authority, so a suspension followed by a revocation is one;
//              suspensions FMCSA later reversed as its own error don't count)
//   notices24m revocation notices that were dropped because the missing
//              filing arrived in time
export function buildAuthorityEvents(
  legacyRows: Array<Record<string, any>>,
  motusRows: Array<Record<string, any>>,
  now: number = Date.now(),
): { events: AuthorityEvent[]; lapses24m: number; notices24m: number } {
  type Raw = AuthorityEvent & { at: number; fmcsaFix?: boolean; fixOf?: string };
  const raw: Raw[] = [];
  const add = (at: number | null, category: Category, c: Classified, source: AuthorityEvent['source']) => {
    if (at == null) return;
    raw.push({ at, date: isoDay(at), authority: AUTHORITY_LABEL[category], kind: c.kind, text: c.text, detail: c.detail, bad: c.bad, source, fmcsaFix: c.fmcsaFix, fixOf: c.fixOf });
  };

  const droppedOn = new Set<string>(); // "<authority>|<date>" of notices the old system already lists
  for (const r of legacyRows) {
    const action = String(r.original_action_desc || '').toUpperCase().trim();
    const category = categoryOf(r.mod_col_1);
    const start = parseFmcsaDate(r.orig_served_date);
    const disp = String(r.disp_action_desc || '').trim();
    const end = disp ? parseFmcsaDate(r.disp_served_date) ?? parseFmcsaDate(r.disp_decided_date) : null;
    if (action === 'GRANTED' || action === 'REINSTATED') {
      add(start, category, action === 'GRANTED' ? { kind: 'granted', text: 'Authority granted' } : { kind: 'reinstated', text: 'Authority reinstated' }, 'older');
      if (disp) add(end ?? start, category, classifyLegacyEnd(disp), 'older');
    } else if (action === 'INVOLUNTARY REVOCATION') {
      // A proceeding, not an authority. One that ended in REVOKED is already
      // on the grant row; one that was dropped is a warning the company met.
      if (/^DISCONTINUED/i.test(disp)) {
        add(start, category, { kind: 'notice', text: 'Revocation notice served', detail: end ? `Dropped on ${longDay(end)}: the missing filing arrived in time` : 'Later dropped' }, 'older');
        if (end != null) droppedOn.add(`${AUTHORITY_LABEL[category]}|${isoDay(end)}`);
      } else if (!disp) {
        add(start, category, { kind: 'notice', text: 'Revocation notice served' }, 'older');
      }
    } else if (action === 'DISMISSED') add(start, category, { kind: 'application', text: 'Application dismissed' }, 'older');
    else if (action === 'WITHDRAWN' || action === 'CANCELLED') add(start, category, { kind: 'withdrawn', text: 'Application withdrawn' }, 'older');
    else if (action === 'DENIED' || action === 'REJECTED') add(start, category, { kind: 'application', text: `Application ${action.toLowerCase()} by FMCSA` }, 'older');
  }
  for (const r of motusRows) {
    const at = parseFmcsaDate(r.status_change_date);
    const category = categoryOf(r.op_auth_type);
    const c = classifyMotus(r.reason, r.op_auth_status);
    if (c.kind === 'notice' && at != null && droppedOn.has(`${AUTHORITY_LABEL[category]}|${isoDay(at)}`)) continue;
    add(at, category, c, 'motus');
  }

  // The same action is often in both systems, and Motus repeats rows. Keep
  // one per day, authority and kind; the Motus copy carries the reason.
  const byKey = new Map<string, Raw>();
  for (const e of raw.sort((a, b) => a.at - b.at || (a.source === 'motus' ? -1 : 1))) {
    const key = `${e.date}|${e.authority}|${e.kind}`;
    const had = byKey.get(key);
    if (!had || (!had.detail && e.detail)) byKey.set(key, had ? { ...had, detail: e.detail, text: e.text } : e);
  }
  const list = [...byKey.values()].sort((a, b) => a.at - b.at);

  // Periods without authority that FMCSA imposed, per authority.
  const open = new Map<string, Raw>();
  const lastLapse = new Map<string, Raw>();
  const lapses: Raw[] = [];
  for (const e of list) {
    if (e.kind === 'suspended' && e.bad) {
      if (!open.has(e.authority)) { open.set(e.authority, e); lastLapse.set(e.authority, e); lapses.push(e); }
    } else if (e.fmcsaFix) {
      // FMCSA says the suspension was its mistake: the one it names, else the
      // one this reinstatement ends (or the latest before it).
      const named = e.fixOf ? list.find((x) => x.authority === e.authority && x.kind === 'suspended' && x.date === e.fixOf) : undefined;
      const target = named || open.get(e.authority) || lastLapse.get(e.authority);
      if (target) {
        for (const x of list) if (x.authority === e.authority && x.kind === 'suspended' && x.at >= target.at && x.at <= e.at) x.corrected = true;
        target.corrected = true;
      }
      open.delete(e.authority);
    } else if (e.kind === 'granted' || e.kind === 'reinstated') {
      open.delete(e.authority);
    }
  }
  const since = now - LAPSE_WINDOW_DAYS * DAY_MS;
  // A company can hold several authorities (carrier, broker, household
  // goods…), and one cancelled filing suspends all of them within days.
  // That is one occasion, not one per authority.
  let lapseOccasions = 0;
  let occasionStart = -Infinity;
  for (const e of lapses.filter((x) => !x.corrected && x.at >= since && x.at <= now).sort((a, b) => a.at - b.at)) {
    if (e.at - occasionStart > 7 * DAY_MS) { lapseOccasions += 1; occasionStart = e.at; }
  }
  const events: AuthorityEvent[] = list
    .sort((a, b) => b.at - a.at)
    .slice(0, 80)
    .map(({ at: _at, fmcsaFix: _f, fixOf: _x, ...e }) => {
      const out: AuthorityEvent = { ...e };
      if (!out.detail) delete out.detail;
      if (!out.bad) delete out.bad;
      if (!out.corrected) delete out.corrected;
      return out;
    });
  return {
    events,
    lapses24m: lapseOccasions,
    notices24m: list.filter((e) => e.kind === 'notice' && e.source === 'older' && e.at >= since && e.at <= now).length
      + list.filter((e) => e.kind === 'notice' && e.source === 'motus' && e.at >= since && e.at <= now).length,
  };
}

// Pure: turns raw dataset rows into the summary. Exported for tests.
export function summarizeAuthorityHistory(
  legacyRows: Array<Record<string, any>>,
  motusRows: Array<Record<string, any>>,
  now: number = Date.now(),
): AuthorityHistory {
  const timeline = buildAuthorityEvents(legacyRows, motusRows, now);
  const withTimeline = (h: AuthorityHistory): AuthorityHistory => (timeline.events.length ? { ...h, ...timeline } : h);
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

  if (intervals.length === 0) return withTimeline({ checked: true });

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
  return withTimeline(out);
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
    // Motus didn't answer: ask once more before going without it.
    let motusRows: Array<Record<string, any>> | null = motus.status === 'fulfilled' ? motus.value : null;
    if (!motusRows) {
      try { motusRows = await socrata(MOTUS_DATASET(), motusWhere); } catch { motusRows = null; }
    }
    if (!motusRows && legacy.value.length === 0) {
      return { checked: false, error: 'Authority history unavailable (Motus dataset did not respond)' };
    }
    const summary = summarizeAuthorityHistory(legacy.value, motusRows || []);
    if (!motusRows) {
      // The older system's history still gives the authority's age, but
      // everything since May 2026 is missing. Say so: no count of
      // suspensions is claimed from half the record.
      const { lapses24m: _lapses, notices24m: _notices, ...rest } = summary;
      return { ...rest, incomplete: true };
    }
    return summary;
  })();

  inflight.set(key, p);
  try {
    const value = await p;
    // A partial answer is never kept: the next scan asks FMCSA again.
    if (value.checked && !value.incomplete) cache.set(key, { at: Date.now(), value });
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
