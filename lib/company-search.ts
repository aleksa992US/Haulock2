// Type-ahead company search over two public FMCSA datasets on
// data.transportation.gov:
//   - registry ("Carrier - All With History", 6eyk-hxee): every company with
//     an MC/MX/FF docket — MC, USDOT, names, city/state, per-role authority.
//   - census ("Company Census", az4n-8mr2): every USDOT number, including
//     companies with no MC (intrastate / private carriers) and fleet size.
// Registry rows win when both have the same USDOT number. Public FMCSA data
// only — never other users' lookups. Suggestions are free; picking one runs
// the real check.

const REGISTRY = process.env.FMCSA_REGISTRY_DATASET_ID || '6eyk-hxee';
const CENSUS = process.env.FMCSA_CENSUS_DATASET_ID || 'az4n-8mr2';
const BASE = 'https://data.transportation.gov/resource';
const TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RESULTS = 8;

export type SuggestKind = 'mc' | 'dot' | 'name' | 'auto';

export type CompanySuggestion = {
  name: string;
  dba?: string;
  mc?: string;          // digits only
  dot?: string;         // digits only, no zero padding
  city?: string;
  state?: string;
  // 'dot-only' = in the USDOT census with no MC docket, so no interstate
  // authority to report (often intrastate or private carriers).
  role: 'carrier' | 'broker' | 'both' | 'none' | 'dot-only';
  active: boolean;      // any authority active (registry) / USDOT active (census)
  powerUnits?: number;
  query: string;        // what /api/verify takes: "MC-123" or "DOT-123"
  matchedOn: 'mc' | 'dot' | 'name' | 'dba';
};

const cache = new Map<string, { at: number; value: CompanySuggestion[] }>();

function toTitle(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function toSuggestion(r: any, matchedOn: CompanySuggestion['matchedOn']): CompanySuggestion | null {
  const mcRaw = String(r.docket_number || '');
  // Only MC dockets are motor-carrier numbers; MX/FF dockets aren't searchable by MC.
  const mc = /^MC/i.test(mcRaw) ? mcRaw.replace(/\D/g, '').replace(/^0+/, '') : undefined;
  const dot = String(r.dot_number || '').replace(/\D/g, '').replace(/^0+/, '') || undefined;
  if (!mc && !dot) return null;
  const carrier = r.common_stat === 'A' || r.contract_stat === 'A';
  const broker = r.broker_stat === 'A';
  return {
    name: String(r.legal_name || r.dba_name || 'Unknown company').trim(),
    dba: r.dba_name ? String(r.dba_name).trim() : undefined,
    mc,
    dot,
    city: toTitle(r.bus_city),
    state: r.bus_state_code || undefined,
    role: carrier && broker ? 'both' : carrier ? 'carrier' : broker ? 'broker' : 'none',
    active: carrier || broker,
    query: mc ? `MC-${mc}` : `DOT-${dot}`,
    matchedOn,
  };
}

const REGISTRY_COLS = 'legal_name,dba_name,docket_number,dot_number,bus_city,bus_state_code,common_stat,contract_stat,broker_stat';
const CENSUS_COLS = 'dot_number,legal_name,dba_name,phy_city,phy_state,status_code,power_units';

async function soql(where: string, order: string, dataset: string = REGISTRY, select: string = REGISTRY_COLS): Promise<any[]> {
  const params = new URLSearchParams({
    $where: where,
    $limit: '25',
    $order: order,
    $select: select,
  });
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${dataset}.json?${params.toString()}`, { headers, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Registry search failed (${res.status})`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timer);
  }
}

// Exact id first, then active carrier/broker authority, then active
// USDOT-only companies, then inactive ones; ties by name.
function rank(list: CompanySuggestion[], exact?: { mc?: string; dot?: string }): CompanySuggestion[] {
  const seen = new Set<string>();
  return list
    .filter((s) => (seen.has(s.query) ? false : (seen.add(s.query), true)))
    .sort((a, b) => {
      const ea = exact && ((exact.mc && a.mc === exact.mc) || (exact.dot && a.dot === exact.dot)) ? 1 : 0;
      const eb = exact && ((exact.mc && b.mc === exact.mc) || (exact.dot && b.dot === exact.dot)) ? 1 : 0;
      const tier = (x: CompanySuggestion) => (x.active ? (x.role === 'dot-only' ? 1 : 2) : 0);
      return (eb - ea) || (tier(b) - tier(a)) || a.name.localeCompare(b.name);
    })
    .slice(0, MAX_RESULTS);
}

function fromCensus(r: any, matchedOn: CompanySuggestion['matchedOn']): CompanySuggestion | null {
  const dot = String(r.dot_number || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!dot) return null;
  const units = Number(r.power_units);
  return {
    name: String(r.legal_name || r.dba_name || 'Unknown company').trim(),
    dba: r.dba_name ? String(r.dba_name).trim() : undefined,
    dot,
    city: toTitle(r.phy_city),
    state: r.phy_state || undefined,
    role: 'dot-only',
    active: r.status_code === 'A',
    powerUnits: Number.isFinite(units) && units > 0 ? units : undefined,
    query: `DOT-${dot}`,
    matchedOn,
  };
}

