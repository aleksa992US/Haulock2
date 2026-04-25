// FMCSA Safety Measurement System (SMS) integration.
//
// SMS = the safety side of FMCSA, separate from QCMobile (the registry
// API). SMS publishes BASIC scores (5 safety categories), 24-month
// inspection counts + OOS rates, and a crash breakdown by severity. It's
// HTML-only — no API — so we fetch the public Overview page and parse
// it. Public-record `.gov` data; consuming it is unambiguous.
//
// Page URL pattern: ai.fmcsa.dot.gov/SMS/Carrier/{DOT}/Overview.aspx
//
// The parser is intentionally defensive — uses anchored regex on text
// labels rather than DOM selectors. SMS markup changes occasionally; we'd
// rather extract the fields we recognize and leave the rest empty than
// crash on the whole panel.

export type SmsBasic = {
  // FMCSA's measure score (lower = better; 0 means no data; can exceed 100).
  measure: number;
  // Number of inspections that fed this score over the last 24 months.
  inspections: number;
  // True when FMCSA's published "alert" threshold is exceeded for this
  // category. The thresholds vary by category; we detect them either from
  // an "Alert" indicator on the page or by comparing measure to threshold.
  alert: boolean;
};

export type SmsInspections = {
  vehicleInspections: number;
  driverInspections: number;
  vehicleOosCount: number;
  driverOosCount: number;
  vehicleOosPct: number | null;     // 0-100
  driverOosPct: number | null;
  vehicleNationalAvgPct: number | null;
  driverNationalAvgPct: number | null;
};

export type SmsCrashes = {
  total: number;
  fatal: number;
  injury: number;
  towaway: number;
};

export type SmsCarrierOverview = {
  legalName?: string;
  totalTrucks?: number;
  totalDrivers?: number;
  hazmatCarrier?: boolean;
  carrierOperation?: string;     // "Interstate" / "Intrastate Hazmat" / etc.
  cargoHauled?: string;          // "General Freight" / "Building Materials" / etc.
  mcs150Date?: string;
  mcs150MileageYear?: string;
  mcs150Mileage?: number;
};

export type SmsData = {
  configured: boolean;       // always true unless intentionally disabled
  fetched: boolean;          // false if fetch failed
  dot: string;
  carrier: SmsCarrierOverview;
  basics: {
    unsafeDriving?: SmsBasic;
    hoursOfService?: SmsBasic;
    driverFitness?: SmsBasic;
    controlledSubstances?: SmsBasic;
    vehicleMaintenance?: SmsBasic;
    hazmat?: SmsBasic;
    crashIndicator?: SmsBasic;
  };
  inspections: SmsInspections | null;
  crashes: SmsCrashes | null;
  lastUpdate?: string;       // free-form date string from the page
  lastSafetyMeasurementDate?: string;
  fetchedAt: string;
  error?: string;
};

const SMS_BASE = 'https://ai.fmcsa.dot.gov/SMS/Carrier';

// 7-day cache TTL — SMS data updates monthly per FMCSA; weekly recompute
// keeps us fresh without hammering their servers.
const SMS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Cache namespace version — bump whenever the parser changes shape so
// older broken rows are bypassed instead of served. v3 = added carrier
// overview parsing (fleet size, cargo, MCS-150 mileage) to the payload.
const SMS_CACHE_VERSION = 'v3';

export async function fetchSmsData(dot: string): Promise<SmsData> {
  const empty: SmsData = {
    configured: true,
    fetched: false,
    dot,
    carrier: {},
    basics: {},
    inspections: null,
    crashes: null,
    fetchedAt: new Date().toISOString(),
  };
  if (!dot || !/^\d+$/.test(dot)) {
    return { ...empty, error: 'Invalid DOT number' };
  }

  // Try the cache first. SMS rarely changes; weekly refresh is plenty.
  const cached = await readSmsCache(dot);
  if (cached) return cached;

  try {
    const html = await fetchSmsHtml(dot);
    const parsed = parseSmsHtml(html, dot);
    if (parsed.fetched) await writeSmsCache(dot, parsed);
    return parsed;
  } catch (err: any) {
    console.warn('[fmcsa-sms] fetch failed for DOT', dot, ':', err?.message);
    return { ...empty, error: err?.message || 'SMS fetch failed' };
  }
}

// ----- HTTP -------------------------------------------------------------

