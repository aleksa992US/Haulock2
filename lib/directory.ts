// The public directory: every freight broker and carrier with interstate
// operating authority, read live from FMCSA's open data and cached.
//
// Two registries are merged, as everywhere else in Haulock:
//   - the older registry (6eyk-hxee), frozen when FMCSA moved to Motus in
//     May 2026: every company with an MC docket as of that day;
//   - the Motus registry (inys-ebih): every company registered or changed
//     since, one row per operating authority. It wins where both have an
//     answer for the same authority.
// USDOT-only companies (no MC docket) come from the census (az4n-8mr2).
//
// Only public registry facts are read here (name, numbers, city, state,
// authority). Everything that makes up the paid check stays in /api/verify.

import {
  CENSUS_COLS, MOTUS_COLS, REGISTRY_COLS, fromCensus, toSuggestion,
  type CompanySuggestion,
} from './company-search';
import { US_STATES, type DirectoryKind } from './directory-links';

const BASE = 'https://data.transportation.gov/resource';
const REGISTRY = process.env.FMCSA_REGISTRY_DATASET_ID || '6eyk-hxee';
const MOTUS = process.env.FMCSA_MOTUS_REGISTRY_DATASET_ID || 'inys-ebih';
const CENSUS = process.env.FMCSA_CENSUS_DATASET_ID || 'az4n-8mr2';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
export const PAGE_SIZE = 100;

