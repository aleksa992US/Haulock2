// Fallback carrier lookup via data.transportation.gov's Socrata API.
// Called when FMCSA's direct QCMobile API is unavailable — Socrata runs on
// different infrastructure and is much more reliable. Data is ~daily refresh,
// which is fine for carrier identity verification.
//
// Configure via env:
//   FMCSA_SOCRATA_DATASET_ID  (the 9-char dataset id, e.g. "abc1-2xyz")
//   SOCRATA_APP_TOKEN         (optional, higher rate limits)

import type { ParsedQuery } from './fmcsa';
import { selectNameMatch, nameTokens, type NameCandidateInput } from './name-match';

const SOCRATA_BASE = 'https://data.transportation.gov/resource';

export function isSocrataConfigured(): boolean {
  return Boolean(process.env.FMCSA_SOCRATA_DATASET_ID);
}

type SocrataRow = Record<string, any>;

// Dataset metadata: which columns exist (a $where naming a missing column
// fails the whole query) and when FMCSA last refreshed the rows (the date
// Socrata-sourced reports show as "data from"). Cached for an hour.
type DatasetInfo = { columns: Set<string>; rowsUpdatedAt?: string };
let datasetInfoCache: { id: string; at: number; info: DatasetInfo | null } | null = null;

async function datasetInfo(): Promise<DatasetInfo | null> {
  const datasetId = process.env.FMCSA_SOCRATA_DATASET_ID;
  if (!datasetId) return null;
  if (datasetInfoCache && datasetInfoCache.id === datasetId && Date.now() - datasetInfoCache.at < 60 * 60 * 1000) {
    return datasetInfoCache.info;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  let info: DatasetInfo | null = null;
  try {
    const res = await fetch(`https://data.transportation.gov/api/views/${datasetId}.json`, { signal: controller.signal });
    if (res.ok) {
      const meta = await res.json();
      const columns = new Set<string>((meta?.columns || []).map((c: any) => String(c?.fieldName || '').toLowerCase()).filter(Boolean));
      const updated = Number(meta?.rowsUpdatedAt);
      info = { columns, rowsUpdatedAt: Number.isFinite(updated) && updated > 0 ? new Date(updated * 1000).toISOString() : undefined };
    }
  } catch { /* metadata is optional */ } finally {
    clearTimeout(timeout);
  }
  // Cache failures briefly too, so an outage doesn't add 4s to every call.
  datasetInfoCache = { id: datasetId, at: info ? Date.now() : Date.now() - 55 * 60 * 1000, info };
  return info;
}

// When FMCSA last refreshed the Socrata copy (ISO), if known.
export async function socrataDataAsOf(): Promise<string | undefined> {
  return (await datasetInfo())?.rowsUpdatedAt;
}

async function socrataQuery(params: URLSearchParams): Promise<SocrataRow[]> {
  const datasetId = process.env.FMCSA_SOCRATA_DATASET_ID;
  if (!datasetId) throw new Error('FMCSA_SOCRATA_DATASET_ID is not set');
  const url = `${SOCRATA_BASE}/${datasetId}.json?${params.toString()}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new Error(`Socrata ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as SocrataRow[];
  } finally {
    clearTimeout(timeout);
  }
}

