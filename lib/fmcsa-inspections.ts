// Roadside inspections and crashes, one row per event, from FMCSA's public
// files on data.transportation.gov (refreshed daily):
//   Vehicle Inspection File (fx4q-ay7w)            — each inspection
//   Vehicle Inspections and Violations (876r-jsdb) — what each violation was
//   Crash File (aayw-vxb3)                         — each reportable crash
// QCMobile and SMS only give 24-month totals. These say when and where, and
// let own-company monitoring email the owner about each new event.

const BASE = 'https://data.transportation.gov/resource';
const INSPECTIONS = process.env.FMCSA_INSPECTIONS_DATASET_ID || 'fx4q-ay7w';
const VIOLATIONS = process.env.FMCSA_VIOLATIONS_DATASET_ID || '876r-jsdb';
const CRASHES = process.env.FMCSA_CRASH_DATASET_ID || 'aayw-vxb3';
const TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_INSPECTIONS = 4000;
const DETAILED = 12; // most recent inspections with violations we list the violations for

export type ViolationDetail = { code: string; desc: string; oos: boolean; unit: 'driver' | 'vehicle' | 'other' };

export type InspectionEvent = {
  id: string;
  date: string;          // YYYY-MM-DD
  state: string;
  location: string;
  level: number | null;
  levelLabel: string;
  violations: number;
  oos: number;           // out-of-service violations (any)
  driverOos: number;
  vehicleOos: number;
  hazmatOos: number;
  postCrash: boolean;
  details?: ViolationDetail[];
};

export type CrashEvent = {
  id: string;
  date: string;          // YYYY-MM-DD
  state: string;
  city: string;
  location: string;
  fatalities: number;
  injuries: number;
  towAway: boolean;
};

export type SafetyActivity = {
  dot: string;
  months: number;
  since: string;         // YYYY-MM-DD
  fetchedAt: string;
  inspections: {
    total: number;
    clean: number;           // no violations
    withViolations: number;  // violations, none out of service
    oos: number;             // at least one out-of-service violation
    driverOos: number;
    vehicleOos: number;
    truncated: boolean;
    last: InspectionEvent | null;
    recent: InspectionEvent[];
  };
  crashes: {
    total: number;
    fatal: number;
    injury: number;
    towAway: number;
    fatalities: number;
    injuries: number;
    last: CrashEvent | null;
    recent: CrashEvent[];
  };
  byMonth: { month: string; clean: number; violations: number; oos: number; crashes: number }[];
};

const LEVELS: Record<number, string> = {
  1: 'Level I · full inspection',
  2: 'Level II · walk-around',
  3: 'Level III · driver only',
  4: 'Level IV · special study',
  5: 'Level V · vehicle only',
  6: 'Level VI · radioactive load',
  7: 'Level VII · state program',
  8: 'Level VIII · electronic',
};

const cache = new Map<string, { at: number; value: SafetyActivity }>();

function normDot(dot: string | number | null | undefined): string {
  return String(dot ?? '').replace(/\D/g, '').replace(/^0+/, '');
}
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const iso = (v: unknown) => {
  const m = String(v ?? '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
const title = (s: unknown) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t === t.toUpperCase() ? t.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()) : t;
};

async function socrata(dataset: string, params: Record<string, string>): Promise<any[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${dataset}.json?${new URLSearchParams(params).toString()}`, { headers, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`${dataset} ${res.status}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } finally {
    clearTimeout(timer);
  }
}

function toInspection(r: any): InspectionEvent {
  const level = num(r.insp_level_id) || null;
  return {
    id: String(r.inspection_id),
    date: iso(r.insp_date),
    state: String(r.report_state || ''),
    location: title(r.location_desc),
    level,
    levelLabel: level ? LEVELS[level] || `Level ${level}` : 'Inspection',
    violations: num(r.viol_total),
    oos: num(r.oos_total),
    driverOos: num(r.driver_oos_total),
    vehicleOos: num(r.vehicle_oos_total),
    hazmatOos: num(r.hazmat_oos_total),
    postCrash: r.post_acc_ind === 'Y',
  };
}

function toCrash(r: any): CrashEvent {
  return {
    id: String(r.crash_id || r.report_number),
    date: iso(r.report_date),
    state: String(r.report_state || ''),
    city: title(r.city),
    location: title(r.location),
    fatalities: num(r.fatalities),
    injuries: num(r.injuries),
    towAway: r.tow_away === 'Y',
  };
}

async function fetchInspections(dot: string, since: string, limit: number): Promise<any[]> {
  return socrata(INSPECTIONS, {
    $where: `dot_number='${dot}' AND insp_date>='${since}'`,
    $order: 'insp_date DESC',
    $limit: String(limit),
    $select: 'inspection_id,insp_date,report_state,location_desc,insp_level_id,viol_total,oos_total,driver_oos_total,vehicle_oos_total,hazmat_oos_total,post_acc_ind',
  });
}

