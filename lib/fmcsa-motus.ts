// FMCSA's Motus records for one company, from the public "Motus" datasets on
// data.transportation.gov (published daily, no API key; SOCRATA_APP_TOKEN
// raises the rate limit):
//   - Motus Carrier – All With History  (inys-ebih): name, phone, address,
//     each operating authority and its status, insurance amounts on file
//   - Motus BOC3 – All With History     (6snj-ed7q): process agent filing
//   - Motus RevokeSuspend – All With History (wb4f-neki): suspension and
//     revocation notices FMCSA served
//
// FMCSA moved licensing to Motus in May 2026. Companies are in Motus once
// they registered or changed something since; changes land there first and
// reach FMCSA's other systems (QCMobile / SAFER, the MCS-150 census) later.
// So when both have a value and they differ, the report shows both, Motus
// first, each with its date. Motus doesn't publish email addresses: the
// email of record only exists on the MCS-150 census.

const BASE = 'https://data.transportation.gov';
const CARRIER = () => process.env.FMCSA_MOTUS_REGISTRY_DATASET_ID || 'inys-ebih';
const BOC3 = () => process.env.FMCSA_MOTUS_BOC3_DATASET_ID || '6snj-ed7q';
const REVOKE = () => process.env.FMCSA_MOTUS_REVOKE_DATASET_ID || 'wb4f-neki';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // published once a day

export type MotusRecord = {
  checked: boolean;            // the Motus datasets answered
  found: boolean;              // this company has a Motus registry record
  asOf?: string;               // YYYY-MM-DD, when FMCSA last published Motus
  legalName?: string;
  dbaName?: string;
  phone?: string;              // 10 digits
  address?: string;
  // Only when FMCSA has a mailing address that is a different place from the
  // business address (another street number or ZIP).
  mailingAddress?: string;
  country?: string;            // business country when it isn't the US ("CA", "MX")
  rfc?: string;                // Mexican tax ID (RFC), for Mexico-domiciled carriers
  mc?: string;                 // MC docket digits, when the docket is an MC one
  authorities: { type: string; status: string }[];
  // Per family, the best status among its Motus rows: Active, else Inactive,
  // else Pending, else Withdrawn. Pending/Withdrawn describe an application,
  // not an authority, so only Active and Inactive are compared with FMCSA's
  // older record. Undefined = Motus has no row of that family.
  carrierStatus?: MotusStatus;
  brokerStatus?: MotusStatus;
  carrierActive?: boolean;     // carrierStatus === 'Active'
  brokerActive?: boolean;      // brokerStatus === 'Active'
  // Insurance on file, read from the Active rows (else the Inactive ones):
  // an application's row says nothing about coverage yet.
  bipdOnFile?: number;         // thousands of dollars, like CarrierReport.bipdOnFile
  bipdRequired?: number;       // thousands of dollars
  cargoOnFile?: boolean;
  bondOnFile?: boolean;
  cargoRequired?: boolean;     // FMCSA requires a cargo filing (household goods)
  bondRequired?: boolean;      // FMCSA requires a bond or trust fund (brokers, forwarders)
  boc3?: { agent: string; city?: string; state?: string };
  // Newest first. Involuntary suspension notices usually mean insurance or
  // the process agent lapsed; they're lifted when it's fixed.
  suspensions: { type: string; servedDate?: string; effectiveDate?: string; authority?: string }[];
  error?: string;
};

export type MotusStatus = 'Active' | 'Inactive' | 'Pending' | 'Withdrawn';

// One registry field where Motus and FMCSA's older records disagree.
export type RegistryDiff = {
  field: 'name' | 'phone' | 'address' | 'carrierAuthority' | 'brokerAuthority' | 'bipdOnFile';
  label: string;
  motus: string;
  fmcsa: string;
  concern: boolean;            // the newer Motus value is the worse one
};

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) h['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  return h;
}

async function getJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: headers(), signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Motus data ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function rows(dataset: string, where: string, extra: Record<string, string> = {}): Promise<any[]> {
  const params = new URLSearchParams({ $where: where, $limit: '50', ...extra });
  const data = await getJson(`${BASE}/resource/${dataset}.json?${params.toString()}`);
  return Array.isArray(data) ? data : [];
}