// Registry entries carry MC + authority, so they win over the census row
// for the same USDOT number; census-only companies are kept.
function mergeByDot(registry: CompanySuggestion[], census: CompanySuggestion[]): CompanySuggestion[] {
  const byDot = new Map<string, CompanySuggestion>();
  for (const c of census) if (c.dot) byDot.set(c.dot, c);
  const out: CompanySuggestion[] = [];
  const used = new Set<string>();
  for (const r of registry) {
    const cen = r.dot ? byDot.get(r.dot) : undefined;
    out.push(cen?.powerUnits ? { ...r, powerUnits: cen.powerUnits } : r);
    if (r.dot) used.add(r.dot);
  }
  for (const c of census) if (c.dot && !used.has(c.dot)) out.push(c);
  return out;
}

async function byMc(digits: string): Promise<CompanySuggestion[]> {
  const rows = await soql(`starts_with(docket_number, 'MC${digits}')`, 'docket_number');
  return rows.map((r) => toSuggestion(r, 'mc')).filter(Boolean) as CompanySuggestion[];
}

async function byDot(digits: string): Promise<CompanySuggestion[]> {
  // Registry: DOT numbers are text, zero-padded to 8 digits, and we can't
  // know the final length while the user is still typing — try every padding.
  const pads: string[] = [];
  for (let p = 0; p + digits.length <= 8; p++) pads.push(`starts_with(dot_number, '${'0'.repeat(p)}${digits}')`);
  if (!pads.length) return [];
  // Census: DOT numbers are numeric, so "starts with 116290" becomes ranges
  // 116290, 1162900–1162909, 11629000–11629099 (up to 8 digits).
  const n = Number(digits);
  const ranges: string[] = [];
  for (let k = 0; digits.length + k <= 8; k++) {
    const lo = n * 10 ** k;
    ranges.push(`(dot_number between ${lo} and ${lo + 10 ** k - 1})`);
  }
  const [reg, cen] = await Promise.all([
    soql(pads.join(' OR '), 'dot_number').catch(() => []),
    soql(ranges.join(' OR '), 'dot_number', CENSUS, CENSUS_COLS).catch(() => []),
  ]);
  return mergeByDot(
    reg.map((r) => toSuggestion(r, 'dot')).filter(Boolean) as CompanySuggestion[],
    cen.map((r) => fromCensus(r, 'dot')).filter(Boolean) as CompanySuggestion[],
  );
}

async function byName(text: string): Promise<CompanySuggestion[]> {
  // Letters, digits and a few name characters only; quotes doubled for SoQL.
  const q = text.toUpperCase().replace(/[^A-Z0-9 &.,'-]/g, '').replace(/\s+/g, ' ').trim().replace(/'/g, "''");
  if (q.length < 3) return [];
  const where = `starts_with(upper(legal_name), '${q}') OR starts_with(upper(dba_name), '${q}')`;
  const [reg, cen] = await Promise.all([
    soql(where, 'legal_name').catch(() => []),
    soql(where, 'legal_name', CENSUS, CENSUS_COLS).catch(() => []),
  ]);
  const plain = q.replace(/''/g, "'");
  const on = (r: any): CompanySuggestion['matchedOn'] => (!String(r.legal_name || '').toUpperCase().startsWith(plain) && r.dba_name ? 'dba' : 'name');
  return mergeByDot(
    reg.map((r) => toSuggestion(r, on(r))).filter(Boolean) as CompanySuggestion[],
    cen.map((r) => fromCensus(r, on(r))).filter(Boolean) as CompanySuggestion[],
  );
}

export async function suggestCompanies(rawQuery: string, kind: SuggestKind = 'auto'): Promise<CompanySuggestion[]> {
  const raw = String(rawQuery || '').trim();
  if (!raw) return [];
  // "MC-123…" / "DOT 351…" pin the registry; bare digits use `kind`.
  const pinned = raw.match(/^(MC|MX|FF|U?S?DOT)[\s#-]*(\d+)$/i);
  const digitsOnly = /^[\d\s#-]+$/.test(raw) ? raw.replace(/\D/g, '') : '';
  let mode: 'mc' | 'dot' | 'both' | 'name';
  let digits = '';
  if (pinned) {
    mode = /DOT/i.test(pinned[1]) ? 'dot' : 'mc';
    digits = pinned[2];
  } else if (digitsOnly) {
    digits = digitsOnly;
    mode = kind === 'mc' ? 'mc' : kind === 'dot' ? 'dot' : 'both';
  } else {
    mode = 'name';
  }
  if (mode !== 'name') {
    digits = digits.replace(/^0+/, '');
    if (digits.length < 3 || digits.length > 8) return [];
  }

  const key = `${mode}:${mode === 'name' ? raw.toUpperCase() : digits}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let list: CompanySuggestion[] = [];
  if (mode === 'mc') list = rank(await byMc(digits), { mc: digits });
  else if (mode === 'dot') list = rank(await byDot(digits), { dot: digits });
  else if (mode === 'both') {
    const [mc, dot] = await Promise.all([byMc(digits).catch(() => []), byDot(digits).catch(() => [])]);
    list = rank([...mc, ...dot], { mc: digits, dot: digits });
  } else list = rank(await byName(raw));

  cache.set(key, { at: Date.now(), value: list });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return list;
}
