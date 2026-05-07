// Chameleon-carrier detection.
// A "chameleon" is a carrier shut down by FMCSA for fraud/safety violations
// who reincorporates under a new MC, keeping the same physical address,
// phone number, and often the same equipment + drivers. The new MC looks
// clean to anyone checking it in isolation. This module looks for the
// fingerprints (phone, address) that link a fresh-looking carrier to a
// dirty one.
//
// Sources we cross-check:
//   1. FMCSA "Carrier - All With History" Socrata dataset — find any other
//      carrier with the same phone/address that has an active enforcement
//      flag (pending revocation, no insurance, no surety bond).
//   2. Our own `lookups` table — find any carrier we've previously scored
//      as HIGH-risk that shares a phone/address with the one being checked.

import type { CarrierReport } from './fmcsa';

const SOCRATA_BASE = 'https://data.transportation.gov/resource';

export type ChameleonLink = {
  source: 'fmcsa-flag' | 'our-lookup';
  matchedOn: 'phone' | 'address' | 'phone+address';
  name: string;
  mc?: string;
  dot?: string;
  reason: string;          // human-readable: what's bad about THIS linked carrier
  badStatus: boolean;      // true if this linked record is a known-bad signal
};

export async function findChameleonLinks(carrier: CarrierReport): Promise<ChameleonLink[]> {
  const phone = normalizePhone(carrier.phone);
  const address = normalizeAddress(carrier.address);
  // Need at least one fingerprint to do anything.
  if (!phone && !address) return [];

  const results = await Promise.all([
    queryFmcsaByFingerprint(phone, address, carrier).catch((e) => {
      console.warn('[chameleon] FMCSA query failed:', e?.message);
      return [] as ChameleonLink[];
    }),
    queryOurLookupsByFingerprint(phone, address, carrier).catch((e) => {
      console.warn('[chameleon] lookups query failed:', e?.message);
      return [] as ChameleonLink[];
    }),
  ]);

  // Dedupe by MC/DOT — we don't want one bad carrier showing up three times
  // because we found it in three sources.
  const seen = new Set<string>();
  const all: ChameleonLink[] = [];
  for (const bucket of results) {
    for (const link of bucket) {
      const key = link.mc ? `mc:${link.mc}` : link.dot ? `dot:${link.dot}` : `name:${link.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(link);
    }
  }
  return all;
}

// ----- queries -------------------------------------------------------------

async function queryFmcsaByFingerprint(
  phone: string | undefined,
  address: string | undefined,
  self: CarrierReport,
): Promise<ChameleonLink[]> {
  const datasetId = process.env.FMCSA_SOCRATA_DATASET_ID;
  if (!datasetId) return [];

  // Phone-only Socrata query. Address-shared matches are too noisy to be
  // actionable (every commercial building has shared addresses; mailbox
  // services host hundreds of tenants), so we don't query for them.
  // `address` is still pulled here for context but never used as a match
  // criterion — referenced only when phone match exists, to label the
  // result as "phone+address" instead of "phone".
  if (!phone) return [];
  void address;
  const wheres = [`bus_telno='${phone.replace(/'/g, "''")}'`];

  const params = new URLSearchParams();
  params.set('$select', [
    'dot_number', 'docket_number', 'legal_name', 'dba_name',
    'bus_telno', 'bus_street_po', 'bus_city', 'bus_state_code',
    'common_stat', 'contract_stat', 'broker_stat',
    'common_rev_pend', 'contract_rev_pend', 'broker_rev_pend',
    'undeliverable_mail',
    'bipd_file', 'bond_file',
  ].join(','));
  params.set('$where', wheres.join(' OR '));
  params.set('$limit', '25');

  const url = `${SOCRATA_BASE}/${datasetId}.json?${params.toString()}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<Record<string, any>>;

    return rows
      .map((r): ChameleonLink | null => {
        const linkedDot = stripDigits(r.dot_number);
        const linkedMc = stripDigits(r.docket_number);
        // Skip the carrier itself — we don't flag a carrier for matching itself.
        if (linkedDot && self.dot && linkedDot === self.dot) return null;
        if (linkedMc && self.mc && linkedMc === self.mc) return null;

        const flags: string[] = [];
        const isCommonActive = String(r.common_stat || '') === 'A';
        const isContractActive = String(r.contract_stat || '') === 'A';
        const isBrokerActive = String(r.broker_stat || '') === 'A';
        const bipd = parseAmount(r.bipd_file);
        const bond = parseAmount(r.bond_file);

        if (String(r.broker_rev_pend || '') === 'Y') flags.push('broker authority revocation pending');
        if (String(r.common_rev_pend || '') === 'Y') flags.push('common authority revocation pending');
        if (String(r.contract_rev_pend || '') === 'Y') flags.push('contract authority revocation pending');
        if ((isCommonActive || isContractActive) && bipd === 0) flags.push('no liability insurance on file');
        if (isBrokerActive && bond === 0) flags.push('broker, no surety bond');
        if (String(r.undeliverable_mail || '') === 'Y') flags.push('FMCSA mail undeliverable');

        // Only surface FMCSA matches that have a real bad signal — there are
        // legitimate reasons two carriers share a phone (broker + carrier
        // arms of one company, mail-forwarding services). Without a flag,
        // it's noise.
        if (flags.length === 0) return null;

        const matchPhone = phone && normalizePhone(r.bus_telno) === phone;
        const matchAddr = address && normalizeAddress(r.bus_street_po) === address;

        // Address-only matches are too noisy to act on:
        //   - Office buildings have dozens of LLCs at the same street.
        //   - Common suites ("STE 1", "# 100") often mean small mailbox /
        //     virtual-office services that legitimately host many tenants.
        //   - The user gets ZERO actionable signal from "Acme is at the
        //     same address as a flagged carrier" when that address is a
        //     coworking space.
        // Phone is a much stronger signal — same number across two
        // FMCSA records is rarely innocent. We require a phone match.
        if (!matchPhone) return null;

        return {
          source: 'fmcsa-flag',
          matchedOn: matchPhone && matchAddr ? 'phone+address' : 'phone',
          name: String(r.legal_name || r.dba_name || 'Unknown carrier').trim(),
          mc: linkedMc,
          dot: linkedDot,
          reason: flags.join(' · '),
          badStatus: true,
        };
      })
      .filter((x): x is ChameleonLink => x != null);
  } finally {
    clearTimeout(timeout);
  }
}

async function queryOurLookupsByFingerprint(
  phone: string | undefined,
  address: string | undefined,
  self: CarrierReport,
): Promise<ChameleonLink[]> {
  const { getServiceSupabase } = await import('./supabase/service');
  const svc = getServiceSupabase();
  if (!svc) return [];

  // We only flag links to lookups we've ALREADY scored as HIGH risk.
  // Otherwise every shared-phone match would noise up the report.
  const { data } = await svc
    .from('lookups')
    .select('mc,dot,name,verdict,data,created_at')
    .eq('verdict', 'high')
    .order('created_at', { ascending: false })
    .limit(500);

  if (!Array.isArray(data)) return [];

  const matches: ChameleonLink[] = [];
  for (const row of data) {
    const rowPhone = normalizePhone(row?.data?.phone);
    const matchPhone = phone && rowPhone && rowPhone === phone;
    // Phone-only signal — address matches across our lookup history are
    // too noisy (commercial buildings, mailbox services). See note in
    // queryFmcsaByFingerprint above.
    if (!matchPhone) continue;
    // Skip the carrier itself.
    if (row.mc && self.mc && row.mc === self.mc) continue;
    if (row.dot && self.dot && row.dot === self.dot) continue;
    const matchAddr = false;

    matches.push({
      source: 'our-lookup',
      matchedOn: matchPhone && matchAddr ? 'phone+address' : matchPhone ? 'phone' : 'address',
      name: row.name || row?.data?.name || 'Unknown carrier',
      mc: row.mc || undefined,
      dot: row.dot || undefined,
      reason: 'previously scored HIGH risk by Haulock',
      badStatus: true,
    });
  }
  return matches;
}

// ----- normalization -------------------------------------------------------

function normalizePhone(input: any): string | undefined {
  if (input == null) return undefined;
  const digits = String(input).replace(/[^0-9]/g, '');
  if (digits.length < 10) return undefined;
  // Drop US country code prefix if present, normalize to 10 digits.
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(-10);
}

// Extract the unit / suite / apartment / floor token from a street string.
// Returns the *value* of the unit, normalized to uppercase, or undefined
// when the address has no unit specifier. Used to distinguish "different
// suites of the same building" (legitimate office building) from "same
// suite, same building" (real link signal).
//
// Examples:
//   "1030 S LA GRANGE RD SUITE 27" -> "27"
//   "1900 LAKE ST STE 1B"          -> "1B"
//   "100 MAIN ST APT 4"            -> "4"
//   "100 MAIN ST # 530"            -> "530"
//   "100 MAIN ST"                  -> undefined  (no unit)
export function extractUnitToken(addr: string): string | undefined {
  if (!addr) return undefined;
  const upper = addr.toUpperCase();
  // Match common unit prefixes followed by an alphanumeric token.
  const unitRe = /\b(STE|SUITE|UNIT|APT|APARTMENT|RM|ROOM|FLR|FLOOR|SPACE|BLDG|LOT|#)\s*\.?\s*([A-Z0-9-]+)\b/;
  const m = upper.match(unitRe);
  if (m) return m[2];
  // Standalone "# 27" form.
  const hashMatch = upper.match(/#\s*([A-Z0-9-]+)/);
  if (hashMatch) return hashMatch[1];
  return undefined;
}

function normalizeAddress(input: any): string | undefined {
  if (!input) return undefined;
  // Take just the street component of "1900 LAKE ST STE 1, DYER, IN, 46311"
  // Many spoofed carriers vary city/state/ZIP slightly but reuse the street.
  const street = String(input).split(',')[0] || '';
  return street
    .toUpperCase()
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bSUITE\b/g, 'STE')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || undefined;
}

function stripDigits(v: any): string | undefined {
  if (v == null) return undefined;
  const s = String(v).replace(/[^0-9]/g, '').replace(/^0+/, '');
  return s || undefined;
}

function parseAmount(v: any): number {
  if (v == null) return 0;
  const s = String(v).replace(/[^0-9]/g, '');
  if (!s) return 0;
  return Number(s);
}