async function fetchCrashes(dot: string, since: string): Promise<any[]> {
  return socrata(CRASHES, {
    $where: `dot_number='${dot}' AND report_date>='${since}'`,
    $order: 'report_date DESC',
    $limit: '1000',
    $select: 'crash_id,report_number,report_date,report_state,city,location,fatalities,injuries,tow_away',
  });
}

// Violation lines for the given inspections, grouped by inspection id.
async function fetchViolations(ids: string[]): Promise<Map<string, ViolationDetail[]>> {
  const out = new Map<string, ViolationDetail[]>();
  const clean = ids.filter((id) => /^\d+$/.test(id));
  if (!clean.length) return out;
  const rows = await socrata(VIOLATIONS, {
    $where: `inspection_id in (${clean.map((id) => `'${id}'`).join(',')})`,
    $limit: '1000',
    $select: 'inspection_id,viol_code,viol_desc,out_of_service_indicator,insp_viol_unit',
  });
  for (const r of rows) {
    const id = String(r.inspection_id);
    const unit = String(r.insp_viol_unit || '');
    const list = out.get(id) || [];
    list.push({
      code: String(r.viol_code || ''),
      desc: String(r.viol_desc || '').trim(),
      oos: r.out_of_service_indicator === 'Y',
      unit: unit === 'D' ? 'driver' : /^\d+$/.test(unit) ? 'vehicle' : 'other',
    });
    out.set(id, list);
  }
  for (const list of Array.from(out.values())) list.sort((a, b) => Number(b.oos) - Number(a.oos));
  return out;
}

async function attachDetails(events: InspectionEvent[]): Promise<void> {
  const want = events.filter((e) => e.violations > 0).slice(0, DETAILED);
  if (!want.length) return;
  try {
    const details = await fetchViolations(want.map((e) => e.id));
    for (const e of want) e.details = details.get(e.id) || [];
  } catch { /* the list still shows counts */ }
}

export async function fetchSafetyActivity(dotIn: string | number, months = 24): Promise<SafetyActivity | null> {
  const dot = normDot(dotIn);
  if (!dot) return null;
  const key = `${dot}:${months}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - months);
  start.setUTCDate(1);
  const since = ymd(start);
  const [insRows, crashRows] = await Promise.all([fetchInspections(dot, since, MAX_INSPECTIONS), fetchCrashes(dot, since)]);

  const inspections = insRows.map(toInspection).filter((e) => e.date);
  const crashes = crashRows.map(toCrash).filter((e) => e.date);
  const recent = inspections.slice(0, 25);
  await attachDetails(recent);

  // Month buckets, oldest first.
  const byMonth: SafetyActivity['byMonth'] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const now = new Date();
  while (cursor <= now) {
    byMonth.push({ month: cursor.toISOString().slice(0, 7), clean: 0, violations: 0, oos: 0, crashes: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const bucket = (date: string) => byMonth.find((b) => b.month === date.slice(0, 7));
  let clean = 0, withViolations = 0, oos = 0, driverOos = 0, vehicleOos = 0;
  for (const e of inspections) {
    const b = bucket(e.date);
    if (e.oos > 0) { oos++; if (b) b.oos++; }
    else if (e.violations > 0) { withViolations++; if (b) b.violations++; }
    else { clean++; if (b) b.clean++; }
    if (e.driverOos > 0) driverOos++;
    if (e.vehicleOos > 0) vehicleOos++;
  }
  for (const c of crashes) { const b = bucket(c.date); if (b) b.crashes++; }

  const value: SafetyActivity = {
    dot, months, since: iso(since), fetchedAt: new Date().toISOString(),
    inspections: {
      total: inspections.length, clean, withViolations, oos, driverOos, vehicleOos,
      truncated: insRows.length >= MAX_INSPECTIONS,
      last: inspections[0] || null,
      recent,
    },
    crashes: {
      total: crashes.length,
      fatal: crashes.filter((c) => c.fatalities > 0).length,
      injury: crashes.filter((c) => c.injuries > 0).length,
      towAway: crashes.filter((c) => c.towAway).length,
      fatalities: crashes.reduce((s, c) => s + c.fatalities, 0),
      injuries: crashes.reduce((s, c) => s + c.injuries, 0),
      last: crashes[0] || null,
      recent: crashes.slice(0, 15),
    },
    byMonth,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Inspections and crashes filed in the last `days` days, for the daily
// own-company check. FMCSA files events days or weeks after they happen,
// so the caller tracks which ids it has already reported.
export async function fetchRecentSafetyEvents(dotIn: string | number, days = 90): Promise<{ inspections: InspectionEvent[]; crashes: CrashEvent[] } | null> {
  const dot = normDot(dotIn);
  if (!dot) return null;
  const since = ymd(new Date(Date.now() - days * 86400000));
  const [insRows, crashRows] = await Promise.all([fetchInspections(dot, since, 300), fetchCrashes(dot, since)]);
  const inspections = insRows.map(toInspection).filter((e) => e.date);
  const crashes = crashRows.map(toCrash).filter((e) => e.date);
  return { inspections, crashes };
}

export { attachDetails as attachViolationDetails };