// Cached by Next's data cache, so a page of results costs FMCSA one request a
// day however many visitors (or crawlers) open it.
async function socrata(dataset: string, params: Record<string, string>, revalidate: number = DAY): Promise<any[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  const res = await fetch(`${BASE}/${dataset}.json?${new URLSearchParams(params).toString()}`, {
    headers,
    next: { revalidate },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`FMCSA open data answered ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

const esc = (s: string) => s.replace(/'/g, "''");
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
const isCarrierType = (t: unknown) => /Motor Carrier/i.test(String(t || ''));
const isBrokerType = (t: unknown) => /^Broker/i.test(String(t || ''));
const isActive = (s: unknown) => /^active$/i.test(String(s || ''));

const legacyActive = (kind: DirectoryKind) => (kind === 'brokers' ? "broker_stat = 'A'" : "(common_stat = 'A' OR contract_stat = 'A')");
const motusType = (kind: DirectoryKind) => (kind === 'brokers' ? "starts_with(op_auth_type, 'Broker')" : "op_auth_type like '%Motor Carrier%'");

// ---------- One company ----------

export type PublicCompany = {
  name: string;
  dba?: string;
  mc?: string;
  dot?: string;
  city?: string;
  state?: string;
  role: CompanySuggestion['role'];
  carrierActive: boolean;
  brokerActive: boolean;
  active: boolean;
  // Where the authority status came from.
  source: 'motus' | 'registry' | 'census';
};

// Motus has a row per authority. For a type Motus has a row for, Motus is the
// answer; for a type it has no row for, the older registry still stands.
function mergeCompany(motusRows: any[], legacy: CompanySuggestion | null, legacyRaw: any | null): PublicCompany | null {
  const first = motusRows[0];
  if (!first && !legacy) return null;
  const mCarrier = motusRows.filter((r) => isCarrierType(r.op_auth_type));
  const mBroker = motusRows.filter((r) => isBrokerType(r.op_auth_type));
  const legacyCarrier = Boolean(legacyRaw && (legacyRaw.common_stat === 'A' || legacyRaw.contract_stat === 'A'));
  const legacyBroker = Boolean(legacyRaw && legacyRaw.broker_stat === 'A');
  const carrierActive = mCarrier.length ? mCarrier.some((r) => isActive(r.op_auth_status)) : legacyCarrier;
  const brokerActive = mBroker.length ? mBroker.some((r) => isActive(r.op_auth_status)) : legacyBroker;
  const fromMotus = first ? toSuggestion({
    legal_name: first.legal_name, dba_name: first.dba_name, docket_number: first.docket_number, dot_number: first.usdot_number,
    bus_city: first.bus_city, bus_state_code: first.bus_state_code,
  }, 'mc') : null;
  const base = fromMotus || legacy;
  if (!base) return null;
  return {
    name: base.name,
    dba: base.dba || legacy?.dba,
    mc: base.mc || legacy?.mc,
    dot: base.dot || legacy?.dot,
    city: base.city || legacy?.city,
    state: base.state || legacy?.state,
    role: carrierActive && brokerActive ? 'both' : carrierActive ? 'carrier' : brokerActive ? 'broker' : 'none',
    carrierActive,
    brokerActive,
    active: carrierActive || brokerActive,
    source: first ? 'motus' : 'registry',
  };
}

async function companyByMc(mc: string): Promise<PublicCompany | null> {
  const [mot, leg] = await Promise.allSettled([
    socrata(MOTUS, { $select: MOTUS_COLS, $where: `docket_number = 'MC${mc}'`, $limit: '50' }, 6 * HOUR),
    socrata(REGISTRY, { $select: REGISTRY_COLS, $where: `docket_number = 'MC${mc.padStart(6, '0')}'`, $limit: '2' }),
  ]);
  // A failed read must never look like "no such company".
  if (mot.status === 'rejected' && leg.status === 'rejected') throw mot.reason;
  const motusRows = mot.status === 'fulfilled' ? mot.value : [];
  const legacyRaw = leg.status === 'fulfilled' ? leg.value[0] || null : null;
  return mergeCompany(motusRows, legacyRaw ? toSuggestion(legacyRaw, 'mc') : null, legacyRaw);
}

async function companyByDot(dot: string): Promise<PublicCompany | null> {
  const [mot, leg, cen] = await Promise.allSettled([
    socrata(MOTUS, { $select: MOTUS_COLS, $where: `usdot_number = '${dot}'`, $limit: '50' }, 6 * HOUR),
    socrata(REGISTRY, { $select: REGISTRY_COLS, $where: `dot_number = '${dot.padStart(8, '0')}'`, $limit: '10' }),
    socrata(CENSUS, { $select: CENSUS_COLS, $where: `dot_number = ${Number(dot)}`, $limit: '1' }),
  ]);
  if (mot.status === 'rejected' && leg.status === 'rejected' && cen.status === 'rejected') throw mot.reason;
  const motusRows = (mot.status === 'fulfilled' ? mot.value : []).filter((r) => /^MC/i.test(String(r.docket_number || '')));
  const legacyRows = (leg.status === 'fulfilled' ? leg.value : []).filter((r) => /^MC/i.test(String(r.docket_number || '')));
  // One USDOT number can hold more than one MC docket; the one with active
  // authority is the company a visitor means.
  const dockets = new Map<string, { motus: any[]; legacy: any | null }>();
  for (const r of motusRows) {
    const k = digits(r.docket_number);
    dockets.set(k, { motus: [...(dockets.get(k)?.motus || []), r], legacy: dockets.get(k)?.legacy || null });
  }
  for (const r of legacyRows) {
    const k = digits(r.docket_number);
    dockets.set(k, { motus: dockets.get(k)?.motus || [], legacy: r });
  }
  const merged = [...dockets.values()]
    .map((d) => mergeCompany(d.motus, d.legacy ? toSuggestion(d.legacy, 'dot') : null, d.legacy))
    .filter(Boolean) as PublicCompany[];
  const best = merged.find((c) => c.active) || merged[0];
  if (best) return { ...best, dot: best.dot || dot };
  const census = cen.status === 'fulfilled' && cen.value[0] ? fromCensus(cen.value[0], 'dot') : null;
  if (!census) return null;
  return {
    name: census.name, dba: census.dba, dot: census.dot, city: census.city, state: census.state,
    role: 'dot-only', carrierActive: false, brokerActive: false, active: census.active, source: 'census',
  };
}

export async function getCompany(id: { mc?: string; dot?: string }): Promise<PublicCompany | null> {
  const mc = digits(id.mc);
  const dot = digits(id.dot);
  if (mc) return companyByMc(mc);
  if (dot) return companyByDot(dot);
  return null;
}

// ---------- Lists ----------

export type StateCount = { code: string; name: string; count: number };

// Companies with active authority per state. Counted in the older registry,
// which holds the large majority; Motus adds the newest registrations to each
// list (see listCompanies), so real lists run slightly longer.
export async function listStates(kind: DirectoryKind): Promise<StateCount[]> {
  const rows = await socrata(REGISTRY, {
    $select: 'bus_state_code, count(*) as n',
    $where: `${legacyActive(kind)} AND starts_with(docket_number, 'MC')`,
    $group: 'bus_state_code',
    $limit: '200',
  });
  const byCode = new Map(rows.map((r) => [String(r.bus_state_code || '').toUpperCase(), Number(r.n) || 0]));
  return US_STATES.map((s) => ({ ...s, count: byCode.get(s.code) || 0 }));
}

export type DirectoryRow = { name: string; dba?: string; mc: string; dot?: string; city?: string; state?: string };
export type DirectoryPage = { rows: DirectoryRow[]; page: number; pages: number; total: number };

const upperName = (s: string) => s.toUpperCase();

export async function listCompanies(kind: DirectoryKind, stateCode: string, page: number): Promise<DirectoryPage | null> {
  const state = stateCode.toUpperCase();
  if (!US_STATES.some((s) => s.code === state)) return null;
  const where = `${legacyActive(kind)} AND bus_state_code = '${state}' AND starts_with(docket_number, 'MC')`;
  const [countRows, raw] = await Promise.all([
    socrata(REGISTRY, { $select: 'count(*) as n', $where: where }),
    // One row more than a page: its name is where the next page starts.
    socrata(REGISTRY, { $select: REGISTRY_COLS, $where: where, $order: 'upper(legal_name), docket_number', $limit: String(PAGE_SIZE + 1), $offset: String((page - 1) * PAGE_SIZE) }),
  ]);
  const total = Number(countRows[0]?.n) || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > pages) return null;
  const pageRows = raw.slice(0, PAGE_SIZE);
  const nextFirst = raw.length > PAGE_SIZE ? upperName(String(raw[PAGE_SIZE].legal_name || '')) : null;
  const thisFirst = page > 1 && pageRows[0] ? upperName(String(pageRows[0].legal_name || '')) : null;

  // Motus: (1) what it now says about the companies on this page, and
  // (2) companies registered since the older registry froze whose names fall
  // inside this page's alphabetical range.
  const dockets = pageRows.map((r) => `'MC${digits(r.docket_number)}'`).filter((d) => d.length > 4);
  const range = [
    thisFirst ? `upper(legal_name) >= '${esc(thisFirst)}'` : '',
    nextFirst ? `upper(legal_name) < '${esc(nextFirst)}'` : '',
  ].filter(Boolean).join(' AND ');
  const [overlay, fresh] = await Promise.allSettled([
    dockets.length ? socrata(MOTUS, { $select: MOTUS_COLS, $where: `docket_number in (${dockets.join(',')})`, $limit: '2000' }) : Promise.resolve([]),
    socrata(MOTUS, {
      $select: MOTUS_COLS,
      $where: `op_auth_status = 'Active' AND bus_state_code = '${state}' AND starts_with(docket_number, 'MC') AND ${motusType(kind)}${range ? ` AND ${range}` : ''}`,
      $order: 'upper(legal_name)',
      $limit: '1000',
    }),
  ]);
  const wanted = kind === 'brokers' ? isBrokerType : isCarrierType;
  const motusByMc = new Map<string, any[]>();
  for (const r of overlay.status === 'fulfilled' ? overlay.value : []) {
    const k = digits(r.docket_number);
    motusByMc.set(k, [...(motusByMc.get(k) || []), r]);
  }

  const out = new Map<string, DirectoryRow>();
  for (const r of pageRows) {
    const s = toSuggestion(r, 'name');
    if (!s?.mc) continue;
    const now = (motusByMc.get(s.mc) || []).filter((m) => wanted(m.op_auth_type));
    // Motus has this authority and it's no longer active: it left the list.
    if (now.length && !now.some((m) => isActive(m.op_auth_status))) continue;
    const m = (motusByMc.get(s.mc) || [])[0];
    out.set(s.mc, {
      name: String(m?.legal_name || s.name).trim(), dba: s.dba, mc: s.mc, dot: s.dot,
      city: s.city, state: s.state,
    });
  }
  for (const r of fresh.status === 'fulfilled' ? fresh.value : []) {
    const s = toSuggestion({ legal_name: r.legal_name, dba_name: r.dba_name, docket_number: r.docket_number, dot_number: r.usdot_number, bus_city: r.bus_city, bus_state_code: r.bus_state_code }, 'name');
    if (!s?.mc || out.has(s.mc)) continue;
    out.set(s.mc, { name: s.name, dba: s.dba, mc: s.mc, dot: s.dot, city: s.city, state: s.state });
  }
  const rows = [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', ignorePunctuation: true }));
  return { rows, page, pages, total };
}

// ---------- Sitemap ----------

// MC numbers of every broker with active authority (older registry plus
// Motus), for the sitemap. About 30,000 numbers in two requests.
export async function activeBrokerMcs(): Promise<string[]> {
  const [leg, mot] = await Promise.allSettled([
    socrata(REGISTRY, { $select: 'docket_number', $where: `${legacyActive('brokers')} AND starts_with(docket_number, 'MC')`, $order: 'docket_number', $limit: '50000' }, 7 * DAY),
    socrata(MOTUS, { $select: 'docket_number', $where: `op_auth_status = 'Active' AND starts_with(docket_number, 'MC') AND ${motusType('brokers')}`, $group: 'docket_number', $limit: '50000' }, 7 * DAY),
  ]);
  if (leg.status === 'rejected' && mot.status === 'rejected') throw leg.reason;
  const all = new Set<string>();
  for (const r of [...(leg.status === 'fulfilled' ? leg.value : []), ...(mot.status === 'fulfilled' ? mot.value : [])]) {
    const mc = digits(r.docket_number);
    if (mc) all.add(mc);
  }
  return [...all];
}