async function fetchSmsHtml(dot: string): Promise<string> {
  const url = `${SMS_BASE}/${encodeURIComponent(dot)}/Overview.aspx`;
  const controller = new AbortController();
  // SMS occasionally takes 10+ seconds on a cold response. 15s covers the
  // long tail without making a clearly-down server hang the whole verify
  // chain (the verify route itself is parallelized so SMS doesn't block
  // other sources from completing).
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: {
        // Identify ourselves clearly — public-record consumer, not a
        // mass scraper. SMS responds to standard User-Agents fine.
        'User-Agent': 'HaulockBot/1.0 (+https://haulock.com) carrier-fraud-prevention',
        Accept: 'text/html,application/xhtml+xml',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`SMS ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

// ----- parsing ---------------------------------------------------------

function parseSmsHtml(html: string, dot: string): SmsData {
  const result: SmsData = {
    configured: true,
    fetched: true,
    dot,
    carrier: {},
    basics: {},
    inspections: null,
    crashes: null,
    fetchedAt: new Date().toISOString(),
  };

  // Defense: if the page is the "Carrier not found" or "Insufficient data"
  // page, bail clean rather than feeding noise into the report.
  if (/insufficient\s*data/i.test(html) && !/Vehicle\s*Maintenance/i.test(html)) {
    result.fetched = false;
    result.error = 'SMS reports insufficient data for this carrier';
    return result;
  }
  if (/no\s*carrier\s*record\s*found/i.test(html)) {
    result.fetched = false;
    result.error = 'No SMS record found for this DOT';
    return result;
  }

  // -- BASIC scores. The SMS Overview page renders each BASIC measure as
  // a row containing the category label, the measure (a decimal), the
  // inspection count that fed it, and an "Alert" or "✓" indicator.
  // We extract by anchoring on the category label and pulling the next
  // numeric measurement plus inspection count from the surrounding HTML.
  const basicLabels: Array<{ key: keyof SmsData['basics']; patterns: RegExp[] }> = [
    { key: 'unsafeDriving',         patterns: [/Unsafe\s*Driving/i] },
    { key: 'hoursOfService',        patterns: [/Hours[\s-]*of[\s-]*Service\s*Compliance/i, /HOS\s*Compliance/i] },
    { key: 'driverFitness',         patterns: [/Driver\s*Fitness/i] },
    { key: 'controlledSubstances',  patterns: [/Controlled\s*Substances?\s*\/?\s*and?\s*Alcohol/i] },
    { key: 'vehicleMaintenance',    patterns: [/Vehicle\s*Maintenance/i] },
    { key: 'hazmat',                patterns: [/Hazardous\s*Materials\s*Compliance/i, /HM\s*Compliance/i] },
    { key: 'crashIndicator',        patterns: [/Crash\s*Indicator/i] },
  ];

  for (const { key, patterns } of basicLabels) {
    const basic = extractBasicForLabel(html, patterns);
    if (basic) result.basics[key] = basic;
  }

  // -- Inspections summary table. Look for the "Inspections" header row
  // followed by Vehicle / Driver counts + OOS counts.
  result.inspections = extractInspections(html);

  // -- Crashes summary. SMS lists 24-month crash counts grouped by type.
  result.crashes = extractCrashes(html);

  // -- "Last Update" date. Helpful provenance line for the UI.
  const updateMatch = html.match(/Last\s*Update[^<]*<[^>]*>([0-9\/-]+)/i);
  if (updateMatch) result.lastUpdate = updateMatch[1].trim();

  // SMS often has a separate "Last Safety Measurement Period" date —
  // when the BASIC scores were last recomputed. More precise than the
  // generic "last updated" stamp.
  const measMatch = html.match(/Last\s*Safety\s*Measurement[^<]*<[^>]*>([0-9\/-]+)/i)
                || html.match(/Safety\s*Measurement\s*Period[^<]*<[^>]*>([^<]+)/i);
  if (measMatch) result.lastSafetyMeasurementDate = measMatch[1].trim();

  // -- Carrier overview block: SMS Overview pages render this as a small
  // table at the top with carrier-level metadata. We extract the fields
  // that aren't already in QCMobile (cargo hauled, classification, MCS-150
  // mileage) plus a handful that ARE duplicated for cross-verification.
  result.carrier = extractCarrierOverview(html);

  return result;
}

function extractCarrierOverview(html: string): SmsCarrierOverview {
  const flat = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const out: SmsCarrierOverview = {};

  // Total Trucks / Power Units
  const trucks = flat.match(/(?:Total\s*)?(?:Power\s*Units?|Trucks?)\s*[:\s]\s*([\d,]+)/i);
  if (trucks) out.totalTrucks = parseInt(trucks[1].replace(/,/g, ''), 10);

  // Total Drivers
  const drivers = flat.match(/(?:Total\s*)?Drivers?\s*[:\s]\s*([\d,]+)/i);
  if (drivers) out.totalDrivers = parseInt(drivers[1].replace(/,/g, ''), 10);

  // Carrier Operation classification (Interstate / Intrastate / etc.)
  const op = flat.match(/Carrier\s*Operation\s*[:\s]\s*([A-Z][^•·\d]{0,40}?)(?:\s+(?:Hazardous|MCS|Cargo|Last|Phone|Fax))/i);
  if (op) out.carrierOperation = op[1].trim();

  // Hazmat indicator
  const hazmat = flat.match(/Hazardous\s*Material(?:\s*Carrier)?\s*[:\s]\s*(Yes|No)/i);
  if (hazmat) out.hazmatCarrier = /yes/i.test(hazmat[1]);

  // Cargo Hauled — usually a free-form string. Capture up to the next label.
  const cargo = flat.match(/Cargo\s*Hauled\s*[:\s]\s*([^•·]{2,120}?)(?:\s+(?:Operation|Last|Phone|Fax|MCS-150|Total))/i);
  if (cargo) out.cargoHauled = cargo[1].trim();

  // MCS-150 mileage + year
  const mileage = flat.match(/MCS-150\s*Mileage\s*[:\s]\s*([\d,]+)/i);
  if (mileage) out.mcs150Mileage = parseInt(mileage[1].replace(/,/g, ''), 10);
  const mileYr = flat.match(/MCS-150\s*Mileage\s*Year\s*[:\s]\s*(\d{4})/i);
  if (mileYr) out.mcs150MileageYear = mileYr[1];

  // MCS-150 filing date
  const mcsDate = flat.match(/MCS-150\s*Date\s*[:\s]\s*([0-9A-Za-z\/\-]+)/i);
  if (mcsDate) out.mcs150Date = mcsDate[1].trim();

  // Legal name (sometimes only on SMS, useful when QCMobile is partial)
  const name = flat.match(/Legal\s*Name\s*[:\s]\s*([A-Z][A-Z0-9 &\-,'.\/]+?)(?:\s+(?:DBA|Total|MCS|Carrier|Phone|Operating))/);
  if (name) out.legalName = name[1].trim();

  return out;
}

// Extract a single BASIC row by matching the label, then pulling the next
// decimal/integer pair and an Alert indicator from a small window of HTML
// after the label. Resilient to formatting changes inside that window.
function extractBasicForLabel(html: string, patterns: RegExp[]): SmsBasic | null {
  // Strategy: SMS pages render BASIC scores in a <table> where each row
  // (<tr>...</tr>) contains the label cell + measure cell + inspections
  // cell. Anchoring on the label INSIDE a <tr> and extracting from THAT
  // row only is far more reliable than a flat-text window — the previous
  // approach was matching labels in a sidebar / TOC and grabbing values
  // from the wrong row, which produced the "5.00 / 24 inspections"
  // duplicated across multiple BASICs bug.
  //
  // Pattern: walk every <tr>...</tr> in the document, check if the row
  // contains our label, and if so try to extract its measure + count.
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    let matched = false;
    for (const labelRe of patterns) {
      // Strip tags within the row so the regex can match labels broken
      // across cell boundaries.
      const rowText = row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      if (labelRe.test(rowText)) { matched = true; break; }
    }
    if (!matched) continue;

    const rowText = row.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // Honest "no data" cells: page prints "Insufficient Data" / "Not Public"
    // in the measure cell when the carrier doesn't have enough inspections.
    if (/\b(Insufficient\s*Data|Not\s*Public|No\s*Inspections|N\/?A)\b/i.test(rowText)) return null;

    // Strip the label out of the row text before number extraction so we
    // never grab characters from the label itself ("Section 5" → "5").
    let stripped = rowText;
    for (const labelRe of patterns) stripped = stripped.replace(labelRe, ' ');

    // Measure: first decimal in the cleaned row. Accepts ".72" / "3.74".
    const measureMatch = stripped.match(/(?:^|\s)(\d+(?:\.\d+)?|\.\d+)\b/);
    if (!measureMatch) continue;
    const measure = parseFloat(measureMatch[1]);
    // BASIC measures are percentile-ranked 0-100. Reject out-of-range
    // values — they're almost always coming from the wrong cell.
    if (!Number.isFinite(measure) || measure < 0 || measure > 100) continue;

    // Inspections: next integer after the measure.
    const after = stripped.slice(measureMatch.index! + measureMatch[0].length);
    const inspMatch = after.match(/(?:^|\s)(\d+)\b/);
    const inspections = inspMatch ? parseInt(inspMatch[1], 10) : 0;
    if (inspections === 0) continue;

    const alert = /\bAlert\b/i.test(rowText);

    return { measure, inspections, alert };
  }
  return null;
}

function extractInspections(html: string): SmsInspections | null {
  // SMS renders inspection counts in a small table. We look for clusters
  // of "Vehicle" + "Driver" + counts in proximity.
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const veh = extractIntAfter(text, /Vehicle\s*Inspections?(?:\s*\(?last\s*24\s*months\)?)?/i);
  const drv = extractIntAfter(text, /Driver\s*Inspections?(?:\s*\(?last\s*24\s*months\)?)?/i);
  const vehOos = extractIntAfter(text, /Vehicle\s*OOS|Vehicle\s*Out[\s-]*of[\s-]*Service/i);
  const drvOos = extractIntAfter(text, /Driver\s*OOS|Driver\s*Out[\s-]*of[\s-]*Service/i);

  if (veh == null && drv == null) return null;

  const vehOosPct = veh && veh > 0 && vehOos != null ? Math.round((vehOos / veh) * 1000) / 10 : null;
  const drvOosPct = drv && drv > 0 && drvOos != null ? Math.round((drvOos / drv) * 1000) / 10 : null;

  // SMS publishes the national average percentages adjacent to the per-
  // carrier OOS percentage. We try to capture those when present.
  const natVeh = extractFloatAfter(text, /National\s*Average[^%]*Vehicle/i);
  const natDrv = extractFloatAfter(text, /National\s*Average[^%]*Driver/i);

  return {
    vehicleInspections: veh ?? 0,
    driverInspections:  drv ?? 0,
    vehicleOosCount:    vehOos ?? 0,
    driverOosCount:     drvOos ?? 0,
    vehicleOosPct: vehOosPct,
    driverOosPct: drvOosPct,
    vehicleNationalAvgPct: natVeh,
    driverNationalAvgPct:  natDrv,
  };
}

function extractCrashes(html: string): SmsCrashes | null {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // We deliberately DO NOT parse "Crash Total" from the page — it sits
  // next to a "Crashes" section header where naive regex matching grabs
  // the wrong cell. Components (fatal/injury/towaway) parse cleanly.
  // Then total = sum, which is also the canonical FMCSA definition.
  const fatal   = extractIntAfter(text, /Fatal\s*Crash(?:es)?/i);
  const injury  = extractIntAfter(text, /Injury\s*Crash(?:es)?|Inj\s*Crash/i);
  const towaway = extractIntAfter(text, /Towaway\s*Crash(?:es)?|Tow[\s-]*away\s*Crash(?:es)?/i);

  if (fatal == null && injury == null && towaway == null) return null;
  const f = fatal ?? 0;
  const i = injury ?? 0;
  const t = towaway ?? 0;
  return {
    total: f + i + t,
    fatal: f,
    injury: i,
    towaway: t,
  };
}

// Find the first integer that appears AFTER the given label pattern in
// flattened text. Returns null when no match.
function extractIntAfter(text: string, label: RegExp): number | null {
  const m = label.exec(text);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
  const num = after.match(/(\d{1,7})/);
  return num ? parseInt(num[1], 10) : null;
}

function extractFloatAfter(text: string, label: RegExp): number | null {
  const m = label.exec(text);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
  const num = after.match(/(\d+(?:\.\d+)?)/);
  return num ? parseFloat(num[1]) : null;
}

// ----- cache (Supabase fmcsa_cache table, namespaced as `sms:{dot}`) ---

async function readSmsCache(dot: string): Promise<SmsData | null> {
  try {
    const { getServiceSupabase } = await import('./supabase/service');
    const svc = getServiceSupabase();
    if (!svc) return null;
    const { data } = await svc
      .from('fmcsa_cache')
      .select('response,cached_at')
      .eq('cache_key', `sms:${SMS_CACHE_VERSION}:${dot}`)
      .maybeSingle();
    if (!data) return null;
    const ageMs = Date.now() - new Date(data.cached_at).getTime();
    if (ageMs > SMS_CACHE_TTL_MS) return null;
    return data.response as SmsData;
  } catch {
    return null;
  }
}

async function writeSmsCache(dot: string, payload: SmsData): Promise<void> {
  try {
    const { getServiceSupabase } = await import('./supabase/service');
    const svc = getServiceSupabase();
    if (!svc) return;
    await svc.from('fmcsa_cache').upsert(
      { cache_key: `sms:${SMS_CACHE_VERSION}:${dot}`, response: payload, cached_at: new Date().toISOString() },
      { onConflict: 'cache_key' },
    );
  } catch { /* non-fatal */ }
}

// Human-readable label per BASIC key. Used by the report UI.
export const BASIC_LABEL: Record<keyof SmsData['basics'], string> = {
  unsafeDriving:        'Unsafe Driving',
  hoursOfService:       'Hours-of-Service Compliance',
  driverFitness:        'Driver Fitness',
  controlledSubstances: 'Controlled Substances / Alcohol',
  vehicleMaintenance:   'Vehicle Maintenance',
  hazmat:               'Hazardous Materials Compliance',
  crashIndicator:       'Crash Indicator',
};
