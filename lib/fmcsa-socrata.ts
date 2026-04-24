// Fallback carrier lookup via data.transportation.gov's Socrata API.
// Called when FMCSA's direct QCMobile API is unavailable — Socrata runs on
// different infrastructure and is much more reliable. Data is ~daily refresh,
// which is fine for carrier identity verification.
//
// Configure via env:
//   FMCSA_SOCRATA_DATASET_ID  (the 9-char dataset id, e.g. "abc1-2xyz")
//   SOCRATA_APP_TOKEN         (optional, higher rate limits)

import type { ParsedQuery } from './fmcsa';

const SOCRATA_BASE = 'https://data.transportation.gov/resource';

export function isSocrataConfigured(): boolean {
  return Boolean(process.env.FMCSA_SOCRATA_DATASET_ID);
}

type SocrataRow = Record<string, any>;

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
    docketNumber: stripDigits(pick('docket_number', 'mc_mx_ff_number', 'mc_number')),
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

// Query by MC, DOT, or name. Returns FMCSA-API-shaped JSON or null if not found.
export async function lookupOnSocrata(query: ParsedQuery, opts: SocrataLookupOpts = {}): Promise<any | null> {
  const params = new URLSearchParams();
  // For name queries, pull more candidates so we can rank them.
  params.set('$limit', query.kind === 'name' ? '25' : '1');
  // NOTE: don't set $order — not every FMCSA dataset has dt_last_updt or similar
  // timestamp columns, and a bad $order crashes the whole query. Our
  // rankCandidates() below does the ordering we actually need.

  if (query.kind === 'mc') {
    params.set(
      '$where',
      `docket_number='${query.value}' OR mc_mx_ff_number='${query.value}' OR mc_mx_ff_number='MC${query.value}'`,
    );
  } else if (query.kind === 'dot') {
    params.set('$where', `dot_number='${query.value}'`);
  } else {
    const needle = cleanCompanyName(query.value).replace(/'/g, "''");
    if (!needle) return null;
    params.set('$where', `UPPER(legal_name) LIKE '%${needle}%' OR UPPER(dba_name) LIKE '%${needle}%'`);
  }

  const rows = await socrataQuery(params);
  if (!rows.length) return null;

  let chosen: SocrataRow = rows[0];
  if (query.kind === 'name' && rows.length > 1) {
    chosen = rankCandidates(rows, query.value, opts);
  }
  return shapeSocrataRow(chosen);
}

// Score and pick the best candidate among Socrata matches.
function rankCandidates(rows: SocrataRow[], nameQuery: string, opts: SocrataLookupOpts): SocrataRow {
  const target = cleanCompanyName(nameQuery);
  const hint = (opts.addressHint || '').toUpperCase();
  const hintZip3 = (hint.match(/\b(\d{3})\d{2}\b/) || [])[1];
  const hintWords = new Set<string>(
    hint.split(/[^A-Z]+/).filter((w) => w.length > 3),
  );

  const isBrokerActive = (r: SocrataRow) => String(r.broker_stat || r.broker_authority_status || '') === 'A';
  const isCommonActive = (r: SocrataRow) => String(r.common_stat || r.common_authority_status || '') === 'A';
  const isContractActive = (r: SocrataRow) => String(r.contract_stat || r.contract_authority_status || '') === 'A';

  const score = (r: SocrataRow): number => {
    let s = 0;
    // Exact cleaned-name match is the strongest signal.
    if (cleanCompanyName(String(r.legal_name || '')) === target) s += 10;
    else if (target && String(r.legal_name || '').toUpperCase().includes(target)) s += 3;

    // Preferred authority type for this caller.
    if (opts.preferActiveBroker) {
      if (isBrokerActive(r)) s += 8;
      else if (isCommonActive(r) || isContractActive(r)) s += 1;
    } else {
      if (isBrokerActive(r) || isCommonActive(r) || isContractActive(r)) s += 3;
    }

    // Address hint: match ZIP3 prefix or any 4+ char word (city name).
    if (hintZip3) {
      const recZips: string[] = [r.bus_zip_code, r.mail_zip_code, r.phy_zip]
        .filter(Boolean).map((x) => String(x));
      if (recZips.some((z) => z.startsWith(hintZip3))) s += 5;
    }
    if (hintWords.size) {
      const recText = [r.bus_city, r.mail_city, r.bus_state_code, r.mail_state_code, r.phy_city, r.phy_state]
        .filter(Boolean).map((x) => String(x).toUpperCase()).join(' ');
      const recWords = new Set<string>(recText.split(/[^A-Z]+/).filter((w) => w.length > 3));
      const shared = Array.from(hintWords).filter((w) => recWords.has(w)).length;
      if (shared >= 1) s += 3 * Math.min(shared, 2);
    }
    return s;
  };

  const ranked = rows
    .map((r) => ({ r, s: score(r) }))
    .sort((a, b) => b.s - a.s);
  return ranked[0].r;
}