// Map a Socrata row to the same shape our lib/fmcsa.ts normalize() expects.
// We produce a minimal FMCSA-API-like response: { content: { carrier: {...} } }.
function shapeSocrataRow(row: SocrataRow): any {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      for (const actual of Object.keys(row)) {
        if (actual.toLowerCase() === k.toLowerCase()) {
          const v = row[actual];
          if (v != null && String(v) !== '') return String(v).trim();
        }
      }
    }
    return undefined;
  };
  const pickNum = (...keys: string[]) => {
    const v = pick(...keys);
    if (v == null) return undefined;
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  };
  const stripDigits = (v: string | undefined) =>
    v ? v.replace(/[^0-9]/g, '').replace(/^0+/, '') || undefined : undefined;

  const carrier: any = {
    dotNumber: stripDigits(pick('dot_number', 'dot', 'usdot_number')),
    // "Carrier - All With History" (6eyk-hxee) uses docket_number; others use mc_mx_ff_number.
    docketNumber: mcDocket(pick('docket_number', 'mc_mx_ff_number', 'mc_number')),
    legalName: pick('legal_name', 'name'),
    dbaName: pick('dba_name', 'dba'),
    // Physical address columns vary across datasets: bus_* (6eyk-hxee), phy_* (Motor Carrier Census),
    // or plain street/city. Try all.
    phyStreet: pick('bus_street_po', 'phy_street', 'physical_street', 'street'),
    phyCity: pick('bus_city', 'phy_city', 'physical_city', 'city'),
    phyState: pick('bus_state_code', 'phy_state', 'physical_state', 'state'),
    phyZipcode: pick('bus_zip_code', 'phy_zip', 'phy_zipcode', 'physical_zipcode', 'zip'),
    // Mailing address — used for match verification when physical is missing.
    mailStreet: pick('mail_street_po'),
    mailCity: pick('mail_city'),
    mailState: pick('mail_state_code'),
    mailZipcode: pick('mail_zip_code'),
    telephone: pick('bus_telno', 'telephone', 'phone'),
    // Authority status columns on 6eyk-hxee: broker_stat, common_stat, contract_stat (single letter A/I/N).
    commonAuthorityStatus: pick('common_stat', 'common_authority_status', 'common_auth_status'),
    brokerAuthorityStatus: pick('broker_stat', 'broker_authority_status', 'broker_auth_status'),
    contractAuthorityStatus: pick('contract_stat', 'contract_authority_status', 'contract_auth_status'),
    allowedToOperate: pick('allowed_to_operate'),
    bipdInsuranceOnFile: pickNum('bipd_file', 'bipd_insurance_on_file', 'bipd_ins_on_file'),
    cargoInsuranceOnFile: pickNum('cargo_file', 'cargo_insurance_on_file', 'cargo_ins_on_file'),
    cargoInsuranceRequired: pick('cargo_req', 'cargo_insurance_required'),
    bondInsuranceOnFile: pickNum('bond_file', 'bond_insurance_on_file'),
    authorityGrantedDate: pick('authority_granted_date', 'original_authority_date'),
    firstAuthorityDate: pick('first_authority_date'),
    totalDrivers: pickNum('total_drivers', 'drivers'),
    totalPowerUnits: pickNum('total_power_units', 'power_units'),
    crashTotal: pickNum('total_crashes', 'crash_total'),
  };
  return { content: { carrier } };
}

// MC number from a docket column ("MC012892" → "12892"). Freight-forwarder
// (FF) and Mexican (MX) dockets are a different number series, so they are
// not MC numbers and searching "MC-<digits>" would hit another company.
function mcDocket(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toUpperCase();
  if (/^(FF|MX)/.test(s)) return undefined;
  return s.replace(/[^0-9]/g, '').replace(/^0+/, '') || undefined;
}

// Normalize a company name for fuzzy matching: strip punctuation and common
// corporate suffixes so "Fifth Wheel Freight, LLC" matches "FIFTH WHEEL FREIGHT"
// or "FIFTH WHEEL FREIGHT L.L.C." in the FMCSA registry.
function cleanCompanyName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/\b(LLC|L\s*L\s*C|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|LLP|CO)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SocrataLookupOpts = {
  // Callers who know the query is for a broker (e.g. rate con scan) should set
  // this so we rank active-broker records highest — critical when the same name
  // is used by different entity types (a trucking company AND a broker).
  preferActiveBroker?: boolean;
  // Hint address string (city / state / ZIP) to help disambiguate when multiple
  // carriers share the same legal name.
  addressHint?: string;
};

// Query by MC or DOT. Returns FMCSA-API-shaped JSON or null if not found.
// A name returns a record only when exactly one company matches it strongly
// (lib/name-match); callers that need the full list use searchSocrataByName.
export async function lookupOnSocrata(query: ParsedQuery, opts: SocrataLookupOpts = {}): Promise<any | null> {
  if (query.kind === 'name') {
    const { rows } = await searchSocrataByName(query.value);
    const sel = selectNameMatch(query.value, rows, opts);
    if (sel.kind !== 'unique') return null;
    // selectNameMatch keeps the candidate objects' extra fields.
    const row = (sel.match as { row?: SocrataRow }).row;
    return row ? shapeSocrataRow(row) : null;
  }

  // NOTE: don't set $order — not every FMCSA dataset has dt_last_updt or
  // similar timestamp columns, and a bad $order crashes the whole query.
  const info = await datasetInfo();
  // Without metadata, assume the 6eyk-hxee columns.
  const has = (col: string) => !info || info.columns.has(col);
  const v = query.value.replace(/^0+/, '') || query.value;
  const clauses: string[] = [];
  if (query.kind === 'mc') {
    // 6eyk-hxee stores dockets as "MC" + at least 6 digits ("MC012892").
    if (has('docket_number')) clauses.push(`docket_number IN ('MC${v.padStart(6, '0')}', 'MC${v}', '${v}')`);
    if (info?.columns.has('mc_mx_ff_number')) clauses.push(`mc_mx_ff_number IN ('${v}', 'MC${v}', 'MC-${v}')`);
  } else {
    // 6eyk-hxee zero-pads DOT numbers to 8 digits ("02217388").
    if (has('dot_number')) clauses.push(`dot_number IN ('${v.padStart(8, '0')}', '${v}')`);
  }
  if (!clauses.length) return null;

  const params = new URLSearchParams();
  params.set('$where', clauses.join(' OR '));
  params.set('$limit', '10');
  const rows = await socrataQuery(params);
  if (!rows.length) return null;
  // One DOT can have several dockets (MC, FF, MX). Prefer the MC docket.
  const docketOf = (r: SocrataRow) => r.docket_number ?? r.mc_mx_ff_number;
  const chosen = rows.find((r) => mcDocket(docketOf(r)) && candidateFromRow(r)?.active)
    || rows.find((r) => mcDocket(docketOf(r)))
    || rows[0];
  return shapeSocrataRow(chosen);
}