function isoDate(v: unknown): string | undefined {
  const m = String(v ?? '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const phone10 = (v: unknown) => { const d = digits(v); return d.length >= 10 ? d.slice(-10) : undefined; };
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim() || undefined;

let asOfCache: { value: string | undefined; at: number } | null = null;
async function publishedAt(): Promise<string | undefined> {
  if (asOfCache && Date.now() - asOfCache.at < CACHE_TTL_MS) return asOfCache.value;
  try {
    const meta = await getJson(`${BASE}/api/views/${CARRIER()}.json`);
    const value = typeof meta?.rowsUpdatedAt === 'number' ? new Date(meta.rowsUpdatedAt * 1000).toISOString().slice(0, 10) : undefined;
    asOfCache = { value, at: Date.now() };
    return value;
  } catch {
    return undefined;
  }
}

const cache = new Map<string, { at: number; value: MotusRecord }>();

export async function fetchMotusRecord(ids: { mc?: string | null; dot?: string | null }): Promise<MotusRecord> {
  const mc = digits(ids.mc).replace(/^0+/, '');
  const dot = digits(ids.dot).replace(/^0+/, '');
  if (!mc && !dot) return { checked: false, found: false, authorities: [], suspensions: [], error: 'No MC or DOT number' };
  const key = `${mc}|${dot}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  // The MC picks the right docket when a USDOT number also holds FF/MX ones.
  // The suspension dataset writes dockets as "MC-1002167".
  const dockets = mc ? Array.from(new Set([`MC${mc}`, `MC${mc.padStart(6, '0')}`, `MC-${mc}`])).map((d) => `'${d}'`).join(', ') : '';
  const byId = mc ? `docket_number in (${dockets})` : `usdot_number = '${dot}'`;
  const byIdOrDot = mc && dot ? `docket_number in (${dockets}) OR usdot_number = '${dot}'` : byId;

  try {
    const [reg, boc3, notices, asOf] = await Promise.all([
      rows(CARRIER(), byId),
      rows(BOC3(), byId),
      rows(REVOKE(), byIdOrDot, { $order: 'order1_serve_date DESC' }),
      publishedAt(),
    ]);
    const first = reg[0];
    const statusIs = (r: any, st: string) => new RegExp(`^${st}$`, 'i').test(String(r.op_auth_status || '').trim());
    const family = (re: RegExp) => reg.filter((r) => re.test(String(r.op_auth_type || '')));
    const best = (rows: any[]): MotusStatus | undefined =>
      rows.some((r) => statusIs(r, 'active')) ? 'Active'
        : rows.some((r) => statusIs(r, 'inactive')) ? 'Inactive'
          : rows.some((r) => statusIs(r, 'pending')) ? 'Pending'
            : rows.length ? 'Withdrawn' : undefined;
    const carrierStatus = best(family(/Motor Carrier/i));
    const brokerStatus = best(family(/^Broker/i));
    const activeRows = reg.filter((r) => statusIs(r, 'active'));
    const decisive = activeRows.length ? activeRows : reg.filter((r) => statusIs(r, 'inactive'));
    // Whole dollars; a few migrated rows still carry thousands.
    const toK = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? (n > 0 && n < 10_000 ? Math.round(n) : Math.round(n / 1000)) : undefined; };
    const maxK = (col: string) => { const xs = decisive.map((r) => toK(r[col])).filter((n): n is number => typeof n === 'number'); return xs.length ? Math.max(...xs) : undefined; };
    const flag = (col: string) => (decisive.some((r) => r[col]) ? decisive.some((r) => /^Y/i.test(String(r[col]))) : undefined);
    const docket = String(first?.docket_number || '');
    const address = first
      ? [clean(first.bus_street_po), clean(first.bus_city), [clean(first.bus_state_code), clean(first.bus_zip_code)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      : undefined;
    const mailing = first
      ? [clean(first.mail_street_po), clean(first.mail_city), [clean(first.mail_state_code), clean(first.mail_zip_code)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      : undefined;
    const country = clean(first?.bus_ctry_code)?.toUpperCase();
    const value: MotusRecord = {
      checked: true,
      found: reg.length > 0,
      asOf,
      legalName: clean(first?.legal_name),
      dbaName: clean(first?.dba_name),
      phone: phone10(first?.bus_telno),
      address: address || undefined,
      mailingAddress: mailing && address && addressKey(mailing) && addressKey(mailing) !== addressKey(address) ? mailing : undefined,
      country: country && country !== 'US' ? country : undefined,
      rfc: clean(first?.rfc_number),
      mc: /^MC/i.test(docket) ? digits(docket).replace(/^0+/, '') || undefined : undefined,
      authorities: reg.map((r) => ({ type: String(r.op_auth_type || '').trim(), status: String(r.op_auth_status || '').trim() })).filter((a) => a.type),
      carrierStatus,
      brokerStatus,
      carrierActive: carrierStatus ? carrierStatus === 'Active' : undefined,
      brokerActive: brokerStatus ? brokerStatus === 'Active' : undefined,
      bipdOnFile: maxK('bipd_file'),
      bipdRequired: maxK('min_cov_amount'),
      cargoOnFile: flag('cargo_file'),
      bondOnFile: flag('bond_file'),
      cargoRequired: flag('cargo_req'),
      bondRequired: flag('bond_req'),
      // The file can hold an empty row for a docket next to the real filing.
      boc3: (() => {
        const filed = boc3.find((b) => String(b.co_name || '').trim());
        return filed ? { agent: String(filed.co_name).trim(), city: clean(filed.city), state: clean(filed.state_code) } : undefined;
      })(),
      suspensions: notices
        .map((n) => ({
          type: String(n.order1_type_desc || '').trim(),
          servedDate: isoDate(n.order1_serve_date),
          effectiveDate: isoDate(n.order1_effective_date),
          authority: clean(n.op_auth_type),
        }))
        .filter((n) => n.type),
    };
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    return value;
  } catch (e: any) {
    return { checked: false, found: false, authorities: [], suspensions: [], error: e?.name === 'AbortError' ? 'Motus data timed out' : e?.message || 'Motus data unavailable' };
  }
}

// ---------- Motus vs FMCSA's older records ----------

const nameKey = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Street number + 5-digit ZIP: enough to tell a different address from the
// same one written differently ("425 1ST AVE N" vs "425 First Avenue North").
function addressKey(v: unknown): string | null {
  const s = String(v ?? '').toUpperCase();
  const zip = s.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/)?.[1];
  const num = s.match(/^\s*(\d+)/)?.[1];
  return zip && num ? `${num}|${zip}` : zip ? `|${zip}` : null;
}

const fmtPhone = (d: string) => (d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d);
const fmtK = (k: number) => (k === 0 ? '$0' : `$${(k * 1000).toLocaleString('en-US')}`);

export function compareWithMotus(
  fmcsa: {
    name?: string; phone?: string; address?: string; bipdOnFile?: number; bipdRequired?: number;
    commonAuthority?: string; contractAuthority?: string; brokerAuthority?: string;
  },
  motus: MotusRecord,
): RegistryDiff[] {
  if (!motus.found) return [];
  const out: RegistryDiff[] = [];
  if (motus.legalName && fmcsa.name && nameKey(motus.legalName) !== nameKey(fmcsa.name)) {
    out.push({ field: 'name', label: 'Legal name', motus: motus.legalName, fmcsa: fmcsa.name, concern: true });
  }
  const fp = phone10(fmcsa.phone);
  if (motus.phone && fp && motus.phone !== fp) {
    out.push({ field: 'phone', label: 'Phone', motus: fmtPhone(motus.phone), fmcsa: fmtPhone(fp), concern: true });
  }
  const ma = addressKey(motus.address);
  const fa = addressKey(fmcsa.address);
  if (ma && fa && ma !== fa) {
    out.push({ field: 'address', label: 'Business address', motus: motus.address!, fmcsa: fmcsa.address!, concern: true });
  }
  // Authority: Motus is compared only when it has a real answer (Active or
  // Inactive). Active in Motus while the older record says otherwise is the
  // older record lagging; Inactive in Motus while the older record says
  // Active is the warning sign.
  const fCarrierActive = fmcsa.commonAuthority === 'Active' || fmcsa.contractAuthority === 'Active';
  const fCarrierShown = [fmcsa.commonAuthority, fmcsa.contractAuthority].find((v) => v && v !== 'Active') || 'Not on record';
  if (motus.carrierStatus === 'Active' && !fCarrierActive) {
    out.push({ field: 'carrierAuthority', label: 'Carrier authority', motus: 'Active', fmcsa: fCarrierShown, concern: false });
  } else if (motus.carrierStatus === 'Inactive' && fCarrierActive) {
    out.push({ field: 'carrierAuthority', label: 'Carrier authority', motus: 'Not active', fmcsa: 'Active', concern: true });
  }
  const fBrokerActive = fmcsa.brokerAuthority === 'Active';
  if (motus.brokerStatus === 'Active' && !fBrokerActive) {
    out.push({ field: 'brokerAuthority', label: 'Broker authority', motus: 'Active', fmcsa: fmcsa.brokerAuthority || 'Not on record', concern: false });
  } else if (motus.brokerStatus === 'Inactive' && fBrokerActive) {
    out.push({ field: 'brokerAuthority', label: 'Broker authority', motus: 'Not active', fmcsa: 'Active', concern: true });
  }
  // Liability insurance: the two systems count amounts differently (Motus
  // adds excess policies, the older record caps at what's required), so the
  // numbers alone aren't comparable. Only a change across the required
  // amount is a difference: covered in one, not in the other.
  if (typeof motus.bipdOnFile === 'number' && (motus.carrierStatus === 'Active' || motus.carrierStatus === 'Inactive')) {
    const required = fmcsa.bipdRequired || motus.bipdRequired || 750;
    const f = typeof fmcsa.bipdOnFile === 'number' ? fmcsa.bipdOnFile : 0;
    if (motus.bipdOnFile < required && f >= required) {
      out.push({ field: 'bipdOnFile', label: 'Liability insurance on file', motus: fmtK(motus.bipdOnFile), fmcsa: fmtK(f), concern: true });
    } else if (motus.bipdOnFile >= required && f < required) {
      out.push({ field: 'bipdOnFile', label: 'Liability insurance on file', motus: fmtK(motus.bipdOnFile), fmcsa: typeof fmcsa.bipdOnFile === 'number' ? fmtK(f) : 'Not on record', concern: false });
    }
  }
  return out;
}

// ---------- Motus as the primary record ----------
// Since May 2026 a new authority, a new MC number and new insurance exist in
// Motus first; FMCSA's older record (QCMobile) may not have them at all, and
// would then read as "no authority, no insurance" for a company that is in
// good standing. Where Motus shows an Active authority or coverage on file
// that the older record lacks, the report goes by Motus. The other direction
// (Motus Inactive, older record Active) is not overridden here: it is shown
// side by side and scored as a warning (see compareWithMotus + lib/risk).
// Returns what was taken from Motus, for the report to say so.
export function applyMotusToReport(
  carrier: {
    mc?: string; authorityStatus?: string; commonAuthority?: string; contractAuthority?: string; brokerAuthority?: string;
    bipdOnFile?: number; bipdRequired?: number; bondOnFile?: number; cargoOnFile?: number; cargoRequired?: boolean;
  },
  motus: MotusRecord,
  filings: { coverage: string; maxCoverageK: number | null }[] = [],
): string[] {
  if (!motus.found) return [];
  const applied: string[] = [];
  if (!carrier.mc && motus.mc) { carrier.mc = motus.mc; applied.push('MC number'); }
  // FMCSA's main record sometimes comes with no authority detail at all (it
  // answers that way for a company it only knows by USDOT number, and shows
  // the USDOT number as "Active"). Motus is then the only statement there
  // is, including "applied for, not granted yet" — which is not an authority.
  const noRoles = !carrier.commonAuthority && !carrier.contractAuthority && !carrier.brokerAuthority;
  if (noRoles) {
    const word = (s?: MotusStatus) => (s === 'Inactive' ? 'Inactive' : s === 'Pending' ? 'Pending' : s === 'Withdrawn' ? 'Not authorized' : undefined);
    const carrierWord = word(motus.carrierStatus);
    const brokerWord = word(motus.brokerStatus);
    if (carrierWord) carrier.commonAuthority = carrierWord;
    if (brokerWord) carrier.brokerAuthority = brokerWord;
    if (carrierWord || brokerWord) {
      if (motus.carrierStatus !== 'Active' && motus.brokerStatus !== 'Active') carrier.authorityStatus = 'Inactive';
      applied.push('authority status');
    }
  }
  if (motus.carrierStatus === 'Active' && carrier.commonAuthority !== 'Active' && carrier.contractAuthority !== 'Active') {
    carrier.commonAuthority = 'Active';
    carrier.authorityStatus = 'Active';
    applied.push('carrier authority');
  }
  if (motus.brokerStatus === 'Active' && carrier.brokerAuthority !== 'Active') {
    carrier.brokerAuthority = 'Active';
    if (!carrier.authorityStatus || carrier.authorityStatus !== 'Active') carrier.authorityStatus = carrier.commonAuthority === 'Active' || carrier.contractAuthority === 'Active' ? 'Active' : carrier.authorityStatus;
    applied.push('broker authority');
  }
  const filed = (re: RegExp) => Math.max(0, ...filings.filter((f) => re.test(f.coverage)).map((f) => f.maxCoverageK || 0));
  if (motus.carrierStatus === 'Active' && typeof motus.bipdOnFile === 'number' && motus.bipdOnFile > 0 && !((carrier.bipdOnFile ?? 0) > 0)) {
    carrier.bipdOnFile = motus.bipdOnFile;
    if (!carrier.bipdRequired && motus.bipdRequired) carrier.bipdRequired = motus.bipdRequired;
    applied.push('liability insurance');
  }
  if (motus.brokerStatus === 'Active' && motus.bondOnFile === true && !((carrier.bondOnFile ?? 0) > 0)) {
    carrier.bondOnFile = filed(/SURETY|TRUST/i) || 75; // $75,000 is the federal minimum
    applied.push('broker bond');
  }
  if (motus.carrierStatus === 'Active' && motus.cargoOnFile === true && !((carrier.cargoOnFile ?? 0) > 0)) {
    const k = filed(/CARGO/i);
    if (k > 0) { carrier.cargoOnFile = k; applied.push('cargo insurance'); }
  }
  return applied;
}

// Put the insurance filings and the Motus record on a report, the same way
// for every route that builds one (a lookup, and the daily report on the
// user's own company): filings as fetched, differences against FMCSA's
// older record as it came, then the report goes by Motus where Motus has an
// authority or coverage the older record doesn't know yet.
export async function attachFilings(
  carrier: any,
  insurance: { filings: any[]; history?: any[]; cancelled24m?: number; asOf: string | null; error?: string },
  motus: MotusRecord,
): Promise<void> {
  carrier.insuranceFilings = {
    checked: !insurance.error,
    asOf: insurance.asOf,
    filings: insurance.filings,
    ...(insurance.history ? { history: insurance.history, cancelled24m: insurance.cancelled24m || 0 } : {}),
    ...(insurance.error ? { error: insurance.error } : {}),
  };
  carrier.motus = motus;
  if (!motus.found) return;
  carrier.registryDiffs = compareWithMotus(carrier, motus);
  const applied = applyMotusToReport(carrier, motus, insurance.filings);
  if (applied.length) {
    carrier.motusApplied = applied;
    const { buildInsuranceSummary } = await import('./fmcsa');
    carrier.insuranceSummary = buildInsuranceSummary(carrier.bipdOnFile, carrier.cargoOnFile, carrier.cargoRequired) || carrier.insuranceSummary;
  }
}