type SocrataCandidate = NameCandidateInput & { row: SocrataRow };

function candidateFromRow(row: SocrataRow): SocrataCandidate | null {
  const c = shapeSocrataRow(row).content.carrier;
  const name = c.legalName || c.dbaName;
  if (!name) return null;
  const stat = (...keys: string[]) => keys.map((k) => String(row[k] ?? '').toUpperCase());
  const broker = stat('broker_stat', 'broker_authority_status').includes('A');
  const carrierAuth = stat('common_stat', 'contract_stat', 'common_authority_status', 'contract_authority_status').includes('A');
  const inactive = stat('broker_stat', 'common_stat', 'contract_stat').includes('I');
  // Census-style datasets have one status_code instead of per-authority columns.
  const census = String(row.status_code ?? '').toUpperCase();
  const hasAuthorityCols = ['broker_stat', 'common_stat', 'contract_stat'].some((k) => row[k] != null);
  let status: string;
  let active: boolean;
  if (!hasAuthorityCols && census) {
    active = census === 'A';
    status = active ? 'Active' : 'Inactive';
  } else {
    active = broker || carrierAuth;
    status = broker && carrierAuth ? 'Active broker & carrier authority'
      : broker ? 'Active broker authority'
      : carrierAuth ? 'Active carrier authority'
      : inactive ? 'Authority inactive'
      : 'No active authority';
  }
  return {
    name,
    dba: c.legalName && c.dbaName ? c.dbaName : undefined,
    mc: c.docketNumber,
    dot: c.dotNumber,
    city: c.phyCity || c.mailCity,
    state: c.phyState || c.mailState,
    zip: c.phyZipcode || c.mailZipcode,
    status,
    active,
    brokerActive: broker,
    via: 'socrata',
    row,
  };
}

// Every company whose legal name or DBA matches the search, as name-match
// candidates (unscored, one per company after selectNameMatch dedupes).
// Two queries, merged: names that START with the search, so exact matches
// are never crowded out of the row limit by the 50+ longer names containing
// it, and names containing every searched word in any order.
export async function searchSocrataByName(name: string): Promise<{ rows: SocrataCandidate[]; truncated: boolean }> {
  const phrase = cleanCompanyName(name).replace(/'/g, "''");
  const words = nameTokens(name).filter((w) => w.length >= 2).slice(0, 5);
  if (!phrase && !words.length) return { rows: [], truncated: false };
  const LIMIT = 100;

  const queries: URLSearchParams[] = [];
  if (phrase) {
    const p = new URLSearchParams();
    p.set('$where', `UPPER(legal_name) LIKE '${phrase}%' OR UPPER(dba_name) LIKE '${phrase}%'`);
    p.set('$limit', String(LIMIT));
    queries.push(p);
  }
  if (words.length) {
    const all = (col: string) => words.map((w) => `UPPER(${col}) LIKE '%${w}%'`).join(' AND ');
    const p = new URLSearchParams();
    p.set('$where', `(${all('legal_name')}) OR (${all('dba_name')})`);
    p.set('$limit', String(LIMIT));
    queries.push(p);
  }

  const settled = await Promise.allSettled(queries.map((p) => socrataQuery(p)));
  const ok = settled.filter((s): s is PromiseFulfilledResult<SocrataRow[]> => s.status === 'fulfilled');
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
  const truncated = ok.some((s) => s.value.length >= LIMIT);
  const rows = ok.flatMap((s) => s.value).map(candidateFromRow).filter((c): c is SocrataCandidate => Boolean(c));
  return { rows, truncated };
}
